// 数据：各平台的粉丝、获赞、作品数和变化，最近作品的表现；一键让搭子复盘。
import { useCallback, useEffect, useState } from 'react';
import { dataOverview, dataRefresh, waitJob } from '../lib/dazi';
import type { PlatformData, SeriesPoint } from '../lib/dazi';
import { Button, Card, EmptyState, ErrorState, Loading } from '../ui';
import { IconRefresh } from '../components/icons';

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万` : String(n);

function Delta({ v, label }: { v: number | null; label: string }) {
  if (v == null) return null;
  return <span className={`dz-delta${v > 0 ? ' is-up' : v < 0 ? ' is-down' : ''}`}>{label} {v > 0 ? `+${v}` : v}</span>;
}

/** 粉丝走势的小折线；少于两天的数据时不画 */
function Trend({ points, name }: { points: SeriesPoint[]; name: string }) {
  const ys = points.map((p) => p.followers).filter((v): v is number => v != null);
  if (ys.length < 2) return <p className="dz-muted dz-trend-hint">每天会自动记一次，过两天就能看到粉丝走势。</p>;
  const w = 280, h = 56, pad = 4;
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const xy = ys.map((y, i) => [pad + (i * (w - pad * 2)) / (ys.length - 1), h - pad - ((y - min) * (h - pad * 2)) / span]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx] = xy[xy.length - 1];
  return (
    <figure className="dz-spark">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${name}最近 ${ys.length} 天粉丝从 ${ys[0]} 到 ${ys[ys.length - 1]}`}>
        <path d={`${d} L${lx},${h} L${pad},${h} Z`} className="dz-spark__area" />
        <path d={d} className="dz-spark__line" />
        
      </svg>
      <figcaption className="dz-muted">最近 {ys.length} 天粉丝</figcaption>
    </figure>
  );
}

function reviewPrompt(p: PlatformData) {
  const d = p.latest!;
  const notes = (d.notes ?? []).slice(0, 8).map((n) => `- ${n.title}${n.stat ? `（${n.stat}）` : ''}`).join('\n');
  const metrics = (d.metrics ?? []).map((m) => `${m.label} ${m.value}`).join('，');
  return `帮我复盘一下我的${p.name}账号：\n粉丝 ${d.followers ?? '未知'}，获赞 ${d.likes ?? '未知'}，作品 ${d.posts ?? '未知'}` +
    `${p.delta.followers.week != null ? `，这周粉丝变化 ${p.delta.followers.week}` : ''}。\n${metrics ? `近期数据：${metrics}\n` : ''}` +
    `${notes ? `最近的作品：\n${notes}\n` : ''}\n请告诉我：哪篇表现最好、为什么；有什么问题；下一步具体该做哪 3 件事。`;
}

function PlatformCard({ p, onRefresh, onReview }: { p: PlatformData; onRefresh: () => void; onReview: () => void }) {
  const d = p.latest;
  const busy = p.jobs.length > 0;
  return (
    <Card className="dz-data">
      <header className="dz-data__head">
        <div>
          <b>{p.name}</b>
          {d?.nickname && <span>@{d.nickname}</span>}
        </div>
        <span className="dz-muted">{busy ? p.jobs[0].message : p.updated ? `${new Date(p.updated * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新` : '还没读取过'}</span>
        <Button size="sm" variant="ghost" icon={<IconRefresh size={14} />} onClick={onRefresh} loading={busy}>刷新</Button>
      </header>

      {!d ? (
        <p className="dz-muted">点「刷新」读一次数据（要打开一次网页，十几秒）。</p>
      ) : (
        <>
          <div className="dz-data__nums">
            {([['粉丝', 'followers'], ['获赞', 'likes'], ['作品', 'posts']] as const).map(([label, k]) => (
              <div key={k}>
                <span>{label}</span>
                <b>{fmt(d[k])}</b>
                <Delta v={p.delta[k].week} label="本周" />
              </div>
            ))}
          </div>
          <Trend points={p.series} name={p.name} />
          {d.metrics?.length > 0 && (
            <div className="dz-data__metrics">{d.metrics.map((m) => <span key={m.label}>{m.label} <b>{m.value}</b></span>)}</div>
          )}
          {d.notes?.length > 0 && (
            <ol className="dz-data__notes">
              {d.notes.slice(0, 5).map((n) => (
                <li key={n.url || n.title}>
                  {n.cover ? <img src={n.cover} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="dz-data__nocover" />}
                  <span><b>{n.title}</b>{n.stat && <small>{n.stat}</small>}</span>
                </li>
              ))}
            </ol>
          )}
          <footer><Button variant="secondary" onClick={onReview}>让搭子帮我复盘</Button></footer>
        </>
      )}
    </Card>
  );
}

export default function DataPage({ onLogin, onReview }: { onLogin: () => void; onReview: (prompt: string) => void }) {
  const [list, setList] = useState<PlatformData[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    dataOverview().then((l) => { setList(l); setFailed(false); }).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const refresh = async (pf: string) => {
    try {
      const job = await dataRefresh(pf);
      load();
      await waitJob(job);
    } finally { load(); }
  };

  if (failed) return <div className="dz-page"><ErrorState title="数据没加载出来" desc="搭子可能还在启动，稍等几秒再试。" actions={<Button onClick={load}>重试</Button>} /></div>;
  if (!list) return <div className="dz-page"><Loading title="正在打开…" /></div>;

  const on = list.filter((p) => p.loggedIn);
  const off = list.filter((p) => !p.loggedIn);
  return (
    <div className="dz-page">
      <header>
        <h1 className="dz-title">数据</h1>
        <p className="dz-muted">已登录的平台每天自动记一次数据。想看最新的，点「刷新」。</p>
      </header>
      {on.length === 0 ? (
        <EmptyState title="还没有登录发布平台" desc="登录后，搭子每天帮你记一次粉丝、获赞和作品数据，还能帮你复盘。"
          actions={<Button variant="primary" onClick={onLogin}>去登录</Button>} />
      ) : (
        <div className="dz-data-grid">
          {on.map((p) => (
            <PlatformCard key={p.platform} p={p} onRefresh={() => void refresh(p.platform)} onReview={() => onReview(reviewPrompt(p))} />
          ))}
        </div>
      )}
      {on.length > 0 && off.length > 0 && (
        <p className="dz-muted">还没登录：{off.map((p) => p.name).join('、')}。<Button variant="link" onClick={onLogin}>去登录</Button></p>
      )}
    </div>
  );
}
