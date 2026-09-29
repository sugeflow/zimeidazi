// 「今天」页的数据：待处理事项、热点、本周排期、最近作品。
// 待处理数量同时用于导航角标，所以放在 App 里调用一次，结果传给页面。
import { useCallback, useEffect, useState } from 'react';
import { fetchAccounts, fetchOutputs, fetchSchedule, fetchTrends } from '../lib/api';
import type { AccountItem, OutputNode, PersonaItem, ScheduleItem, TrendGroup } from '../lib/api';
import type { PageId, TabId } from '../shell/routes';

export interface Todo {
  id: string;
  tone: 'coral' | 'sun' | 'danger';
  emoji: string;
  title: string;
  desc: string;
  action: string;
  to: { page: PageId; tab?: TabId } | 'new-persona';
}

export interface TodayData {
  todos: Todo[];
  trends: TrendGroup[];
  week: ScheduleItem[];
  recent: OutputNode[];
  loaded: boolean;
  reload: () => void;
}

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 本周一到周日 */
export function weekDays(now = new Date()): Date[] {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
}

function buildTodos(personas: PersonaItem[] | null, accounts: AccountItem[] | null, schedule: ScheduleItem[]): Todo[] {
  const todos: Todo[] = [];
  if (personas && personas.length === 0) {
    todos.push({
      id: 'persona', tone: 'coral', emoji: '🧭', title: '先告诉搭子你的账号定位',
      desc: '做什么领域、给谁看，写出来的内容才像你', action: '去设置', to: 'new-persona',
    });
  }
  if (accounts && !accounts.some((a) => a.supported && a.loggedIn)) {
    todos.push({
      id: 'login', tone: 'sun', emoji: '🔑', title: '还没登录发布平台',
      desc: '登录小红书、抖音等，做好的内容才能一键发出去', action: '去登录', to: { page: 'accounts', tab: 'platforms' },
    });
  }
  const today = ymd(new Date());
  const due = schedule.filter((s) => (s.kind ?? 'content') === 'content' && s.date === today && s.status !== 'published');
  if (due.length) {
    todos.push({
      id: 'due', tone: 'coral', emoji: '📮', title: `今天有 ${due.length} 条要发`,
      desc: due.slice(0, 2).map((s) => s.title).join('、'), action: '去看看', to: { page: 'publish', tab: 'calendar' },
    });
  }
  return todos;
}

/** personas 为 null 表示还没加载完：此时不判断"缺少账号定位"，避免一闪而过的误提示 */
export function useToday(personas: PersonaItem[] | null): TodayData {
  const [accounts, setAccounts] = useState<AccountItem[] | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [trends, setTrends] = useState<TrendGroup[]>([]);
  const [recent, setRecent] = useState<OutputNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      fetchAccounts().then((v) => alive && setAccounts(v)),
      fetchSchedule().then((v) => alive && setSchedule(v)),
      fetchTrends('douyin,weibo,zhihu', 4).then((v) => alive && setTrends(v.trends)),
      fetchOutputs().then((v) => {
        if (!alive) return;
        // 最近的作品项目（顶层目录，_ 开头的是内部目录）
        const projects = v.filter((n) => n.type === 'dir' && !n.name.startsWith('_'));
        projects.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
        setRecent(projects.slice(0, 6));
      }),
    ]).finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, [tick]);

  const days = weekDays().map(ymd);
  const week = schedule.filter((s) => days.includes(s.date));
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { todos: buildTodos(personas, accounts, schedule), trends, week, recent, loaded, reload };
}
