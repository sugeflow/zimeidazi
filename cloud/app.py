"""搭子云：激活码（月卡）+ 模型中转。

软件里只有搭子云的地址和一个绑定本机的令牌；真实的模型 Key 只在这里（环境变量）。
- /v1/*        OpenAI 兼容接口，给软件用（令牌鉴权、按月计数）
- /admin       管理后台（生成激活码、看用量、封禁），由前面的 nginx 用 authentik 统一登录保护
数据存在 SQLite（DAZI_DB）。
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse

DB = Path(os.environ.get("DAZI_DB", "cloud.db"))
PLAN_DAYS = int(os.environ.get("PLAN_DAYS", "30"))
QUOTA = {  # 每个会员每个自然月的额度
    "chat": int(os.environ.get("QUOTA_CHAT", "3000")),
    "image": int(os.environ.get("QUOTA_IMAGE", "200")),
    "video": int(os.environ.get("QUOTA_VIDEO", "30")),
}
ADMIN_USERS = {u.strip() for u in os.environ.get("ADMIN_USERS", "").split(",") if u.strip()}


def upstream(name: str) -> dict:
    """上游模型配置：{name}_BASE / {name}_KEY / {name}_MODEL"""
    return {k: os.environ.get(f"{name}_{k.upper()}", "") for k in ("base", "key", "model")}


# 软件里用的模型名 → 上游。换模型、换厂商只改这里的环境变量，软件不用发版
CHAT_MODELS = {"dazi-agent": "AGENT", "dazi-fast": "FAST"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY, days INTEGER, note TEXT DEFAULT '', created INTEGER,
  status TEXT DEFAULT 'new',          -- new 未激活 / active 使用中 / disabled 封禁 / renewed 已并入续费
  device TEXT, device_name TEXT, activated INTEGER, expires INTEGER, token_hash TEXT
);
CREATE INDEX IF NOT EXISTS codes_token ON codes (token_hash);
-- 用量按电脑（device）计：续费换了新激活码，本月用量也接着算
CREATE TABLE IF NOT EXISTS usage (code TEXT, month TEXT, kind TEXT, count INTEGER DEFAULT 0, PRIMARY KEY (code, month, kind));
"""


@contextmanager
def db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    try:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        yield c
        c.commit()
    finally:
        c.close()


def now() -> int:
    return int(time.time())


def month() -> str:
    return time.strftime("%Y-%m")


def sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def err(status: int, message: str) -> JSONResponse:
    # OpenAI 兼容的错误格式，软件里的报错翻译能认出来
    return JSONResponse({"error": {"message": message, "type": "dazi_error"}}, status_code=status)


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
client = httpx.AsyncClient(timeout=httpx.Timeout(600, connect=20))


# ---------------------------------------------------------------- 鉴权与额度

def member(request: Request) -> sqlite3.Row:
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not token:
        raise HTTPException(401, "还没有激活")
    with db() as c:
        row = c.execute("SELECT * FROM codes WHERE token_hash=?", (sha(token),)).fetchone()
    if not row:
        raise HTTPException(401, "激活信息失效了，请重新输入激活码")
    if row["status"] == "disabled":
        raise HTTPException(403, "这个激活码已被停用，请联系客服")
    if row["status"] != "active" or (row["expires"] or 0) < now():
        raise HTTPException(403, "会员已到期，续费后就能继续用")
    return row


def used(device: str) -> dict:
    with db() as c:
        rows = c.execute("SELECT kind, count FROM usage WHERE code=? AND month=?", (device, month())).fetchall()
    return {k: 0 for k in QUOTA} | {r["kind"]: r["count"] for r in rows}


def spend(device: str, kind: str, n: int = 1) -> None:
    if used(device).get(kind, 0) + n > QUOTA[kind]:
        label = {"chat": "对话", "image": "生图", "video": "生视频"}[kind]
        raise HTTPException(429, f"本月{label}额度用完了，下个月自动恢复")
    with db() as c:
        c.execute("INSERT INTO usage (code, month, kind, count) VALUES (?,?,?,?) "
                  "ON CONFLICT(code, month, kind) DO UPDATE SET count = count + excluded.count", (device, month(), kind, n))


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    return err(exc.status_code, str(exc.detail))


# ---------------------------------------------------------------- 激活

@app.post("/v1/dazi/activate")
async def activate(request: Request):
    body = await request.json()
    code = str(body.get("code", "")).strip().upper().replace(" ", "")
    device = str(body.get("device", "")).strip()[:64]
    name = str(body.get("deviceName", "")).strip()[:64]
    if not code or not device:
        raise HTTPException(400, "激活码不能为空")
    with db() as c:
        row = c.execute("SELECT * FROM codes WHERE code=?", (code,)).fetchone()
        if not row:
            raise HTTPException(404, "激活码不对，检查一下有没有输错")
        if row["status"] == "disabled":
            raise HTTPException(403, "这个激活码已被停用，请联系客服")
        if row["status"] == "renewed":
            raise HTTPException(409, "这个激活码已经用来续费过了")
        if row["device"] and row["device"] != device:
            raise HTTPException(409, "这个激活码已经在另一台电脑上激活了，需要换电脑请联系客服")
        token = "dz_" + secrets.token_urlsafe(32)
        expires = row["expires"]
        if row["status"] == "new":
            # 同一台电脑上还有没到期的会员：续费，天数接在后面
            prev = c.execute("SELECT * FROM codes WHERE device=? AND status='active' AND expires>? ORDER BY expires DESC",
                             (device, now())).fetchone()
            start = max(now(), prev["expires"]) if prev else now()
            expires = start + row["days"] * 86400
            if prev:
                c.execute("UPDATE codes SET status='renewed', token_hash=NULL WHERE device=? AND status='active'", (device,))
        c.execute("UPDATE codes SET status='active', device=?, device_name=?, activated=COALESCE(activated, ?), expires=?, token_hash=? WHERE code=?",
                  (device, name, now(), expires, sha(token), code))
    return {"token": token, "expiresAt": expires}


@app.get("/v1/dazi/me")
async def me(request: Request):
    row = member(request)
    return {"expiresAt": row["expires"], "daysLeft": max(0, (row["expires"] - now() + 86399) // 86400),
            "used": used(row["device"]), "quota": QUOTA, "code": row["code"][:4] + "••••"}


# ---------------------------------------------------------------- 模型中转

def _headers(key: str) -> dict:
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


async def _forward(url: str, key: str, payload: dict, stream: bool):
    req = client.build_request("POST", url, headers=_headers(key), json=payload)
    r = await client.send(req, stream=True)
    if not stream or r.status_code >= 400:
        body = await r.aread()
        await r.aclose()
        return Response(body, status_code=r.status_code, media_type=r.headers.get("content-type", "application/json"))

    async def gen():
        try:
            async for chunk in r.aiter_raw():
                yield chunk
        finally:
            await r.aclose()
    return StreamingResponse(gen(), status_code=r.status_code, media_type=r.headers.get("content-type", "text/event-stream"),
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/v1/models")
async def models(request: Request):
    member(request)
    return {"object": "list", "data": [{"id": m, "object": "model", "owned_by": "dazi"} for m in CHAT_MODELS]}


@app.post("/v1/chat/completions")
async def chat(request: Request):
    row = member(request)
    payload = await request.json()
    up = upstream(CHAT_MODELS.get(payload.get("model", ""), "AGENT"))
    if not up["base"]:
        raise HTTPException(503, "服务还没配置好模型，请联系客服")
    spend(row["device"], "chat")
    payload["model"] = up["model"]
    return await _forward(up["base"].rstrip("/") + "/chat/completions", up["key"], payload, bool(payload.get("stream")))


@app.post("/v1/images/generations")
async def images(request: Request):
    row = member(request)
    payload = await request.json()
    up = upstream("IMAGE")
    n = max(1, min(int(payload.get("n") or 1), 4))
    spend(row["device"], "image", n)
    payload.update(model=up["model"], n=n)
    return await _forward(up["base"].rstrip("/") + "/images/generations", up["key"], payload, False)


@app.post("/v1/videos")
async def videos(request: Request):
    row = member(request)
    payload = await request.json()
    up = upstream("VIDEO")
    spend(row["device"], "video")
    payload["model"] = up["model"]
    return await _forward(up["base"].rstrip("/") + "/videos", up["key"], payload, False)


@app.get("/v1/videos/{task_id}")
async def video_status(task_id: str, request: Request):
    member(request)
    up = upstream("VIDEO")
    r = await client.get(up["base"].rstrip("/") + f"/videos/{task_id}", headers=_headers(up["key"]))
    return Response(r.content, status_code=r.status_code, media_type=r.headers.get("content-type", "application/json"))


@app.get("/healthz")
async def healthz():
    with db() as c:
        c.execute("SELECT 1")
    return {"ok": True}


# ---------------------------------------------------------------- 管理后台（nginx 已做 authentik 登录）

def admin(request: Request) -> str:
    user = request.headers.get("x-authentik-username", "")
    if not user or (ADMIN_USERS and user not in ADMIN_USERS):
        raise HTTPException(403, "没有管理权限")
    return user


@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    admin(request)
    return (Path(__file__).parent / "admin.html").read_text(encoding="utf-8")


@app.get("/admin/api/codes")
async def admin_codes(request: Request):
    admin(request)
    with db() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM codes ORDER BY created DESC LIMIT 1000").fetchall()]
        use = {}
        for r in c.execute("SELECT code, kind, count FROM usage WHERE month=?", (month(),)).fetchall():
            use.setdefault(r["code"], {})[r["kind"]] = r["count"]
    for r in rows:
        r.pop("token_hash", None)
        r["used"] = use.get(r["device"], {}) if r["device"] else {}
    return {"codes": rows, "quota": QUOTA, "now": now()}


ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 去掉容易看错的 0 O 1 I


def new_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(16))
    return "-".join(raw[i:i + 4] for i in range(0, 16, 4))


@app.post("/admin/api/codes")
async def admin_generate(request: Request):
    admin(request)
    body = await request.json()
    count = max(1, min(int(body.get("count") or 1), 200))
    days = max(1, min(int(body.get("days") or PLAN_DAYS), 3660))
    note = str(body.get("note", ""))[:100]
    codes = [new_code() for _ in range(count)]
    with db() as c:
        c.executemany("INSERT INTO codes (code, days, note, created) VALUES (?,?,?,?)", [(x, days, note, now()) for x in codes])
    return {"codes": codes}


@app.post("/admin/api/codes/{code}/{action}")
async def admin_action(code: str, action: str, request: Request):
    admin(request)
    with db() as c:
        row = c.execute("SELECT * FROM codes WHERE code=?", (code,)).fetchone()
        if not row:
            raise HTTPException(404, "没有这个激活码")
        if action == "disable":
            c.execute("UPDATE codes SET status='disabled' WHERE code=?", (code,))
        elif action == "enable":
            c.execute("UPDATE codes SET status=? WHERE code=?", ("active" if row["device"] else "new", code))
        elif action == "unbind":  # 用户换电脑：解绑后可以在新电脑上重新激活，天数不变
            c.execute("UPDATE codes SET device=NULL, device_name=NULL, token_hash=NULL WHERE code=?", (code,))
        else:
            raise HTTPException(400, "不支持的操作")
    return {"ok": True}
