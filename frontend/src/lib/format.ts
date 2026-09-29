// 展示用的格式化小工具

/** 早上好 / 中午好 … 全应用统一用这一个 */
export function greeting(h = new Date().getHours()): string {
  if (h < 6) return '夜深了';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/** 热度：各平台格式不一（抖音给纯数字，微博给"179万"），纯数字统一换成万 / 亿 */
export function formatHot(hot: string): string {
  const s = hot.trim();
  if (!/^\d+$/.test(s)) return s;
  const n = Number(s);
  if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, '')}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '')}万`;
  return s;
}
