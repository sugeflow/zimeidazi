"""直接调用对话模型（OpenAI 兼容接口），用于起草回复这类短任务，比走完整的 Agent 快得多。
模型地址和密钥读 <app>/.env 里的 DAZI_LLM_*，和 Agent 用的是同一套（M3 起换成搭子云的地址和令牌）。"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class LLMError(Exception):
    pass


def _env() -> dict[str, str]:
    out: dict[str, str] = {}
    f = ROOT / ".env"
    if f.is_file():
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def chat(messages: list[dict], *, json_mode: bool = False, timeout: int = 90) -> str:
    env = _env()
    base, key, model = (env.get(k, "") for k in ("DAZI_LLM_BASE_URL", "DAZI_LLM_API_KEY", "DAZI_LLM_MODEL"))
    if not (base and key and model):
        raise LLMError("还没有配置模型（激活后自动配置）")
    body: dict = {"model": model, "messages": messages, "temperature": 0.8}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(
        base.rstrip("/") + "/chat/completions", data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise LLMError(f"模型返回错误（{e.code}）：{detail}") from None
    except (urllib.error.URLError, TimeoutError) as e:
        raise LLMError(f"连不上模型：{e}") from None
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise LLMError("模型返回的内容看不懂") from None


def persona_text(name: str, limit: int = 3000) -> str:
    """账号定位里和说话方式有关的几项，给起草回复参考"""
    if not name:
        return ""
    d = ROOT / "profiles" / name
    if not d.is_dir() or name.startswith((".", "_")) or "/" in name or "\\" in name:
        return ""
    parts = []
    for f in ("identity.md", "style.md", "audience.md", "preferences.md"):
        p = d / f
        if p.is_file():
            parts.append(p.read_text(encoding="utf-8", errors="replace").strip())
    return "\n\n".join(parts)[:limit]
