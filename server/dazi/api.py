"""/api/dazi/*：设置页用到的信息和操作。之后的运营功能（互动、数据）也放在这个包里。"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]  # 应用代码目录（数据目录下的 app/）
router = APIRouter(prefix="/api/dazi")


def _dir(env: str, fallback: Path) -> Path:
    v = os.environ.get(env)
    return Path(v) if v else fallback


def _folders() -> dict[str, Path]:
    data = _dir("DAZI_DATA_DIR", ROOT.parent)
    return {
        "outputs": ROOT / "outputs",
        "logs": _dir("DAZI_LOGS_DIR", data / "logs"),
        "data": data,
    }


def _size(path: Path) -> int:
    total = 0
    stack = [path]
    while stack:
        try:
            with os.scandir(stack.pop()) as it:
                for e in it:
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(Path(e.path))
                        elif e.is_file(follow_symlinks=False):
                            total += e.stat(follow_symlinks=False).st_size
                    except OSError:
                        pass
        except OSError:
            pass
    return total


@router.get("/info")
def info() -> dict:
    f = _folders()
    return {
        "version": os.environ.get("DAZI_APP_VERSION", "dev"),
        "platform": sys.platform,
        "outputsDir": str(f["outputs"]),
        "outputsBytes": _size(f["outputs"]),
        "dataDir": str(f["data"]),
    }


class OpenReq(BaseModel):
    target: str
    path: str = ""  # 只对 outputs 有效：作品库里的相对路径


@router.post("/open")
def open_folder(req: OpenReq) -> dict:
    # 只能打开固定的几个目录，不接受任意路径
    base = _folders().get(req.target)
    if base is None:
        raise HTTPException(400, "不支持打开这个位置")
    base.mkdir(parents=True, exist_ok=True)
    path = base
    if req.path and req.target == "outputs":
        path = (base / req.path).resolve()
        # 不允许用 ../ 之类跳出作品目录
        if not path.is_relative_to(base.resolve()) or not path.exists():
            raise HTTPException(404, "找不到这个作品")
        if path.is_file():
            path = path.parent
    if sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(path)])
    return {"ok": True}
