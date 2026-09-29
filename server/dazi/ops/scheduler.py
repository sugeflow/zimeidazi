"""后台定时同步：新评论每 45 分钟看一次，账号数据每 12 小时一次。只处理已登录的平台。
启动后先等 3 分钟再开始，不和软件启动抢资源。"""

from __future__ import annotations

import os
import threading
import time

from . import data, db, engage, jobs

COMMENTS_EVERY = 45 * 60
DATA_EVERY = 12 * 3600
_started = False


def enabled() -> bool:
    return bool(db.get("auto_sync", True))


def _tick() -> None:
    if not enabled():
        return
    t = db.now()
    if t - (db.get(f"synced:{engage.PLATFORM}") or 0) >= COMMENTS_EVERY and engage._logged_in():
        jobs.start("sync", engage.PLATFORM, engage.sync)
    for p in data.platforms():
        pf = p["platform"]
        if not p.get("loggedIn"):
            continue
        key = f"data_at:{pf}"
        if t - (db.get(key) or 0) >= DATA_EVERY:
            db.put(key, t)  # 失败了也等下一轮，不反复重试
            jobs.start("data", pf, lambda job, pf=pf: data.refresh(job, pf))


def _loop() -> None:
    time.sleep(180)
    while True:
        try:
            _tick()
        except Exception:
            pass  # 定时任务出错不能影响软件本身
        time.sleep(300)


def start() -> None:
    global _started
    # 只在桌面版里跑（有 DAZI_DATA_DIR）；开发时单独启动的后端设 DAZI_DEV=1 不跑
    if _started or not os.environ.get("DAZI_DATA_DIR") or os.environ.get("DAZI_DEV"):
        return
    _started = True
    threading.Thread(target=_loop, daemon=True, name="dazi-scheduler").start()
