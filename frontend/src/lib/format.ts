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

/** 对话出错时给用户看的话；原始报错收在「详情」里，排查时再看 */
export function friendlyError(raw: string): { title: string; desc: string } {
  const s = raw.toLowerCase();
  if (/会员已到期|已被停用/.test(raw)) {
    return { title: '会员到期了', desc: '到「设置 → 会员」输入新的激活码续费，就能接着用。' };
  }
  if (/本月.*额度用完/.test(raw)) {
    const m = raw.match(/本月.*额度用完了[^"'}]*/);
    return { title: '本月额度用完了', desc: `${m ? m[0] : ''}。下个月 1 号自动恢复。` };
  }
  if (/还没有激活|激活信息失效/.test(raw)) {
    return { title: '还没有激活', desc: '到「设置 → 会员」输入激活码。' };
  }
  if (/insufficient balance|billing|quota|余额|402/.test(s)) {
    return { title: '模型额度用完了', desc: '搭子用的 AI 模型账户余额不足，充值后点「重试」就能继续。' };
  }
  if (/api key|unauthori[sz]ed|invalid_api_key|401|403/.test(s)) {
    return { title: '模型连接没通过验证', desc: '模型的密钥可能失效了。请联系客服，或稍后再试。' };
  }
  if (/rate limit|429|too many/.test(s)) {
    return { title: '请求太频繁了', desc: '模型那边有点忙，等一两分钟再点「重试」。' };
  }
  if (/timeout|timed out|超时|econn|network|failed to fetch|连接中断/.test(s)) {
    return { title: '网络不太顺', desc: '和搭子的连接断了一下，检查网络后点「重试」。' };
  }
  return { title: '这一步没做成', desc: '点「重试」再来一次；一直不行的话，把详情发给客服。' };
}

/** 文件大小：1.2 GB / 356 MB / 12 KB */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}
