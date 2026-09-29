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


# ---------------------------------------------------------------- 运营：互动、数据

from .ops import data as ops_data, db as ops_db, engage, jobs as ops_jobs, llm, scheduler  # noqa: E402
from .ops.jobs import JobError  # noqa: E402

scheduler.start()


@router.get("/engage/summary")
def engage_summary() -> dict:
    return {**engage.summary(), "autoSync": scheduler.enabled()}


@router.get("/engage/comments")
def engage_comments(status: str = "pending") -> list[dict]:
    return engage.listing(status)


@router.post("/engage/sync")
def engage_sync() -> dict:
    return ops_jobs.start("sync", engage.PLATFORM, engage.sync)


class DraftReq(BaseModel):
    ids: list[str]
    persona: str = ""


@router.post("/engage/draft")
def engage_draft(req: DraftReq) -> dict:
    if not req.ids:
        return {"drafts": {}}
    try:
        return {"drafts": engage.draft(req.ids[:40], req.persona)}
    except llm.LLMError as e:
        raise HTTPException(502, str(e))


class CommentPatch(BaseModel):
    draft: str | None = None
    status: str | None = None


@router.put("/engage/comments/{cid}")
def engage_update(cid: str, req: CommentPatch) -> dict:
    engage.update(cid, req.draft, req.status)
    return {"ok": True}


class SendReq(BaseModel):
    ids: list[str]


@router.post("/engage/send")
def engage_send(req: SendReq) -> dict:
    try:
        engage.check_send(req.ids)
    except JobError as e:
        raise HTTPException(429, str(e))
    return ops_jobs.start("send", engage.PLATFORM, lambda job: engage.send(job, req.ids))


class AutoReq(BaseModel):
    enabled: bool


@router.put("/engage/auto")
def engage_auto(req: AutoReq) -> dict:
    ops_db.put("auto_sync", req.enabled)
    return {"ok": True}


@router.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    j = ops_jobs.get(job_id)
    if not j:
        raise HTTPException(404, "任务不存在")
    return j


@router.get("/data/overview")
def data_overview() -> list[dict]:
    return ops_data.overview()


@router.post("/data/refresh/{platform}")
def data_refresh(platform: str) -> dict:
    if platform not in {p["platform"] for p in ops_data.platforms()}:
        raise HTTPException(404, "这个平台暂时不支持看数据")
    return ops_jobs.start("data", platform, lambda job: ops_data.refresh(job, platform))


# ---------------------------------------------------------------- 会员（搭子云）

from . import cloud  # noqa: E402


@router.get("/membership")
def membership(refresh: bool = False) -> dict:
    return cloud.membership(force=refresh)


class ActivateReq(BaseModel):
    code: str


@router.post("/activate")
def activate(req: ActivateReq) -> dict:
    code = req.code.strip()
    if not code:
        raise HTTPException(400, "先输入激活码")
    try:
        return cloud.activate(code)
    except cloud.CloudError as e:
        raise HTTPException(502 if e.status == 0 else 400, str(e))
