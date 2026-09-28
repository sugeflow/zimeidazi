"""构建「运行时包」和「浏览器包」。

在 CI（或本机）上把 Python + 全部依赖、Node + OpenClaw、FFmpeg 预先装好，
打成 tar.zst，用户电脑上只需下载解压。版本全部来自 runtime/versions.json。

用法：
    python runtime/build_runtime.py --platform mac-arm64 --out build/runtime
    python runtime/build_runtime.py --platform win-x64   --out build/runtime --skip-browsers

产物（--out 目录下）：
    stage/runtime/                  解压后的样子（冒烟测试直接用它）
    stage/browsers/                 Playwright 浏览器
    zimeidazi-runtime-<平台>-r<版本>.tar.zst
    zimeidazi-browsers-<平台>-pw<版本>.tar.zst
    manifest-<平台>.json            文件名、大小、sha256
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSIONS = json.loads((ROOT / "runtime" / "versions.json").read_text(encoding="utf-8"))
IS_WIN = sys.platform == "win32"


def log(msg: str) -> None:
    print(f"[runtime] {msg}", flush=True)


def download(url: str, cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    dest = cache / url.rsplit("/", 1)[-1]
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    log(f"下载 {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "zimeidazi-build"})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            tmp.replace(dest)
            return dest
        except Exception as e:  # noqa: BLE001 — 网络抖动重试
            log(f"  第 {attempt + 1} 次失败：{e}")
            time.sleep(3)
    raise SystemExit(f"下载失败：{url}")


def extract(archive: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            z.extractall(dest)
    else:
        with tarfile.open(archive) as t:
            t.extractall(dest, filter="tar")


def only_child(d: Path) -> Path:
    kids = [p for p in d.iterdir() if not p.name.startswith(".")]
    if len(kids) != 1:
        raise SystemExit(f"预期 {d} 下只有一个目录，实际：{[k.name for k in kids]}")
    return kids[0]


def run(cmd: list[str], **kw) -> None:
    log("$ " + " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def python_exe(rt: Path) -> Path:
    return rt / "python" / ("python.exe" if IS_WIN else "bin/python3")


def node_exe(rt: Path) -> Path:
    return rt / "node" / ("node.exe" if IS_WIN else "bin/node")


def npm_cli(rt: Path) -> Path:
    base = rt / "node" if IS_WIN else rt / "node" / "lib"
    return base / "node_modules" / "npm" / "bin" / "npm-cli.js"


def openclaw_mjs(rt: Path) -> Path:
    base = rt / "node" if IS_WIN else rt / "node" / "lib"
    return base / "node_modules" / "openclaw" / "openclaw.mjs"


# ---------------------------------------------------------------- 各组件

def build_python(plat: str, rt: Path, cache: Path) -> None:
    py = VERSIONS["python"]
    url = py["url"].format(version=py["version"], pbs_release=py["pbs_release"],
                           triple=VERSIONS["platforms"][plat]["triple"])
    extract(download(url, cache), rt)  # 解压出 rt/python/
    exe = python_exe(rt)
    # Easel 的技能脚本里大量写的是 `python3 xxx.py`，Windows 版 Python 没有 python3.exe
    if IS_WIN:
        shutil.copy2(exe, exe.with_name("python3.exe"))
    else:
        link = exe.with_name("python")
        if not link.exists():
            link.symlink_to("python3")

    lock = ROOT / "runtime" / "locks" / f"{plat}.txt"
    run(["uv", "pip", "install", "--python", exe, "--break-system-packages",
         "--no-cache", "-r", lock])
    # 字节码缓存让用户电脑首次运行时再生成，包更小
    for junk in (rt / "python").rglob("__pycache__"):
        shutil.rmtree(junk, ignore_errors=True)


def build_node(plat: str, rt: Path, cache: Path) -> None:
    node = VERSIONS["node"]
    url = node["url"][plat].format(version=node["version"])
    tmp = rt / "_node"
    extract(download(url, cache), tmp)
    only_child(tmp).rename(rt / "node")
    tmp.rmdir()
    # 全局安装到 Node 自己的目录里：Easel 的 openclaw_cmd.py 会在
    # <node 目录>/node_modules（Windows）或 <node 目录>/../lib/node_modules（mac）找 openclaw.mjs
    # 包的安装脚本会直接调 PATH 里的 node，必须让内置 Node 排在最前，否则会用到系统的旧版本
    env = dict(os.environ, npm_config_update_notifier="false", npm_config_fund="false",
               npm_config_audit="false",
               PATH=os.pathsep.join([str(node_exe(rt).parent), os.environ.get("PATH", "")]))
    run([node_exe(rt), npm_cli(rt), "install", "-g", "--prefix", rt / "node",
         f"openclaw@{VERSIONS['openclaw']['version']}", "--loglevel", "warn"], env=env)
    if not openclaw_mjs(rt).is_file():
        raise SystemExit(f"OpenClaw 安装后找不到 {openclaw_mjs(rt)}")


def build_ffmpeg(plat: str, rt: Path, cache: Path) -> None:
    bindir = rt / "bin"
    bindir.mkdir(parents=True, exist_ok=True)
    wanted = {"ffmpeg.exe", "ffprobe.exe"} if IS_WIN else {"ffmpeg", "ffprobe"}
    for url in VERSIONS["ffmpeg"][plat]["urls"]:
        with zipfile.ZipFile(download(url, cache)) as z:
            for info in z.infolist():
                name = info.filename.rsplit("/", 1)[-1]
                if name in wanted:
                    target = bindir / name
                    target.write_bytes(z.read(info))
                    target.chmod(0o755)
    missing = wanted - {p.name for p in bindir.iterdir()}
    if missing:
        raise SystemExit(f"FFmpeg 压缩包里缺少：{missing}")


def build_browsers(rt: Path, browsers: Path) -> str:
    env = dict(os.environ, PLAYWRIGHT_BROWSERS_PATH=str(browsers))
    run([python_exe(rt), "-m", "playwright", "install", "chromium"], env=env)
    out = subprocess.run([python_exe(rt), "-m", "playwright", "--version"],
                         capture_output=True, text=True, check=True).stdout
    return out.strip().split()[-1]


# ---------------------------------------------------------------- 打包

def pack(src: Path, arcname: str, out: Path) -> dict:
    try:
        from compression import zstd  # Python 3.14+
        def opener(f):
            return zstd.ZstdFile(f, "wb", level=10)
    except ImportError:
        import zstandard  # pip install zstandard
        def opener(f):
            return zstandard.ZstdCompressor(level=10, threads=-1).stream_writer(f)

    log(f"打包 {out.name} …")
    with open(out, "wb") as raw:
        zf = opener(raw)
        with tarfile.open(fileobj=zf, mode="w|") as tar:
            tar.add(src, arcname=arcname)
        zf.close()
    h = hashlib.sha256()
    with open(out, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return {"file": out.name, "size": out.stat().st_size, "sha256": h.hexdigest()}


def dir_size(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file() and not f.is_symlink())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", required=True, choices=sorted(VERSIONS["platforms"]))
    ap.add_argument("--out", type=Path, default=ROOT / "build" / "runtime")
    ap.add_argument("--skip-browsers", action="store_true")
    ap.add_argument("--no-pack", action="store_true", help="只生成 stage 目录，不打压缩包")
    args = ap.parse_args()

    expected = "win-x64" if IS_WIN else "mac-arm64"
    if args.platform != expected:
        raise SystemExit(f"运行时包必须在目标平台上构建：当前机器只能构建 {expected}")

    out = args.out.resolve()
    cache = out / "cache"
    stage = out / "stage"
    rt, browsers = stage / "runtime", stage / "browsers"
    shutil.rmtree(stage, ignore_errors=True)
    rt.mkdir(parents=True)

    t0 = time.time()
    build_python(args.platform, rt, cache)
    build_node(args.platform, rt, cache)
    build_ffmpeg(args.platform, rt, cache)
    pw_version = None if args.skip_browsers else build_browsers(rt, browsers)

    info = {
        "runtime_version": VERSIONS["runtime_version"],
        "platform": args.platform,
        "python": VERSIONS["python"]["version"],
        "node": VERSIONS["node"]["version"],
        "openclaw": VERSIONS["openclaw"]["version"],
        "playwright": pw_version,
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (rt / "runtime.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"运行时目录 {dir_size(rt) / 1e6:.0f} MB；浏览器目录 "
        f"{dir_size(browsers) / 1e6 if browsers.exists() else 0:.0f} MB；用时 {time.time() - t0:.0f}s")

    if args.no_pack:
        return
    manifest = dict(info, files={})
    manifest["files"]["runtime"] = pack(
        rt, "runtime", out / f"zimeidazi-runtime-{args.platform}-r{info['runtime_version']}.tar.zst")
    if pw_version:
        manifest["files"]["browsers"] = pack(
            browsers, "browsers", out / f"zimeidazi-browsers-{args.platform}-pw{pw_version}.tar.zst")
    (out / f"manifest-{args.platform}.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    for k, v in manifest["files"].items():
        log(f"{k}: {v['file']}  {v['size'] / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
