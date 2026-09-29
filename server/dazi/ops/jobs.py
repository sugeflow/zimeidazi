"""后台任务：同一个平台的浏览器任务排队执行（共用一份登录态，同时开会冲突），状态可查询。"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
# DAZI_LOCAL_PORT 只在开发时用：让单独启动的测试后端去读正在运行的桌面版的数据
PORT = os.environ.get("DAZI_LOCAL_PORT") or os.environ.get("EASEL_PORT", "7860")

_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


class JobError(Exception):
    """给用户看的失败原因"""


def start(kind: str, platform: str, fn: Callable[[dict], str]) -> dict:
    """同一种任务在同一个平台上已经在跑，就直接返回那个任务"""
    with _jobs_lock:
        for j in _jobs.values():
            if j["kind"] == kind and j["platform"] == platform and j["state"] == "running":
                return dict(j)
        job = {"id": uuid.uuid4().hex[:12], "kind": kind, "platform": platform, "state": "running",
               "message": "排队中…", "started": int(time.time()), "ended": None}
        _jobs[job["id"]] = job

    def run():
        with _locks[platform]:
            job["message"] = "进行中…"
            try:
                job["message"] = fn(job) or "完成"
                job["state"] = "ok"
            except JobError as e:
                job["state"], job["message"] = "fail", str(e)
            except Exception as e:  # 意外错误也要结束任务，不能一直显示「进行中」
                job["state"], job["message"] = "fail", f"出错了：{e}"[:300]
            finally:
                job["ended"] = int(time.time())

    threading.Thread(target=run, daemon=True, name=f"dazi-{kind}-{platform}").start()
    return dict(job)


def running(kind: str | None = None, platform: str | None = None) -> list[dict]:
    with _jobs_lock:
        return [dict(j) for j in _jobs.values() if j["state"] == "running"
                and (kind is None or j["kind"] == kind) and (platform is None or j["platform"] == platform)]


def get(job_id: str) -> dict | None:
    with _jobs_lock:
        j = _jobs.get(job_id)
        return dict(j) if j else None


def script(name: str, *args: str, timeout: int = 300) -> subprocess.CompletedProcess:
    """用和后端同一个 Python 跑 Easel 自带的脚本"""
    try:
        return subprocess.run([sys.executable, str(SCRIPTS / name), *args], cwd=str(ROOT),
                              capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        raise JobError("等太久了，可能是网络慢或者平台要求验证，稍后再试")


def local(path: str, timeout: int = 60):
    """调用本机后端自己的接口（复用上游已有的登录态检查、数据抓取）"""
    import json
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))
