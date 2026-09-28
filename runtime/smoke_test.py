"""冒烟测试：只用运行时包 + 浏览器包 + 整理好的 Easel 代码，把整条链路跑一遍。

检查项：
  1. 关键 Python 依赖能 import
  2. ffmpeg / ffprobe / node / openclaw 能执行
  3. Playwright Chromium 能无头启动
  4. 启动 OpenClaw gateway → /healthz
  5. 启动 Easel 后端 → /api/status 报告 gateway 在线、技能已加载

gateway 和后端的环境变量组装方式，就是 M2 桌面壳里要照搬的那一套。
测试使用临时 HOME，不会碰本机已有的 ~/.openclaw-easel。

用法：
    python runtime/smoke_test.py --runtime build/runtime/stage/runtime \
        --browsers build/runtime/stage/browsers --app build/easel
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

IS_WIN = sys.platform == "win32"
GATEWAY_PORT = 18789
WEB_PORT = 7860

IMPORTS = ["fastapi", "uvicorn", "cv2", "numpy", "PIL", "librosa", "rembg", "faster_whisper",
           "playwright", "edge_tts", "jieba", "snownlp", "pandas", "matplotlib", "biliup",
           "segno", "cryptography", "websocket"]


def log(msg: str) -> None:
    print(f"[smoke] {msg}", flush=True)


def paths(rt: Path) -> dict[str, Path]:
    if IS_WIN:
        return {"python": rt / "python" / "python.exe", "node": rt / "node" / "node.exe",
                "openclaw": rt / "node" / "node_modules" / "openclaw" / "openclaw.mjs",
                "path": [rt / "node", rt / "python", rt / "python" / "Scripts", rt / "bin"]}
    return {"python": rt / "python" / "bin" / "python3", "node": rt / "node" / "bin" / "node",
            "openclaw": rt / "node" / "lib" / "node_modules" / "openclaw" / "openclaw.mjs",
            "path": [rt / "node" / "bin", rt / "python" / "bin", rt / "bin"]}


def child_env(rt: Path, browsers: Path, app: Path, home: Path) -> dict[str, str]:
    p = paths(rt)
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join([str(x) for x in p["path"]] + [env.get("PATH", "")])
    env.update({
        "HOME": str(home), "USERPROFILE": str(home),
        "EASEL_ROOT": str(app),
        "EASEL_PORT": str(WEB_PORT),
        "PLAYWRIGHT_BROWSERS_PATH": str(browsers),
        "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "0",
        "EASEL_RAW_STREAM_PATH": str(home / "easel-raw-stream.jsonl"),
        "HF_ENDPOINT": "https://hf-mirror.com",
    })
    return env


def check(name: str, cmd: list, env: dict, timeout: int = 120) -> str:
    r = subprocess.run([str(c) for c in cmd], env=env, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=timeout)
    if r.returncode != 0:
        raise SystemExit(f"✗ {name} 失败（{r.returncode}）\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
    first = (r.stdout.strip() or r.stderr.strip()).splitlines()[0] if (r.stdout or r.stderr).strip() else ""
    log(f"✓ {name}  {first[:100]}")
    return r.stdout


def http_get(url: str, timeout: float = 3) -> tuple[int, str]:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


def wait_http(url: str, proc: subprocess.Popen, name: str, timeout: int) -> str:
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        if proc.poll() is not None:
            raise SystemExit(f"✗ {name} 进程提前退出（{proc.returncode}）")
        try:
            status, body = http_get(url)
            if status == 200:
                return body
        except Exception as e:  # noqa: BLE001
            last = str(e)
        time.sleep(1)
    raise SystemExit(f"✗ {name} {timeout}s 内没有就绪：{last}")


def kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if IS_WIN:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        try:
            os.killpg(proc.pid, 15)
        except ProcessLookupError:
            pass
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()


def spawn(cmd: list, env: dict, cwd: Path, log_file: Path) -> subprocess.Popen:
    kw: dict = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if IS_WIN else {"start_new_session": True}
    f = open(log_file, "w", encoding="utf-8")
    return subprocess.Popen([str(c) for c in cmd], env=env, cwd=cwd, stdout=f, stderr=subprocess.STDOUT, **kw)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runtime", type=Path, required=True)
    ap.add_argument("--browsers", type=Path, required=True)
    ap.add_argument("--app", type=Path, required=True)
    ap.add_argument("--keep-home", action="store_true")
    args = ap.parse_args()
    rt, browsers, app = args.runtime.resolve(), args.browsers.resolve(), args.app.resolve()
    p = paths(rt)
    home = Path(tempfile.mkdtemp(prefix="zmdz-smoke-"))
    env = child_env(rt, browsers, app, home)
    logs = home / "logs"
    logs.mkdir()
    procs: list[subprocess.Popen] = []
    t0 = time.time()

    try:
        log(f"运行时 {json.loads((rt / 'runtime.json').read_text(encoding='utf-8'))}")
        check("Python 依赖 import", [p["python"], "-c",
              f"import {', '.join(IMPORTS)}; print('{len(IMPORTS)} 个模块 OK')"], env, timeout=300)
        check("python3 命令", ["python3" if not IS_WIN else rt / "python" / "python3.exe", "--version"], env)
        check("ffmpeg", [shutil.which("ffmpeg", path=env["PATH"]), "-version"], env)
        check("ffprobe", [shutil.which("ffprobe", path=env["PATH"]), "-version"], env)
        check("node", [p["node"], "--version"], env)
        check("openclaw", [p["node"], p["openclaw"], "--version"], env)
        check("Easel 能找到 openclaw", [p["python"], "-c",
              "from easel.openclaw_cmd import openclaw_base_cmd as f; print(f())"], env | {"PYTHONPATH": str(app)})
        check("Chromium 无头启动", [p["python"], "-c",
              "from playwright.sync_api import sync_playwright as s\n"
              "with s() as pw:\n"
              "    b = pw.chromium.launch(); pg = b.new_page(); pg.set_content('<title>ok</title>')\n"
              "    print('Chromium', b.version, pg.title()); b.close()"], env, timeout=180)

        log("启动 OpenClaw gateway …")
        gw = spawn([p["node"], p["openclaw"], "--profile", "easel", "gateway", "run", "--force",
                    "--allow-unconfigured", "--bind", "loopback", "--port", GATEWAY_PORT],
                   env, app, logs / "gateway.log")
        procs.append(gw)
        wait_http(f"http://127.0.0.1:{GATEWAY_PORT}/healthz", gw, "gateway", 120)
        log(f"✓ gateway /healthz 正常（{time.time() - t0:.0f}s）")

        log("启动 Easel 后端 …")
        web = spawn([p["python"], app / "web" / "app.py"], env, app, logs / "web.log")
        procs.append(web)
        wait_http(f"http://127.0.0.1:{WEB_PORT}/", web, "后端首页", 120)
        _, body = http_get(f"http://127.0.0.1:{WEB_PORT}/api/status", timeout=30)
        status = json.loads(body)
        skills = status.get("skills") or []
        if not status.get("gateway"):
            raise SystemExit(f"✗ 后端报告 gateway 不在线：{body[:300]}")
        if len(skills) < 50:
            raise SystemExit(f"✗ 技能数量异常：{len(skills)}")
        log(f"✓ 后端正常：gateway 在线，已加载 {len(skills)} 个技能")
        log(f"全部通过，用时 {time.time() - t0:.0f}s")
    except BaseException:
        for f in sorted(logs.glob("*.log")):
            print(f"\n----- {f.name}（末尾） -----\n" + f.read_text(encoding="utf-8", errors="replace")[-4000:])
        raise
    finally:
        for proc in reversed(procs):
            kill_tree(proc)
        if not args.keep_home:
            shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    main()
