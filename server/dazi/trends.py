"""热点的官方数据源。上游用的第三方聚合接口（60s.viki.moe）经常 403，
知乎和头条没有备用源，这里直接读两家公开的热榜接口（见 patches/0003）。"""

from __future__ import annotations

import json
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"


def _get(url: str, timeout: int = 8):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _zhihu() -> list[dict]:
    out = []
    for it in _get("https://api.zhihu.com/topstory/hot-lists/total?limit=50").get("data", []):
        t = it.get("target") or {}
        if not t.get("title"):
            continue
        hot = str(it.get("detail_text") or "").replace("热度", "").replace(" ", "").strip()
        out.append({"title": t["title"], "hot": hot, "url": f"https://www.zhihu.com/question/{t.get('id')}" if t.get("id") else ""})
    return out


def _toutiao() -> list[dict]:
    out = []
    for it in _get("https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc").get("data", []):
        if it.get("Title"):
            out.append({"title": it["Title"], "hot": str(it.get("HotValue") or ""), "url": it.get("Url") or ""})
    return out


OFFICIAL = {"zhihu": _zhihu, "toutiao": _toutiao}


def official_hot(platform: str) -> list[dict]:
    """有官方源的平台先用官方源；失败返回空列表，交给上游的第三方源兜底"""
    fn = OFFICIAL.get(platform)
    if not fn:
        return []
    try:
        return fn()
    except Exception:
        return []
