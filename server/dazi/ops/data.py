"""账号数据：复用上游 /api/analytics/{平台} 抓数据，每次抓到都存一份快照，用来画趋势。"""

from __future__ import annotations

import json
import time
import urllib.error

from . import db, jobs
from .jobs import JobError


def platforms() -> list[dict]:
    """支持看数据的平台 + 登录状态"""
    try:
        return jobs.local("/api/analytics/platforms", 20)
    except Exception:
        return []


def refresh(job: dict, platform: str) -> str:
    job["message"] = "正在读取账号数据…（要打开一次网页，十几秒）"
    try:
        d = jobs.local(f"/api/analytics/{platform}", 240)
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8")).get("detail", "")
        except Exception:
            detail = ""
        raise JobError(detail or "没读到数据，可能登录过期了") from None
    except Exception:
        raise JobError("没读到数据，网络慢或者平台要求验证，稍后再试") from None
    if not d.get("loggedIn", True):
        raise JobError("这个平台还没登录")
    with db.conn() as c:
        c.execute("INSERT INTO snapshots (platform, ts, followers, likes, posts, data) VALUES (?,?,?,?,?,?)",
                  (platform, db.now(), d.get("followers"), d.get("likes"), d.get("posts"), json.dumps(d, ensure_ascii=False)))
    db.put(f"data_at:{platform}", db.now())
    return "已更新"


def _series(c, platform: str, days: int) -> list[dict]:
    """每天取最后一份快照"""
    since = db.now() - days * 86400
    rows = c.execute("SELECT ts, followers, likes, posts FROM snapshots WHERE platform=? AND ts>=? ORDER BY ts", (platform, since)).fetchall()
    by_day: dict[str, dict] = {}
    for r in rows:
        by_day[time.strftime("%Y-%m-%d", time.localtime(r["ts"]))] = dict(r)
    return [{"day": k, **v} for k, v in sorted(by_day.items())]


def _delta(series: list[dict], key: str, days: int) -> int | None:
    """和 N 天前（或能找到的最早一天）比，涨了多少"""
    if len(series) < 2 or series[-1].get(key) is None:
        return None
    cutoff = time.strftime("%Y-%m-%d", time.localtime(time.time() - days * 86400))
    base = next((s for s in series if s["day"] >= cutoff and s.get(key) is not None), None)
    if not base or base is series[-1]:
        return None
    return series[-1][key] - base[key]


def overview() -> list[dict]:
    out = []
    with db.conn() as c:
        for p in platforms():
            pf = p["platform"]
            row = c.execute("SELECT ts, data FROM snapshots WHERE platform=? ORDER BY ts DESC LIMIT 1", (pf,)).fetchone()
            series = _series(c, pf, 90)
            latest = json.loads(row["data"]) if row else None
            out.append({
                "platform": pf, "name": p.get("name", pf), "loggedIn": p.get("loggedIn", False),
                "updated": row["ts"] if row else None, "latest": latest, "series": series,
                "delta": {k: {"day": _delta(series, k, 1), "week": _delta(series, k, 7)} for k in ("followers", "likes", "posts")},
                "jobs": jobs.running("data", pf),
            })
    return out
