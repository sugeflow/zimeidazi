"""本地数据库。每次调用开一个短连接；后台线程和接口线程都能用。"""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # 应用代码目录
DB = ROOT / "outputs" / "_dazi" / "ops.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
  platform TEXT, note_id TEXT, title TEXT, cover TEXT, url TEXT, synced_at INTEGER,
  PRIMARY KEY (platform, note_id)
);
CREATE TABLE IF NOT EXISTS comments (
  platform TEXT, id TEXT, note_id TEXT, parent TEXT, nickname TEXT, content TEXT,
  time INTEGER, likes TEXT, loc TEXT,
  status TEXT DEFAULT 'new',   -- new 待回复 / replied 已回复 / ignored 忽略 / old 同步前就有的旧评论
  draft TEXT DEFAULT '', error TEXT DEFAULT '', fetched_at INTEGER, replied_at INTEGER,
  PRIMARY KEY (platform, id)
);
CREATE INDEX IF NOT EXISTS comments_status ON comments (status);
CREATE TABLE IF NOT EXISTS snapshots (
  platform TEXT, ts INTEGER, followers INTEGER, likes INTEGER, posts INTEGER, data TEXT
);
CREATE INDEX IF NOT EXISTS snapshots_pf ON snapshots (platform, ts);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
"""

_ready = False


@contextmanager
def conn():
    global _ready
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    try:
        if not _ready:
            c.execute("PRAGMA journal_mode=WAL")
            c.executescript(SCHEMA)
            _ready = True
        yield c
        c.commit()
    finally:
        c.close()


def get(key: str, default=None):
    with conn() as c:
        row = c.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def put(key: str, value) -> None:
    with conn() as c:
        c.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (key, json.dumps(value, ensure_ascii=False)))


def now() -> int:
    return int(time.time())
