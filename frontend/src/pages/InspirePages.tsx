// 找灵感：热点、选题库、拆解爆款。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createIdea, createSchedule, deleteIdea, fetchIdeas, fetchTrends, runAgent, updateIdea } from '../lib/api';
import type { Idea, IdeaInput, TrendGroup } from '../lib/api';
import { formatHot } from '../lib/format';
import { renderMarkdown } from '../lib/sanitize';
import { confirmDialog } from '../ui/dialog';
import { Button, Card, Chip, EmptyState, ErrorState, Loading, Tag } from '../ui';
import { IconBookmark, IconCheck, IconClose, IconRefresh } from '../components/icons';

// ---------------------------------------------------------------- 热点

const PLATFORMS = [
  { key: 'douyin', label: '抖音' }, { key: 'weibo', label: '微博' }, { key: 'zhihu', label: '知乎' },
  { key: 'bilibili', label: 'B站' }, { key: 'toutiao', label: '头条' }, { key: 'baidu', label: '百度' },
];

export function TrendsView({ onUseTopic }: { onUseTopic: (title: string) => void }) {
  const [pf, setPf] = useState('douyin');
  const [group, setGroup] = useState<TrendGroup | null>(null);
  const [updated, setUpdated] = useState(0);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const load = useCallback((key: string) => {
    setState('loading');
    fetchTrends(key, 20)
      .then((d) => { setGroup(d.trends[0] ?? null); setUpdated(d.updated); setState('ok'); })
      .catch(() => setState('error'));
  }, []);
  useEffect(() => { load(pf); }, [load, pf]);

  const save = async (title: string) => {
    if (saved.has(title)) return;
    try {
      await createIdea({ title, source: `${PLATFORMS.find((p) => p.key === pf)?.label ?? ''}热搜`, status: 'pending' });
      setSaved((s) => new Set(s).add(title));
    } catch { /* 收藏失败不打断浏览 */ }
  };

  const items = group?.items ?? [];
  return (
    <div className="dz-page dz-inspire">
      <div className="dz-inspire__bar">
        <div className="dz-inspire__chips">
          {PLATFORMS.map((p) => <Chip key={p.key} selected={pf === p.key} onClick={() => setPf(p.key)}>{p.label}</Chip>)}
        </div>
        <span className="dz-muted">
          {updated > 0 && `${new Date(updated * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新`}
        </span>
        <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />} onClick={() => load(pf)} disabled={state === 'loading'}>刷新</Button>
      </div>

      {state === 'loading' && <Loading title="正在看热搜…" />}
      {state === 'error' && <ErrorState title="热搜没拿到" desc="可能是网络不太顺，稍后点「刷新」再试。" actions={<Button onClick={() => load(pf)}>重试</Button>} />}
      {state === 'ok' && items.length === 0 && <EmptyState title="这个平台暂时没有数据" desc="换个平台看看，或者过一会儿再刷新。" />}
      {state === 'ok' && items.length > 0 && (
        <Card className="dz-trends">
          {items.map((it, i) => (
            <div key={it.title} className="dz-trend">
              <span className={`dz-trend__rank${i < 3 ? ' is-top' : ''}`}>{i + 1}</span>
              <span className="dz-trend__text">
                <b>{it.title}</b>
                {it.hot && <small>{formatHot(it.hot)} 热度</small>}
              </span>
              <button className="dz-icon-btn" onClick={() => save(it.title)} aria-label={saved.has(it.title) ? '已收藏到选题库' : '收藏到选题库'} title={saved.has(it.title) ? '已收藏到选题库' : '收藏到选题库'}>
                {saved.has(it.title) ? <IconCheck size={16} /> : <IconBookmark size={16} />}
              </button>
              <Button size="sm" variant="secondary" onClick={() => onUseTopic(it.title)}>做成内容</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 选题库

const COLUMNS = [
  { key: 'pending', label: '想做', tone: 'neutral' as const },
  { key: 'doing', label: '在做', tone: 'sun' as const },
  { key: 'done', label: '做完了', tone: 'mint' as const },
];
const NEXT: Record<string, string> = { pending: 'doing', doing: 'done', done: 'pending' };
const EMPTY: IdeaInput = { title: '', note: '', source: '', status: 'pending' };

function IdeaEditor({ initial, isNew, onSave, onClose }: {
  initial: IdeaInput; isNew: boolean; onSave: (v: IdeaInput) => void; onClose: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div className="dz-dialog__scrim" onClick={onClose}>
      <div className="dz-dialog" role="dialog" aria-modal="true" aria-label={isNew ? '新建选题' : '编辑选题'} onClick={(e) => e.stopPropagation()}>
        <div className="dz-dialog__title">{isNew ? '记一个选题' : '编辑选题'}</div>
        <div className="dz-form">
          <input className="dz-input" value={v.title} autoFocus placeholder="想做的内容，比如：打工人一周带饭不重样" aria-label="选题"
            onChange={(e) => setV({ ...v, title: e.target.value })} />
          <textarea className="dz-textarea" value={v.note} placeholder="角度、想法、参考（可以不填）" aria-label="备注"
            onChange={(e) => setV({ ...v, note: e.target.value })} />
          <div className="dz-guide__opts">
            {COLUMNS.map((c) => <Chip key={c.key} selected={v.status === c.key} onClick={() => setV({ ...v, status: c.key })}>{c.label}</Chip>)}
          </div>
        </div>
        <div className="dz-dialog__actions">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => onSave(v)} disabled={!v.title.trim()}>保存</Button>
        </div>
      </div>
    </div>
  );
}

export function IdeasView({ onUseTopic }: { onUseTopic: (title: string) => void }) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; v: IdeaInput } | null>(null);
  const [flash, setFlash] = useState('');

  const load = useCallback(() => { fetchIdeas().then(setIdeas).catch(() => setIdeas([])); }, []);
  useEffect(() => { load(); }, [load]);
  const note = (m: string) => { setFlash(m); setTimeout(() => setFlash(''), 2200); };

  const byStatus = useMemo(() => {
    const g: Record<string, Idea[]> = { pending: [], doing: [], done: [] };
    for (const it of ideas ?? []) (g[it.status] || g.pending).push(it);
    return g;
  }, [ideas]);

  const save = async (v: IdeaInput) => {
    if (edit?.id) await updateIdea(edit.id, v); else await createIdea(v);
    setEdit(null); load();
  };
  const advance = async (it: Idea) => { await updateIdea(it.id, { ...it, status: NEXT[it.status] }); load(); };
  const remove = async (it: Idea) => {
    if (!(await confirmDialog(`删除选题「${it.title}」？`, { title: '删除选题', confirmText: '删除', danger: true }))) return;
    await deleteIdea(it.id); load();
  };
  const schedule = async (it: Idea) => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await createSchedule({ title: it.title, date: today, platform: '', time: '', status: 'idea', note: it.note });
    note('已放进今天的内容日历');
  };

  if (!ideas) return <div className="dz-page"><Loading title="正在打开选题库…" /></div>;
  return (
    <div className="dz-page dz-inspire">
      <div className="dz-inspire__bar">
        <span className="dz-muted">看到好点子先记下来。热点里点书签收藏的，也会出现在这里。</span>
        <Button variant="primary" size="sm" onClick={() => setEdit({ id: null, v: { ...EMPTY } })}>记一个选题</Button>
      </div>
      {ideas.length === 0 ? (
        <EmptyState title="还没有选题" desc="去「热点」里收藏几个，或者点右上角自己记一个。" />
      ) : (
        <div className="dz-kanban">
          {COLUMNS.map((col) => (
            <section key={col.key} className="dz-kanban__col" aria-label={col.label}>
              <h3><Tag tone={col.tone}>{col.label}</Tag><span>{byStatus[col.key].length}</span></h3>
              {byStatus[col.key].map((it) => (
                <article key={it.id} className="dz-idea">
                  <button className="dz-idea__main" onClick={() => setEdit({ id: it.id, v: { title: it.title, note: it.note, source: it.source, status: it.status } })} title="点一下编辑">
                    <b>{it.title}</b>
                    {it.note && <span>{it.note}</span>}
                    {it.source && <small>{it.source}</small>}
                  </button>
                  <div className="dz-idea__acts">
                    <Button size="sm" variant="secondary" onClick={() => onUseTopic(it.title)}>做成内容</Button>
                    <Button size="sm" variant="ghost" onClick={() => schedule(it)}>排进日历</Button>
                    <Button size="sm" variant="ghost" onClick={() => advance(it)}>→ {COLUMNS.find((c) => c.key === NEXT[it.status])?.label}</Button>
                    <button className="dz-icon-btn" onClick={() => remove(it)} aria-label={`删除「${it.title}」`}><IconClose size={14} /></button>
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      )}
      {edit && <IdeaEditor initial={edit.v} isNew={!edit.id} onSave={save} onClose={() => setEdit(null)} />}
      {flash && <div className="dz-flash" role="status">{flash}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- 拆解爆款

export function BreakdownView({ persona }: { persona: string }) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const run = async () => {
    if (!input.trim()) return;
    setLoading(true); setResult(''); setError(''); setSaved(false);
    const prompt =
      `你是爆款内容拆解专家。拆解下面这条内容，用中文分点输出：\n` +
      `1. **一句话概括**\n2. **开头为什么抓人**\n3. **结构和节奏**\n` +
      `4. **为什么会火**：情绪、共鸣、实用、争议点\n` +
      `5. **可以直接套用的模板**\n` +
      `6. **借这个套路${persona ? `、结合我的账号定位「${persona}」` : ''}可以做的 3 个选题**\n\n` +
      `待拆解内容：\n${input}`;
    try {
      setResult((await runAgent(prompt, persona)).response);
    } catch (e) {
      setError(e instanceof Error ? e.message : '拆解失败');
    } finally { setLoading(false); }
  };

  const save = async () => {
    await createIdea({ title: `拆解：${input.trim().split('\n')[0].slice(0, 24)}`, note: result, source: '拆解爆款', status: 'pending' });
    setSaved(true);
  };

  return (
    <div className="dz-page dz-inspire dz-breakdown">
      <p className="dz-muted">把别人的爆款文案、视频口播稿粘贴进来，搭子帮你拆出为什么火，并给你能直接套用的模板和选题。</p>
      <div className="dz-compose">
        <textarea rows={6} value={input} onChange={(e) => setInput(e.target.value)} aria-label="要拆解的内容"
          placeholder="粘贴爆款的文案、标题、口播稿…" />
        <div className="dz-compose__bar">
          {result && <Button variant="ghost" onClick={() => { setInput(''); setResult(''); }}>清空</Button>}
          <Button variant="primary" onClick={run} loading={loading} disabled={!input.trim()}>{loading ? '正在拆…' : '开始拆解'}</Button>
        </div>
      </div>
      {loading && <Loading title="搭子正在拆解…" desc="大概需要半分钟到一分钟。" />}
      {error && <ErrorState title="这次没拆成" desc={error} actions={<Button onClick={run}>重试</Button>} />}
      {result && !loading && (
        <Card>
          <div className="dz-sec-head">
            <h2 className="dz-h2">拆解结果</h2>
            <Button size="sm" variant="secondary" onClick={save} disabled={saved}>{saved ? '已存进选题库' : '存进选题库'}</Button>
          </div>
          <div className="dz-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }} />
        </Card>
      )}
    </div>
  );
}
