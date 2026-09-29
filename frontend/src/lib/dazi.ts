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
