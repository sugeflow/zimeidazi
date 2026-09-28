"""配置 OpenClaw，并把 Easel 的技能同步进 workspace。

移植自上游 setup.ps1 / setup.sh 中非交互的部分（Easel de08f20）。
由桌面壳在首次启动、以及每次应用或运行时升级后，用运行时自带的 Python 执行。
脚本可以重复执行，结果不变。

进度以 JSON 行输出到 stdout，供桌面壳显示：
    {"step": "onboard", "message": "初始化 Agent 配置"}

模型配置读取 <app>/.env 中以下键（M3 起由壳写入中转服务地址和令牌）：
    DAZI_LLM_BASE_URL  DAZI_LLM_API_KEY  DAZI_LLM_MODEL
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

IS_WIN = sys.platform == "win32"
PROFILE = "easel"
PROVIDER = "dazi"


def step(name: str, message: str) -> None:
    print(json.dumps({"step": name, "message": message}, ensure_ascii=False), flush=True)


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
    return values


class OpenClaw:
    def __init__(self, node: Path, mjs: Path, cwd: Path):
        self.base = [str(node), str(mjs), "--profile", PROFILE]
        self.cwd = cwd

    def run(self, *args: str, check: bool = True) -> subprocess.CompletedProcess:
        r = subprocess.run(self.base + list(args), cwd=self.cwd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        out = "\n".join(x for x in (r.stdout + r.stderr).splitlines() if x.strip() != "No change")
        if out.strip():
            print(out, file=sys.stderr, flush=True)
        if check and r.returncode != 0:
            raise SystemExit(f"openclaw {' '.join(args[:3])} 失败（{r.returncode}）")
        return r

    def batch(self, ops: list[dict]) -> None:
        fd, path = tempfile.mkstemp(prefix="dazi-config-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(ops, f, ensure_ascii=False)
            self.run("config", "set", "--batch-file", path)
        finally:
            os.unlink(path)


def link_dir(link: Path, target: Path) -> None:
    """workspace 里指向项目 profiles/outputs 的链接：Windows 用 Junction（不需要管理员权限），mac 用符号链接。"""
    target.mkdir(parents=True, exist_ok=True)
    if link.is_symlink() or os.path.isjunction(link):
        if Path(os.path.realpath(link)) == target.resolve():
            return
        os.rmdir(link) if os.path.isjunction(link) else os.unlink(link)  # 只删链接本身
    elif link.exists():
        # 不是链接的同名目录：挪开而不是删除，避免误删用户数据
        link.rename(link.with_name(link.name + ".bak"))
    if IS_WIN:
        import _winapi
        _winapi.CreateJunction(str(target), str(link))
    else:
        link.symlink_to(target, target_is_directory=True)


def resolve_workspace(app: Path) -> Path:
    r = subprocess.run([sys.executable, str(app / "easel" / "openclaw_workspace.py")], cwd=app,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    lines = [x for x in r.stdout.splitlines() if x.strip()]
    if r.returncode == 0 and lines:
        return Path(lines[-1].strip())
    return Path.home() / f".openclaw-{PROFILE}" / "workspace"


def sync_workspace(app: Path, ws: Path) -> None:
    skills = ws / "skills"
    skills.mkdir(parents=True, exist_ok=True)
    src = app / "skills" / "openclaw"
    for d in src.iterdir():
        dest = skills / d.name
        if d.is_dir():
            shutil.copytree(d, dest, dirs_exist_ok=True)
        else:
            shutil.copy2(d, dest)
    for md in (app / "openclaw" / "workspace").glob("*.md"):
        shutil.copy2(md, ws / md.name)
    (ws / "CONTEXT.md").write_text(
        "# Easel 项目路径\n\n"
        f"项目根目录：{app}\n"
        f"产物输出到：{app / 'outputs'}\n"
        f"用户素材在：{app / 'assets'}\n"
        f"用户画像在：{app / 'profiles'}\n", encoding="utf-8")
    shared = ws / "shared"
    shutil.rmtree(shared, ignore_errors=True)
    if (app / "skills" / "shared").is_dir():
        shutil.copytree(app / "skills" / "shared", shared)
    link_dir(ws / "easel-profiles", app / "profiles")
    link_dir(ws / "outputs", app / "outputs")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", type=Path, required=True, help="Easel 项目根目录（数据目录下的 app/）")
    ap.add_argument("--node", type=Path, required=True)
    ap.add_argument("--openclaw", type=Path, required=True, help="openclaw.mjs 路径")
    ap.add_argument("--log-file", type=Path, required=True, help="gateway 日志文件")
    args = ap.parse_args()
    app = args.app.resolve()
    oc = OpenClaw(args.node, args.openclaw, app)

    step("onboard", "初始化 Agent 配置")
    oc.run("onboard", "--non-interactive", "--mode", "local", "--accept-risk",
           "--skip-health", "--skip-channels", "--skip-skills", "--skip-ui", "--skip-hooks",
           "--skip-search", "--skip-daemon")

    step("skills", "同步创作技能")
    ws = resolve_workspace(app)
    sync_workspace(app, ws)

    step("config", "写入 Agent 配置")
    env = read_env(app / ".env")
    ops: list[dict] = [
        # 与上游 setup.ps1 一致
        {"path": "agents.defaults.timeoutSeconds", "value": 7200},
        {"path": "gateway.mode", "value": "local"},
        {"path": "gateway.bind", "value": "loopback"},
        {"path": "gateway.auth.mode", "value": "none"},
        {"path": "gateway.http.endpoints.chatCompletions.enabled", "value": True},
        {"path": "memory.search.enabled", "value": False},
        # 桌面版额外关闭：局域网广播、自动更新检查、遥测；日志放到我们的目录
        {"path": "plugins.entries.bonjour.enabled", "value": False},
        {"path": "discovery.mdns.mode", "value": "off"},
        {"path": "update.checkOnStart", "value": False},
        {"path": "telemetry.enabled", "value": False},
        {"path": "logging.file", "value": str(args.log_file)},
    ]
    base, key, model = (env.get(k, "").strip() for k in ("DAZI_LLM_BASE_URL", "DAZI_LLM_API_KEY", "DAZI_LLM_MODEL"))
    if base and key and model:
        ops += [
            {"path": f"models.providers.{PROVIDER}", "value": {
                "api": "openai-completions", "baseUrl": base, "apiKey": key, "timeoutSeconds": 600,
                "models": [{"id": model, "name": model, "reasoning": True, "input": ["text"]}],
            }},
            {"path": "agents.defaults.model.primary", "value": f"{PROVIDER}/{model}"},
        ]
        model_msg = f"模型：{model}"
    else:
        model_msg = "尚未配置模型（激活后自动配置）"
    oc.batch(ops)
    oc.run("config", "validate")
    step("done", f"Agent 配置完成 · {model_msg}")


if __name__ == "__main__":
    main()
