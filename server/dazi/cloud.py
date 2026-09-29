"""连接搭子云：用激活码换令牌、写进 .env、查询会员状态。

激活后 .env 里所有模型通道都指向搭子云（地址 + 令牌），真实的模型 Key 不在用户电脑上。
OpenClaw 的模型配置在软件启动时写入，所以激活后要重启一次软件才对 AI 创作生效。
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
DEVICE_FILE = ROOT / "outputs" / "_dazi" / "device.json"
CLOUD = os.environ.get("DAZI_CLOUD_URL", "https://dazi.suge.me").rstrip("/")

_cache: dict = {"at": 0.0, "data": None}


class CloudError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def device() -> dict:
    """本机标识：第一次生成后存在数据目录里，重装软件也不变"""
    try:
        return json.loads(DEVICE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = {"id": uuid.uuid4().hex, "name": (platform.node() or "我的电脑")[:40]}
        DEVICE_FILE.parent.mkdir(parents=True, exist_ok=True)
        DEVICE_FILE.write_text(json.dumps(d), encoding="utf-8")
        return d


def _call(path: str, body: dict | None = None, token: str = "", timeout: int = 15) -> dict:
    req = urllib.request.Request(CLOUD + path, data=json.dumps(body).encode() if body is not None else None,
                                 method="POST" if body is not None else "GET",
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8"))["error"]["message"]
        except Exception:
            msg = f"搭子云返回错误（{e.code}）"
        raise CloudError(e.code, msg) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise CloudError(0, "连不上搭子云，检查一下网络") from None


def _read_env() -> list[str]:
    return ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.is_file() else []


def token() -> str:
    for line in _read_env():
        if line.startswith("DAZI_CLOUD_TOKEN="):
            return line.split("=", 1)[1].strip()
    return ""


def _write_env(tok: str) -> None:
    base = CLOUD + "/v1"
    values = {
        "DAZI_CLOUD_TOKEN": tok,
        "DAZI_LLM_BASE_URL": base, "DAZI_LLM_API_KEY": tok, "DAZI_LLM_MODEL": "dazi-agent",
        "DAZI_FAST_BASE_URL": base, "DAZI_FAST_API_KEY": tok, "DAZI_FAST_MODEL": "dazi-fast",
        "IMG_BASE_URL": base, "IMG_API_KEY": tok, "IMG_MODEL": "dazi-image",
        "VIDEO_PROVIDER": "openai-compatible", "VIDEO_BASE_URL": base, "VIDEO_API_KEY": tok, "VIDEO_MODEL": "dazi-video",
    }
    if ENV_FILE.is_file():
        shutil.copy2(ENV_FILE, ENV_FILE.with_name(".env.before-activation"))
    lines = [ln for ln in _read_env() if ln.split("=", 1)[0].strip() not in values]
    lines += ["", "# 搭子云（激活后自动写入，所有模型都经搭子云）"] + [f"{k}={v}" for k, v in values.items()]
    tmp = ENV_FILE.with_suffix(".tmp")
    tmp.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(ENV_FILE)


def activate(code: str) -> dict:
    d = device()
    r = _call("/v1/dazi/activate", {"code": code, "device": d["id"], "deviceName": d["name"]})
    _write_env(r["token"])
    _cache.update(at=0.0, data=None)
    return {"expiresAt": r.get("expiresAt")}


def membership(force: bool = False) -> dict:
    tok = token()
    if not tok:
        return {"activated": False}
    if not force and _cache["data"] and time.time() - _cache["at"] < 300:
        return _cache["data"]
    try:
        me = _call("/v1/dazi/me", token=tok, timeout=8)
        pct = max((me["used"].get(k, 0) * 100 // max(1, q) for k, q in me["quota"].items()), default=0)
        data = {"activated": True, "state": "ok", "daysLeft": me["daysLeft"], "expiresAt": me["expiresAt"],
                "used": me["used"], "quota": me["quota"], "usedPct": min(100, pct), "code": me.get("code", "")}
    except CloudError as e:
        state = "offline" if e.status == 0 else "expired" if e.status == 403 else "invalid"
        data = {"activated": True, "state": state, "message": str(e)}
    _cache.update(at=time.time(), data=data)
    return data
