// 页面与页内标签。导航规划见 docs/design/UI-PLAN.md 第 2 节。

export type PageId =
  | 'today'
  | 'inspire' | 'create' | 'works'
  | 'publish' | 'engage' | 'data'
  | 'accounts' | 'skills' | 'settings';

export type TabId =
  // 找灵感
  | 'trends' | 'ideas' | 'breakdown' | 'bench'
  // 发布
  | 'center' | 'calendar' | 'records'
  // 账号与定位
  | 'platforms' | 'persona';

export const DEFAULT_TAB: Partial<Record<PageId, TabId>> = {
  inspire: 'trends',
  publish: 'center',
  accounts: 'platforms',
};

export type Navigate = (page: PageId, tab?: TabId) => void;
