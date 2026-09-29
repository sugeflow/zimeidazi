"""评论互动：同步自己作品下的新评论 → 搭子起草回复 → 用户确认后发送。

目前只支持小红书（Easel 自带 xhs_comment.py：列笔记、抓评论、回复）。
只回复自己作品下的评论；发送有每日上限和间隔，降低被平台限流的风险。
"""

from __future__ import annotations

import json
import re
import tempfile
import time
from datetime import date
from pathlib import Path

from . import db, jobs, llm
from .jobs import JobError

PLATFORM = "xiaohongshu"
SCRIPT = "xhs_comment.py"
NOTES_PER_SYNC = 5          # 每次同步看最近几篇笔记
FRESH_DAYS = 7              # 第一次同步时，超过 7 天的旧评论不算待回复
DAILY_LIMIT = 30            # 每个平台每天最多回复多少条
BATCH_GAP = 90              # 两批发送之间至少隔多少秒
REPLY_GAP = "12"            # 同一批里每条之间隔多少秒（交给脚本）
REPLIED_FILE = db.ROOT / "outputs" / "_dazi" / "xhs-replied.json"


def _json_from(stdout: str):
    """脚本会先打印提示再打印 JSON；取第一个完整的 JSON 对象"""
    i = stdout.find("{")
    if i < 0:
        return None
    try:
        return json.JSONDecoder().raw_decode(stdout[i:])[0]
    except ValueError:
        return None


def _logged_in() -> bool:
    try:
        return any(a.get("platform") == PLATFORM and a.get("loggedIn") for a in jobs.local("/api/accounts", 20))
    except Exception:
        return False


def _my_name() -> str:
    cached = db.get(f"me:{PLATFORM}")
    if cached:
        return cached
    try:
        name = (jobs.local(f"/api/accounts/{PLATFORM}/whoami", 90) or {}).get("name") or ""
    except Exception:
        name = ""
    if name:
        db.put(f"me:{PLATFORM}", name)
    return name


# ---------------------------------------------------------------- 同步

def sync(job: dict) -> str:
    if not _logged_in():
        raise JobError("小红书还没登录，先到「账号与定位」扫码登录")
    job["message"] = "正在看你最近发的笔记…"
    r = jobs.script(SCRIPT, "notes", "--scroll", "2", "--no-proxy", timeout=180)
    data = _json_from(r.stdout)
    if not data:
        _log(r.stdout + r.stderr)
        raise JobError("没读到你的笔记，可能登录过期了，重新扫码登录试试")
    notes = [n for n in data.get("notes", []) if n.get("note_id")]
    me = _my_name()
    t = db.now()
    first_sync = db.get(f"synced:{PLATFORM}") is None
    added = 0
    with db.conn() as c:
        for n in notes:
            c.execute("INSERT OR REPLACE INTO notes (platform, note_id, title, cover, url, synced_at) VALUES (?,?,?,?,?,?)",
                      (PLATFORM, n["note_id"], n.get("title", ""), n.get("cover", ""), n.get("url", ""), t))
    for i, n in enumerate([n for n in notes if n.get("url")][:NOTES_PER_SYNC]):
        job["message"] = f"正在看第 {i + 1} 篇笔记的评论…"
        r = jobs.script(SCRIPT, "fetch", "--url", n["url"], "--scroll", "4", "--no-proxy", timeout=180)
        got = _json_from(r.stdout) or {}
        comments = got.get("comments") or []
        mine = {c["parent"] for c in comments if me and c.get("nickname") == me and c.get("parent")}
        with db.conn() as c:
            for cm in comments:
                if not cm.get("id") or (me and cm.get("nickname") == me):
                    continue  # 自己的评论不用回
                ts = int(cm.get("time") or 0)
                ts = ts // 1000 if ts > 10**12 else ts
                old = first_sync and ts and ts < t - FRESH_DAYS * 86400
                status = "replied" if cm["id"] in mine else ("old" if old else "new")
                cur = c.execute("INSERT OR IGNORE INTO comments (platform, id, note_id, parent, nickname, content, time, likes, loc, status, fetched_at) "
                                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                                (PLATFORM, cm["id"], n["note_id"], cm.get("parent", ""), cm.get("nickname", ""),
                                 cm.get("content", ""), ts, str(cm.get("like", "")), cm.get("loc", ""), status, t))
                added += cur.rowcount if status == "new" else 0
                # 在平台上已经回过的（比如在手机上回的），标成已回复
                if cm["id"] in mine:
                    c.execute("UPDATE comments SET status='replied' WHERE platform=? AND id=? AND status IN ('new','drafted')",
                              (PLATFORM, cm["id"]))
    db.put(f"synced:{PLATFORM}", t)
    return f"看了 {min(len(notes), NOTES_PER_SYNC)} 篇笔记，新评论 {added} 条" if notes else "还没有发过笔记"


# ---------------------------------------------------------------- 起草

SYSTEM = """你是自媒体博主本人，在自己作品的评论区回复粉丝。要求：
- 口语化、真诚、简短，一般 10～40 字，像真人随手回的，不要客服腔，不要每条都用同一个开头
- 能回答的问题直接回答；夸奖就自然地感谢或互动；有争议的不争论，温和带过
- 不要编造你不知道的事实，不要承诺做不到的事，不留联系方式，不引导私下交易
- 广告、引流、辱骂、明显的机器人评论，回复内容留空（表示建议忽略）
只输出 JSON：{"replies": [{"id": "评论 id", "reply": "回复内容"}]}"""


def draft(ids: list[str], persona: str) -> dict[str, str]:
    with db.conn() as c:
        rows = c.execute(f"SELECT c.*, n.title FROM comments c LEFT JOIN notes n ON n.platform=c.platform AND n.note_id=c.note_id "
                         f"WHERE c.id IN ({','.join('?' * len(ids))})", ids).fetchall()
    if not rows:
        return {}
    who = llm.persona_text(persona)
    groups: dict[str, list] = {}
    for r in rows:
        groups.setdefault(r["title"] or "（没有标题的笔记）", []).append(r)
    prompt = (f"我的账号定位：\n{who}\n\n" if who else "") + "\n\n".join(
        f"笔记《{title}》下的评论：\n" + "\n".join(f"- id={r['id']} @{r['nickname']}：{r['content']}" for r in rs)
        for title, rs in groups.items())
    text = llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}], json_mode=True)
    m = re.search(r"\{.*\}", text, re.S)
    try:
        replies = json.loads(m.group(0) if m else text).get("replies", [])
    except (ValueError, AttributeError):
        raise llm.LLMError("模型这次没按格式回答，再点一次试试") from None
    out = {str(x.get("id")): str(x.get("reply") or "").strip() for x in replies if x.get("id")}
    with db.conn() as c:
        for cid, reply in out.items():
            c.execute("UPDATE comments SET draft=?, error='' WHERE platform=? AND id=? AND status='new'", (reply, PLATFORM, cid))
    return out


# ---------------------------------------------------------------- 发送

def _today_key() -> str:
    return f"sent:{PLATFORM}:{date.today().isoformat()}"


def quota() -> dict:
    used = db.get(_today_key(), 0)
    return {"used": used, "limit": DAILY_LIMIT, "left": max(0, DAILY_LIMIT - used)}


def check_send(ids: list[str]) -> None:
    """发送前的检查：额度、间隔、内容。不通过直接告诉用户原因"""
    q = quota()
    if len(ids) > q["left"]:
        raise JobError(f"今天最多再回 {q['left']} 条（每天上限 {DAILY_LIMIT} 条，回太多容易被平台限流）")
    last = db.get(f"last_send:{PLATFORM}", 0)
    wait = BATCH_GAP - (db.now() - last)
    if wait > 0:
        raise JobError(f"刚发过一批，{wait} 秒后再发（发太快容易被平台限流）")


def send(job: dict, ids: list[str]) -> str:
    with db.conn() as c:
        rows = c.execute(f"SELECT c.*, n.url FROM comments c LEFT JOIN notes n ON n.platform=c.platform AND n.note_id=c.note_id "
                         f"WHERE c.platform=? AND c.id IN ({','.join('?' * len(ids))}) AND c.status='new' AND c.draft != ''",
                         [PLATFORM, *ids]).fetchall()
    if not rows:
        raise JobError("没有可以发送的回复")
    db.put(f"last_send:{PLATFORM}", db.now())
    by_note: dict[str, list] = {}
    for r in rows:
        by_note.setdefault(r["url"] or "", []).append(r)
    ok = 0
    for i, (url, rs) in enumerate(by_note.items()):
        if not url:
            _mark_failed([r["id"] for r in rs], "找不到这篇笔记的链接，重新同步一下")
            continue
        job["message"] = f"正在回复（{i + 1}/{len(by_note)} 篇笔记）…"
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump([{"id": r["id"], "nickname": r["nickname"], "reply": r["draft"]} for r in rs], f, ensure_ascii=False)
            path = f.name
        try:
            proc = jobs.script(SCRIPT, "reply", "--url", url, "--replies-json", path, "--replied-file", str(REPLIED_FILE),
                               "--gap", REPLY_GAP, "--no-proxy", "--exec", timeout=120 + 30 * len(rs))
        finally:
            Path(path).unlink(missing_ok=True)
        done = set(json.loads(REPLIED_FILE.read_text(encoding="utf-8"))) if REPLIED_FILE.is_file() else set()
        sent = [r["id"] for r in rs if r["id"] in done]
        with db.conn() as c:
            for cid in sent:
                c.execute("UPDATE comments SET status='replied', replied_at=?, error='' WHERE platform=? AND id=?", (db.now(), PLATFORM, cid))
        failed = [r["id"] for r in rs if r["id"] not in done]
        if failed:
            out = proc.stdout + proc.stderr
            reason = "没发出去，可能是评论被删了，重新同步看看"
            if "未登录" in out:
                reason = "小红书登录过期了，到「账号与定位」重新扫码登录"
            elif "内容安全" in out or "content_guard" in out:
                reason = "回复里有不适合发出去的内容，改一下再发"
            elif "未找到回复按钮" in out:
                reason = "在笔记里没找到这条评论，可能被删了或者作者改了昵称"
            _log(out)
            _mark_failed(failed, reason)
        ok += len(sent)
        db.put(_today_key(), db.get(_today_key(), 0) + len(sent))
    total = len(rows)
    if ok == 0:
        raise JobError("一条都没发出去，看看每条下面的原因")
    return f"发出去 {ok} 条" + (f"，{total - ok} 条没发成功" if ok < total else "")


def _log(text: str) -> None:
    """脚本输出留一份，排查问题时看（设置 → 打开日志文件夹）"""
    import os
    d = Path(os.environ.get("DAZI_LOGS_DIR") or db.ROOT / "outputs" / "_dazi")
    try:
        d.mkdir(parents=True, exist_ok=True)
        with open(d / "engage.log", "a", encoding="utf-8") as f:
            f.write(f"\n==== {time.strftime('%Y-%m-%d %H:%M:%S')}\n{text[-4000:]}\n")
    except OSError:
        pass


def _mark_failed(ids: list[str], reason: str) -> None:
    with db.conn() as c:
        for cid in ids:
            c.execute("UPDATE comments SET error=? WHERE platform=? AND id=?", (reason, PLATFORM, cid))


# ---------------------------------------------------------------- 查询

def listing(status: str) -> list[dict]:
    where = {"pending": "c.status='new'", "replied": "c.status='replied'", "ignored": "c.status='ignored'"}.get(status, "c.status='new'")
    with db.conn() as c:
        rows = c.execute(f"SELECT c.*, n.title, n.cover, n.url FROM comments c LEFT JOIN notes n "
                         f"ON n.platform=c.platform AND n.note_id=c.note_id WHERE {where} ORDER BY c.time DESC LIMIT 300").fetchall()
    return [dict(r) for r in rows]


def pending_count() -> int:
    with db.conn() as c:
        return c.execute("SELECT COUNT(*) FROM comments WHERE status='new'").fetchone()[0]


def update(cid: str, draft_text: str | None, status: str | None) -> None:
    with db.conn() as c:
        if draft_text is not None:
            c.execute("UPDATE comments SET draft=?, error='' WHERE platform=? AND id=?", (draft_text.strip(), PLATFORM, cid))
        if status in ("new", "ignored"):
            c.execute("UPDATE comments SET status=? WHERE platform=? AND id=? AND status IN ('new','ignored')", (status, PLATFORM, cid))


def summary() -> dict:
    return {
        "pending": pending_count(),
        "lastSync": db.get(f"synced:{PLATFORM}"),
        "loggedIn": _logged_in(),
        "quota": quota(),
        "jobs": jobs.running(platform=PLATFORM),
        "time": time.time(),
    }
