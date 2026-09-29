// 互动 · 评论：自己作品下的新评论，搭子按账号定位起草回复，用户看过、勾选后才发出去。
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  engageComments, engageDraft, engageSend, engageSummary, engageSync, setAutoSync, updateComment, waitJob,
} from '../lib/dazi';
import type { EngageComment, EngageSummary } from '../lib/dazi';
import { friendlyError } from '../lib/format';
import { confirmDialog } from '../ui/dialog';
import { Button, EmptyState, ErrorState, Loading, Mascot, Segmented, Switch } from '../ui';

type Filter = 'pending' | 'replied' | 'ignored';

function ago(t: number | null) {
  if (!t) return '还没同步过';
  const m = Math.floor((Date.now() / 1000 - t) / 60);
  if (m < 1) return '刚刚同步';
  if (m < 60) return `${m} 分钟前同步`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} 小时前同步`;
  return `${Math.floor(m / 1440)} 天前同步`;
}

function when(t: number) {
  if (!t) return '';
  const d = new Date(t * 1000);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function CommentCard({ c, filter, checked, busy, onCheck, onDraft, onSave, onStatus }: {
  c: EngageComment; filter: Filter; checked: boolean; busy: boolean;
  onCheck: (v: boolean) => void; onDraft: () => void; onSave: (text: string) => void; onStatus: (s: 'new' | 'ignored') => void;
}) {
  const [text, setText] = useState(c.draft);
  useEffect(() => setText(c.draft), [c.draft]);
  const pending = filter === 'pending';

  return (
    <article className={`dz-cmt${checked ? ' is-checked' : ''}`}>
      {pending && (
        <input type="checkbox" className="dz-cmt__check" checked={checked} disabled={!text.trim()}
          onChange={(e) => onCheck(e.target.checked)} aria-label={`发送给 @${c.nickname} 的回复`} />
      )}
      <div className="dz-cmt__body">
        <div className="dz-cmt__who"><b>@{c.nickname}</b><span>{when(c.time)}{c.loc ? ` · ${c.loc}` : ''}</span></div>
        <p className="dz-cmt__text">{c.content}</p>
        {pending && (
          <div className="dz-cmt__reply">
            <textarea className="dz-textarea" rows={2} value={text} disabled={busy}
              placeholder={busy ? '搭子正在想怎么回…' : '写一句回复，或者点「起草」让搭子来写'}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => { if (text !== c.draft) onSave(text); }}
              aria-label={`回复 @${c.nickname}`} />
            {c.error && <p className="dz-cmt__err" role="alert">{c.error}</p>}
            <div className="dz-cmt__acts">
              <Button size="sm" variant="ghost" onClick={onDraft} loading={busy}>{c.draft ? '重新起草' : '起草'}</Button>
              <Button size="sm" variant="ghost" onClick={() => onStatus('ignored')}>忽略</Button>
            </div>
          </div>
        )}
        {filter === 'replied' && c.draft && <p className="dz-cmt__sent">你回复：{c.draft}</p>}
        {filter === 'ignored' && <div className="dz-cmt__acts"><Button size="sm" variant="ghost" onClick={() => onStatus('new')}>放回待回复</Button></div>}
      </div>
    </article>
  );
}

export default function EngagePage({ persona, onLogin, onChange }: {
  persona: string; onLogin: () => void; onChange?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('pending');
  const [summary, setSummary] = useState<EngageSummary | null>(null);
  const [list, setList] = useState<EngageComment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [drafting, setDrafting] = useState<Set<string>>(new Set());
  const [syncMsg, setSyncMsg] = useState('');
  const [sending, setSending] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([engageSummary(), engageComments(filter)]);
      setSummary(s); setList(l); setFailed(false);
      // 有草稿的默认勾上
      setChecked((prev) => new Set([...prev].filter((id) => l.some((c) => c.id === id)).concat(
        l.filter((c) => c.draft && !c.error && !prev.has(c.id)).map((c) => c.id))));
    } catch { setFailed(true); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const flash = (tone: 'ok' | 'err', text: string) => { setNotice({ tone, text }); setTimeout(() => setNotice(null), 5000); };

  const sync = async () => {
    setSyncMsg('开始同步…');
    try {
      const j = await waitJob(await engageSync(), (x) => setSyncMsg(x.message));
      flash(j.state === 'ok' ? 'ok' : 'err', j.message);
    } catch (e) { flash('err', (e as Error).message); }
    setSyncMsg(''); await load(); onChange?.();
  };

  const draft = async (ids: string[]) => {
    if (!ids.length) return;
    setDrafting((d) => new Set([...d, ...ids]));
    try {
      const { drafts } = await engageDraft(ids, persona);
      const empty = ids.filter((id) => drafts[id] === '');
      if (empty.length) flash('ok', `有 ${empty.length} 条看起来是广告或无意义的评论，搭子建议忽略`);
    } catch (e) {
      const f = friendlyError((e as Error).message);
      flash('err', `${f.title}：${f.desc}`);
    }
    setDrafting((d) => { const n = new Set(d); ids.forEach((id) => n.delete(id)); return n; });
    await load();
  };

  const send = async () => {
    const ids = [...checked].filter((id) => list?.find((c) => c.id === id)?.draft);
    if (!ids.length) return;
    if (!(await confirmDialog(`把勾选的 ${ids.length} 条回复发到小红书？发出去之后在这里撤不回来。`, { title: '发送回复', confirmText: '发送' }))) return;
    setSending('开始发送…');
    try {
      const j = await waitJob(await engageSend(ids), (x) => setSending(x.message));
      flash(j.state === 'ok' ? 'ok' : 'err', j.message);
    } catch (e) { flash('err', (e as Error).message); }
    setSending(''); setChecked(new Set()); await load(); onChange?.();
  };

  const setStatus = async (id: string, status: 'new' | 'ignored') => {
    await updateComment(id, { status }); await load(); onChange?.();
  };

  const groups = useMemo(() => {
    const g = new Map<string, EngageComment[]>();
    for (const c of list ?? []) {
      const k = c.title || '（没有标题的笔记）';
      g.set(k, [...(g.get(k) ?? []), c]);
    }
    return [...g.entries()];
  }, [list]);

  const undrafted = (list ?? []).filter((c) => !c.draft).map((c) => c.id);
  const running = summary?.jobs.find((j) => j.kind === 'sync');

  if (failed) return <div className="dz-page"><ErrorState title="评论没加载出来" desc="搭子可能还在启动，稍等几秒再试。" actions={<Button onClick={() => void load()}>重试</Button>} /></div>;
  if (!summary || !list) return <div className="dz-page"><Loading title="正在打开…" /></div>;

  if (!summary.loggedIn && !summary.lastSync && !list.length) {
    return (
      <div className="dz-page">
        <EmptyState
          title="先登录小红书"
          desc="登录后，搭子会每 45 分钟看一次你笔记下的新评论，按你的账号定位起草回复。你看过、勾选了才会发出去。"
          actions={<Button variant="primary" onClick={onLogin}>去登录</Button>}
        />
        <p className="dz-muted" style={{ textAlign: 'center' }}>目前支持小红书，抖音、快手之后接入。</p>
      </div>
    );
  }

  return (
    <div className="dz-page dz-engage">
      <div className="dz-inspire__bar">
        <Segmented label="评论筛选" value={filter} onChange={(v) => { setFilter(v); setChecked(new Set()); }} options={[
          { value: 'pending', label: `待回复${summary.pending ? ` ${summary.pending}` : ''}` },
          { value: 'replied', label: '已回复' }, { value: 'ignored', label: '已忽略' },
        ]} />
        <span className="dz-muted">{syncMsg || running?.message || ago(summary.lastSync)}</span>
        <Button size="sm" variant="ghost" onClick={sync} loading={Boolean(syncMsg || running)}>同步</Button>
      </div>

      {notice && <div className={`dz-notice dz-notice--${notice.tone}`} role="status">{notice.text}</div>}

      {filter === 'pending' && list.length > 0 && (
        <div className="dz-engage__bar">
          <span className="dz-muted">
            今天还能回 {summary.quota.left} 条 · 每条之间会隔十几秒，像真人一样慢慢发
          </span>
          {undrafted.length > 0 && (
            <Button size="sm" onClick={() => void draft(undrafted)} loading={drafting.size > 0}>搭子起草 {undrafted.length} 条</Button>
          )}
          <Button size="sm" variant="primary" onClick={send} loading={Boolean(sending)} disabled={!checked.size}>
            {sending || `发送勾选的 ${checked.size} 条`}
          </Button>
        </div>
      )}

      {list.length === 0 && (
        filter === 'pending'
          ? <div className="dz-state"><Mascot pose="done" size={96} /><div className="dz-state__title">评论都回完啦</div><div className="dz-state__desc">有新评论会出现在这里，导航上也会有红点。</div></div>
          : <EmptyState title={filter === 'replied' ? '还没有回复过' : '没有忽略的评论'} size={96} />
      )}

      {groups.map(([title, cs]) => (
        <section key={title} className="dz-engage__note">
          <h3 className="dz-engage__title">{title}<span>{cs.length} 条</span></h3>
          {cs.map((c) => (
            <CommentCard key={c.id} c={c} filter={filter} checked={checked.has(c.id)} busy={drafting.has(c.id)}
              onCheck={(v) => setChecked((s) => { const n = new Set(s); if (v) n.add(c.id); else n.delete(c.id); return n; })}
              onDraft={() => void draft([c.id])}
              onSave={async (t) => { await updateComment(c.id, { draft: t }); if (t.trim()) setChecked((s) => new Set(s).add(c.id)); await load(); }}
              onStatus={(s) => void setStatus(c.id, s)} />
          ))}
        </section>
      ))}

      <footer className="dz-engage__foot">
        <Switch checked={summary.autoSync} label="自动同步新评论" onChange={async (v) => { await setAutoSync(v); await load(); }} />
        <span className="dz-muted">自动同步新评论（每 45 分钟一次，只看最近 5 篇笔记）</span>
      </footer>
    </div>
  );
}
