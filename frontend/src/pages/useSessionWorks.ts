// 找出「这次创作」做出来的作品：对话里提到的，加上每一轮生成期间新改动过的。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchOutputs } from '../lib/api';
import type { OutputNode } from '../lib/api';
import type { ChatSession } from '../lib/store';

/** 后端的修改时间可能是秒，也可能是毫秒 */
const ms = (t?: number) => (!t ? 0 : t < 1e12 ? t * 1000 : t);

/** 目录里最新一个文件的修改时间（目录自己的时间只在增删直接子项时才变） */
export function latestMtime(n: OutputNode): number {
  let m = ms(n.mtime);
  for (const c of n.children ?? []) m = Math.max(m, latestMtime(c));
  return m;
}

const MENTION = /(?<![A-Za-z0-9.])outputs[\\/]([^\\/\s`|<>"'“”‘’()[\]{}:,;，。；：！？、（）【】《》「」*]+)/g;

/** 对话正文里提到的作品（outputs 下的第一级名字） */
export function mentionedNames(session: ChatSession): string[] {
  const names = new Set<string>();
  for (const m of session.messages) {
    if (m.role !== 'assistant' || !m.content.includes('outputs')) continue;
    for (const hit of m.content.matchAll(MENTION)) names.add(hit[1].replace(/[.~～]+$/, ''));
  }
  return [...names];
}

const internal = (name: string) => name.startsWith('_') || name.startsWith('.');

export function useSessionWorks(session: ChatSession, streaming: boolean) {
  const [roots, setRoots] = useState<OutputNode[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(() => {
    fetchOutputs().then((r) => { setRoots(r); setNow(Date.now()); }).catch(() => setRoots((x) => x ?? []));
  }, []);

  // 生成中每 5 秒看一次有没有新作品；结束或新消息时再看一次
  useEffect(() => {
    reload();
    if (!streaming) return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload, streaming, session.id, session.messages.length]);

  const works = useMemo(() => {
    if (!roots) return [];
    const mentioned = new Set(mentionedNames(session));
    const windows = (session.turns ?? []).map(([a, b]) => [a - 2000, (b || now) + 5000]);
    const picked = roots.filter((n) => {
      if (internal(n.name)) return false;
      if (mentioned.has(n.name)) return true;
      const t = latestMtime(n);
      return windows.some(([a, b]) => t >= a && t <= b);
    });
    return picked.sort((a, b) => latestMtime(b) - latestMtime(a));
  }, [roots, session, now]);

  return { works, loaded: roots !== null, reload };
}
