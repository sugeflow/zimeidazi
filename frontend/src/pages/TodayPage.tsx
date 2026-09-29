// 「今天」：先处理的事 → 跟搭子说 → 今天的热点 → 进行中 / 最近作品 → 本周发布
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { mediaUrl } from '../lib/api';
import { formatHot, greeting } from '../lib/format';
import type { OutputNode, TrendGroup } from '../lib/api';
import type { Navigate } from '../shell/routes';
import { Button, Card, Chip, EmptyState, Mascot, Tag } from '../ui';
import type { Tone } from '../ui';
import type { TodayData, Todo } from './useToday';
import { weekDays, ymd } from './useToday';

export interface RunningTask { sessionId: string; title: string; activity: string }

type Props = {
  data: TodayData;
  persona: string;
  running: RunningTask[];
  onNavigate: Navigate;
  onNewPersona: () => void;
  onStartChat: (text: string) => void;
  onUseTopic: (title: string) => void;
  onOpenSession: (id: string) => void;
};

const TEMPLATES: { label: string; emoji: string; text: string }[] = [
  { label: '小红书图文', emoji: '📕', text: '帮我写一篇小红书图文笔记，配 6 张卡片。主题是：' },
  { label: '知识卡片', emoji: '🗂', text: '把下面这段内容做成一组知识卡片：\n' },
  { label: '一键出短视频', emoji: '🎬', text: '帮我做一条 60 秒的竖屏短视频，主题是：' },
  { label: '公众号文章', emoji: '📰', text: '帮我写一篇公众号文章并排好版，主题是：' },
  { label: '拆解爆款', emoji: '🔍', text: '帮我拆解这条爆款，说说它为什么火、我能怎么借鉴：' },
];

const TREND_TONE: Record<string, Tone> = { douyin: 'coral', weibo: 'sun', zhihu: 'sky' };
const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日'];

function TodoCard({ todo, onGo }: { todo: Todo; onGo: () => void }) {
  return (
    <button className="dz-todo" onClick={onGo}>
      <span className={`dz-todo__ic dz-todo__ic--${todo.tone}`} aria-hidden>{todo.emoji}</span>
      <span className="dz-todo__text"><b>{todo.title}</b><span>{todo.desc}</span></span>
      <span className="dz-todo__go">{todo.action} →</span>
    </button>
  );
}

function Compose({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const pick = (t: (typeof TEMPLATES)[number]) => {
    setPicked(t.label);
    setText(t.text);
    requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  };
  const submit = () => { const v = text.trim(); if (v) onSubmit(v); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法选词时按回车不能发送
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  return (
    <div className="dz-compose">
      <textarea
        ref={ref} rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
        aria-label="想做什么内容" placeholder="比如：帮我写一篇国庆去成都玩的小红书图文，配 6 张卡片"
      />
      <div className="dz-compose__bar">
        {TEMPLATES.map((t) => (
          <Chip key={t.label} selected={picked === t.label} onClick={() => pick(t)}>
            <span aria-hidden>{t.emoji}</span>{t.label}
          </Chip>
        ))}
        <Button variant="primary" onClick={submit} disabled={!text.trim()}>开始 →</Button>
      </div>
    </div>
  );
}

function Trends({ groups, onUse, onMore }: { groups: TrendGroup[]; onUse: (t: string) => void; onMore: () => void }) {
  // 各平台轮流取，凑 3 条，保证来源多样
  const picks: { platform: string; label: string; title: string; hot: string }[] = [];
  for (let i = 0; picks.length < 3 && i < 4; i++) {
    for (const g of groups) {
      const it = g.items[i];
      if (it && picks.length < 3) picks.push({ platform: g.platform, label: g.label, title: it.title, hot: it.hot });
    }
  }
  return (
    <section>
      <div className="dz-sec-head">
        <h2 className="dz-h2">今天的热点 <small>点一下，搭子会先判断适不适合你的账号，再给出角度和初稿</small></h2>
        <Button variant="link" onClick={onMore}>更多热点 →</Button>
      </div>
      {picks.length === 0 ? (
        <Card sunken><p className="dz-muted">热点暂时没取到，可能是网络问题，稍后再来看看。</p></Card>
      ) : (
        <div className="dz-grid-3">
          {picks.map((t) => (
            <Card key={t.platform + t.title} interactive onClick={() => onUse(t.title)} onKeyDown={(e) => e.key === 'Enter' && onUse(t.title)}>
              <Tag tone={TREND_TONE[t.platform] ?? 'neutral'} tilt>{t.label}{t.hot ? ` · ${formatHot(t.hot)}` : ''}</Tag>
              <h3 className="dz-idea__title">{t.title}</h3>
              <span className="dz-idea__act">结合我的定位做一篇 →</span>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function coverOf(n: OutputNode): string | undefined {
  if (n.meta?.cover) return mediaUrl(n.meta.cover);
  // 没有封面时，找项目里的第一张图
  const walk = (x: OutputNode): string | undefined => {
    if (x.type === 'file' && x.kind === 'image') return x.path;
    for (const c of x.children ?? []) { const f = walk(c); if (f) return f; }
    return undefined;
  };
  const img = walk(n);
  return img ? mediaUrl(img) : undefined;
}

function Week({ data, onOpen }: { data: TodayData; onOpen: () => void }) {
  const today = ymd(new Date());
  return (
    <section>
      <div className="dz-sec-head"><h2 className="dz-h2">这周的发布</h2><Button variant="link" onClick={onOpen}>去日历 →</Button></div>
      <Card className="dz-week">
        {weekDays().map((d, i) => {
          const key = ymd(d);
          const items = data.week.filter((s) => s.date === key && (s.kind ?? 'content') === 'content');
          return (
            <div key={key} className={`dz-week__day${key === today ? ' is-today' : ''}`} title={items.map((s) => s.title).join('\n') || undefined}>
              <span>{WEEKDAY[i]}</span>
              <b>{d.getDate()}</b>
              <span className="dz-week__dots" aria-label={items.length ? `${items.length} 条` : '无'}>
                {items.slice(0, 3).map((s) => <i key={s.id} className={s.status === 'published' ? 'is-done' : ''} />)}
              </span>
            </div>
          );
        })}
      </Card>
      {data.week.length === 0 && <p className="dz-muted" style={{ marginTop: 8 }}>这周还没有排期。</p>}
    </section>
  );
}

export default function TodayPage(p: Props) {
  const { data } = p;
  const go = (t: Todo) => (t.to === 'new-persona' ? p.onNewPersona() : p.onNavigate(t.to.page, t.to.tab));
  const isNewUser = data.loaded && data.recent.length === 0 && p.running.length === 0;

  return (
    <div className="dz-page">
      <header className="dz-today-head">
        <h1 className="dz-h1"><span className="dz-squiggle">{greeting()}</span></h1>
        <p className="dz-sub">
          {p.persona ? <>正在为「{p.persona}」创作。</> : null}
          {data.todos.length ? '先处理这几件事，再跟搭子说说今天想做什么。' : '今天想做点什么？跟搭子说一句话就行。'}
        </p>
      </header>

      {data.todos.length > 0 && (
        <div className="dz-todos">{data.todos.map((t) => <TodoCard key={t.id} todo={t} onGo={() => go(t)} />)}</div>
      )}

      <Compose onSubmit={p.onStartChat} />

      <Trends groups={data.trends} onUse={p.onUseTopic} onMore={() => p.onNavigate('inspire', 'trends')} />

      <div className="dz-today-low">
        <section>
          <div className="dz-sec-head">
            <h2 className="dz-h2">{p.running.length ? '进行中' : '最近的作品'}</h2>
            <Button variant="link" onClick={() => p.onNavigate('works')}>作品库 →</Button>
          </div>
          <Card>
            {p.running.map((r) => (
              <button key={r.sessionId} className="dz-task" onClick={() => p.onOpenSession(r.sessionId)}>
                <Mascot pose="thinking" size={52} bob />
                <span className="dz-task__text"><b>{r.title}</b><span>{r.activity || '搭子正在做…'}</span></span>
                <Tag tone="coral">生成中</Tag>
              </button>
            ))}
            {!p.running.length && data.recent.map((n) => {
              const cover = coverOf(n);
              return (
                <button key={n.path} className="dz-task" onClick={() => p.onNavigate('works')}>
                  {cover ? <img className="dz-task__thumb" src={cover} alt="" loading="lazy" /> : <span className="dz-task__thumb dz-task__thumb--empty" aria-hidden>📄</span>}
                  <span className="dz-task__text">
                    <b>{n.meta?.title || n.name}</b>
                    <span>{n.meta?.summary || `${n.fileCount ?? 0} 个文件`}</span>
                  </span>
                  {n.meta?.status === 'published' ? <Tag tone="mint">已发布</Tag> : n.meta?.status === 'ready' ? <Tag tone="sun">待发布</Tag> : <Tag>草稿</Tag>}
                </button>
              );
            })}
            {isNewUser && (
              <EmptyState size={96} title="还没有作品" desc="在上面跟搭子说一句想做什么，第一篇几分钟就能做好。" />
            )}
          </Card>
        </section>
        <Week data={data} onOpen={() => p.onNavigate('publish', 'calendar')} />
      </div>
    </div>
  );
}
