// 自媒搭子自己的后端接口（/api/dazi/*，代码在 server/dazi）。上游接口在 api.ts，保持和上游一致。

export interface DaziInfo {
  version: string;
  platform: string;
  outputsDir: string;
  outputsBytes: number;
  dataDir: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch { /* 不是 JSON */ }
    throw new Error(detail || `请求失败（${res.status}）`);
  }
  return res.json() as Promise<T>;
}

export const fetchInfo = () => call<DaziInfo>('/api/dazi/info');

/** 用系统的文件管理器打开固定的几个目录；path 是作品库里的相对路径（只对 outputs 有效） */
export const openFolder = (target: 'outputs' | 'logs' | 'data', path = '') =>
  call<{ ok: boolean }>('/api/dazi/open', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, path }),
  });

// ---------------------------------------------------------------- 运营：后台任务

export interface Job {
  id: string; kind: string; platform: string;
  state: 'running' | 'ok' | 'fail'; message: string; started: number; ended: number | null;
}

export const fetchJob = (id: string) => call<Job>(`/api/dazi/jobs/${id}`);

/** 等后台任务结束；进行中每 2 秒回调一次最新状态 */
export async function waitJob(job: Job, onUpdate?: (j: Job) => void): Promise<Job> {
  let j = job;
  while (j.state === 'running') {
    await new Promise((r) => setTimeout(r, 2000));
    try { j = await fetchJob(j.id); } catch { /* 偶尔失败就下次再查 */ }
    onUpdate?.(j);
  }
  return j;
}

const post = <T>(url: string, body?: unknown, method = 'POST') => call<T>(url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

// ---------------------------------------------------------------- 互动（评论）

export interface EngageComment {
  id: string; note_id: string; parent: string; nickname: string; content: string;
  time: number; likes: string; loc: string;
  status: 'new' | 'replied' | 'ignored' | 'old'; draft: string; error: string;
  title: string | null; cover: string | null; url: string | null;
}

export interface EngageSummary {
  pending: number; lastSync: number | null; loggedIn: boolean; autoSync: boolean;
  quota: { used: number; limit: number; left: number };
  jobs: Job[];
}

export const engageSummary = () => call<EngageSummary>('/api/dazi/engage/summary');
export const engageComments = (status: 'pending' | 'replied' | 'ignored') =>
  call<EngageComment[]>(`/api/dazi/engage/comments?status=${status}`);
export const engageSync = () => post<Job>('/api/dazi/engage/sync');
export const engageDraft = (ids: string[], persona: string) =>
  post<{ drafts: Record<string, string> }>('/api/dazi/engage/draft', { ids, persona });
export const updateComment = (id: string, patch: { draft?: string; status?: 'new' | 'ignored' }) =>
  post<{ ok: boolean }>(`/api/dazi/engage/comments/${encodeURIComponent(id)}`, patch, 'PUT');
export const engageSend = (ids: string[]) => post<Job>('/api/dazi/engage/send', { ids });
export const setAutoSync = (enabled: boolean) => post<{ ok: boolean }>('/api/dazi/engage/auto', { enabled }, 'PUT');

// ---------------------------------------------------------------- 数据

export interface SeriesPoint { day: string; ts: number; followers: number | null; likes: number | null; posts: number | null }
export interface PlatformData {
  platform: string; name: string; loggedIn: boolean; updated: number | null;
  latest: import('./api').AccountAnalytics | null;
  series: SeriesPoint[];
  delta: Record<'followers' | 'likes' | 'posts', { day: number | null; week: number | null }>;
  jobs: Job[];
}

export const dataOverview = () => call<PlatformData[]>('/api/dazi/data/overview');
export const dataRefresh = (platform: string) => post<Job>(`/api/dazi/data/refresh/${platform}`);
