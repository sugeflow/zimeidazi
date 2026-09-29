// 主题偏好：浅色 / 深色 / 跟随系统。解析结果写到 <html data-theme>，样式见 styles/tokens.css。
// 首帧前的解析在 index.html 的内联脚本里，两处逻辑要保持一致。

export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'dz-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* 隐私模式等场景读不到，按跟随系统处理 */ }
  return 'system';
}

// 深色模式要等旧页面全部重写后才开放（旧样式里写死了浅色）；目前只有设计系统展示页可用。
// 与 index.html 内联脚本里的 DARK_READY 保持一致
const DARK_READY = () => location.hash === '#design';

function apply(pref: ThemePref) {
  const dark = DARK_READY() && (pref === 'dark' || (pref === 'system' && media.matches));
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function setThemePref(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* 忽略 */ }
  apply(pref);
}

// 跟随系统时，系统切换深浅色要实时生效
media.addEventListener('change', () => {
  if (getThemePref() === 'system') apply('system');
});
