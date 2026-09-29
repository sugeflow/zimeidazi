"""把 upstream/Easel 整理成随安装包分发的应用代码。

- 去掉 README 素材、官网展示素材、测试、git 元数据等（约 435MB）
- 构建我们自己的前端（仓库根目录 frontend/，复制自上游后重构），替换上游前端，只保留 dist
- 按顺序打上 patches/*.patch

用法：
    python scripts/stage_easel.py --out build/easel
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "upstream" / "Easel"
IS_WIN = sys.platform == "win32"

# 相对 Easel 根目录的路径；目录或文件都可以
EXCLUDE = [
    ".git", ".github", "assets/readme", "web/static/showcase", "tests",
    "outputs", "setup.sh", "setup.ps1", "pytest.ini", "CONTRIBUTING.md", "CHANGELOG.md",
    "README_EN.md", "web/frontend",  # 上游前端整个不要，换成我们构建好的 dist
]
EXCLUDE_NAMES = {"__pycache__", "node_modules", ".DS_Store", ".pytest_cache"}


def log(msg: str) -> None:
    print(f"[stage] {msg}", flush=True)


def ignore(src: str, names: list[str]) -> set[str]:
    rel = Path(src).resolve().relative_to(UPSTREAM.resolve())
    skipped = {n for n in names if n in EXCLUDE_NAMES}
    for n in names:
        if (rel / n).as_posix() in EXCLUDE:
            skipped.add(n)
    return skipped


def build_frontend(out: Path, work: Path) -> None:
    src = ROOT / "frontend"
    fe = work / "frontend"
    shutil.rmtree(fe, ignore_errors=True)
    shutil.copytree(src, fe, ignore=shutil.ignore_patterns("node_modules", "dist"))
    npm = "npm.cmd" if IS_WIN else "npm"
    log("构建前端 …")
    subprocess.run([npm, "ci", "--no-audit", "--no-fund", "--loglevel", "error"], cwd=fe, check=True)
    subprocess.run([npm, "run", "build"], cwd=fe, check=True)
    shutil.copytree(fe / "dist", out / "web" / "frontend" / "dist")
    shutil.rmtree(work, ignore_errors=True)


def apply_patches(out: Path) -> None:
    patches = sorted((ROOT / "patches").glob("*.patch"))
    # out 位于本仓库内部，git 会把补丁路径当成相对仓库根目录，并静默跳过目录外的文件。
    # 设置 GIT_CEILING_DIRECTORIES 让 git 找不到外层仓库，按普通目录打补丁。
    env = dict(os.environ, GIT_CEILING_DIRECTORIES=str(out.parent))
    for p in patches:
        log(f"打补丁 {p.name}")
        subprocess.run(["git", "apply", "--whitespace=nowarn", str(p)], cwd=out, env=env, check=True)
        # 反向检查能通过，才说明补丁确实打上了
        subprocess.run(["git", "apply", "--check", "--reverse", str(p)], cwd=out, env=env, check=True)
    if not patches:
        log("没有补丁需要打")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ROOT / "build" / "easel")
    args = ap.parse_args()
    out = args.out.resolve()

    if not (UPSTREAM / "web" / "app.py").is_file():
        raise SystemExit("upstream/Easel 为空，请先执行 git submodule update --init")

    shutil.rmtree(out, ignore_errors=True)
    log(f"复制上游代码 → {out}")
    shutil.copytree(UPSTREAM, out, ignore=ignore, symlinks=True)
    (out / "outputs").mkdir()
    build_frontend(out, out.parent / "_frontend_work")
    apply_patches(out)

    rev = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=UPSTREAM,
                         capture_output=True, text=True).stdout.strip()
    (out / ".upstream-rev").write_text(rev + "\n", encoding="utf-8")
    # 内容指纹：分发的代码只要有任何变化就会变。桌面壳据此判断是否要把新代码同步到用户数据目录
    # （只看版本号和上游 commit 不够：只改我们自己的前端或补丁时，这两个都不变）
    h = hashlib.sha256()
    for f in sorted(p for p in out.rglob("*") if p.is_file() and p.name != ".build-id"):
        h.update(f.relative_to(out).as_posix().encode())
        h.update(f.read_bytes())
    build_id = h.hexdigest()[:16]
    (out / ".build-id").write_text(build_id + "\n", encoding="utf-8")
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    log(f"完成：上游 {rev}，内容指纹 {build_id}，共 {size / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
