// 作品库：所有作品按时间排，点进去看成品、文案，一键去发布。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteOutput, fetchOutputContent, fetchOutputs, mediaUrl } from '../lib/api';
import type { OutputNode } from '../lib/api';
import { openFolder } from '../lib/dazi';
import { renderMarkdown } from '../lib/sanitize';
import type { PublishDraft } from '../lib/store';
import { alertDialog, confirmDialog } from '../ui/dialog';
import { Button, Card, Chip, EmptyState, ErrorState, Loading, Tag } from '../ui';
import { IconFile, IconMusic, IconRefresh, IconSearch, IconVideo } from '../components/icons';
import { latestMtime } from './useSessionWorks';
import { Preview, filesOf, isHtml, ordered } from './workFiles';

type Kind = 'cards' | 'video' | 'article' | 'audio' | 'other';
const KINDS: { id: Kind | 'all'; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'cards', label: '图文' }, { id: 'video', label: '视频' },
  { id: 'article', label: '文章' }, { id: 'audio', label: '音频' },
];
const META_KIND: Record<string, Kind> = {
  'xhs-note': 'cards', cards: 'cards', poster: 'cards', video: 'video', article: 'article', audio: 'audio',
};

function kindOf(w: OutputNode): Kind {
  if (w.meta?.kind && META_KIND[w.meta.kind]) return META_KIND[w.meta.kind];
  const fs = filesOf(w);
  if (fs.some((f) => f.kind === 'video')) return 'video';
  if (fs.some((f) => f.kind === 'image')) return 'cards';
  if (fs.some((f) => f.kind === 'audio')) return 'audio';
  if (fs.some((f) => f.kind === 'text')) return 'article';
  return 'other';
}
const KIND_TAG: Record<Kind, string> = { cards: '图文', video: '视频', article: '文章', audio: '音频', other: '其他' };

function dateText(t: number) {
  if (!t) return '';
  const d = new Date(t);
  const today = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === today.toDateString()) return `今天 ${hm}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function summary(w: OutputNode) {
  const fs = filesOf(w);
  const n = (k: string) => fs.filter((f) => f.kind === k).length;
  const parts = [n('image') && `${n('image')} 张图`, n('video') && `${n('video')} 个视频`, n('text') && `${n('text')} 篇文字`, n('audio') && `${n('audio')} 段音频`];
  return parts.filter(Boolean).join(' · ') || '空的';
}

function Tile({ w, onOpen }: { w: OutputNode; onOpen: () => void }) {
  const { media } = useMemo(() => ordered(w), [w]);
  const cover = w.meta?.cover ? { path: w.meta.cover, kind: /\.(mp4|mov|webm)$/i.test(w.meta.cover) ? 'video' : 'image', mtime: w.mtime } : media[0];
  const kind = kindOf(w);
  return (
    <button className="dz-tile" onClick={onOpen}>
      <span className="dz-tile__cover">
        {cover?.kind === 'image' && <img src={`${mediaUrl(cover.path)}?v=${cover.mtime ?? 0}`} alt="" loading="lazy" />}
        {cover?.kind === 'video' && <video src={mediaUrl(cover.path)} preload="metadata" muted />}
        {!cover && <span className="dz-tile__ph" aria-hidden>{kind === 'audio' ? <IconMusic size={30} /> : <IconFile size={30} />}</span>}
        <span className="dz-tile__kind"><Tag tone="coral">{KIND_TAG[kind]}</Tag></span>
      </span>
      <span className="dz-tile__text">
        <b>{w.meta?.title || w.name}</b>
        <span>{summary(w)}</span>
        <small>{dateText(latestMtime(w))}{w.meta?.status === 'published' ? ' · 已发布' : ''}</small>
      </span>
    </button>
  );
}

/** 作品里的主文案：第一篇 Markdown / 文本 */
function useMainText(w: OutputNode | null) {
  const [text, setText] = useState<{ path: string; content: string } | null>(null);
  useEffect(() => {
    setText(null);
    if (!w) return;
    const doc = ordered(w).docs.find((f) => f.kind === 'text' && !isHtml(f.name));
    if (!doc) return;
    let alive = true;
    fetchOutputContent(doc.path).then((r) => { if (alive && !r.isBinary) setText({ path: doc.path, content: r.content }); }).catch(() => {});
    return () => { alive = false; };
  }, [w]);
  return text;
}

function Detail({ w, onBack, onDeleted, onPublish }: {
  w: OutputNode; onBack: () => void; onDeleted: () => void; onPublish: (d: Partial<PublishDraft>) => void;
}) {
  const { media, docs, all } = useMemo(() => ordered(w), [w]);
  const main = useMainText(w);
  const [preview, setPreview] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const title = w.meta?.title || w.name;

  const remove = async () => {
    if (!(await confirmDialog(`删除「${title}」和里面的全部文件？删除后找不回来。`, { title: '删除作品', confirmText: '删除', danger: true }))) return;
    try { await deleteOutput(w.path); onDeleted(); } catch (e) { await alertDialog((e as Error).message || '删除失败'); }
  };
  const open = async () => { try { await openFolder('outputs', w.path); } catch (e) { await alertDialog((e as Error).message || '打开失败'); } };
  const copy = () => { if (main) { void navigator.clipboard?.writeText(main.content); setCopied(true); setTimeout(() => setCopied(false), 1500); } };
  const publish = () => onPublish({
    title, body: main?.content ?? '', media: media.map((f) => f.path),
  });

  return (
    <div className="dz-page dz-work-detail">
      <div>
        <Button variant="link" onClick={onBack}>← 作品库</Button>
        <div className="dz-work-detail__head">
          <div>
            <h1 className="dz-title">{title}</h1>
            <p className="dz-muted">{dateText(latestMtime(w))} · {summary(w)}</p>
          </div>
          <div className="dz-work-detail__acts">
            <Button variant="ghost" onClick={remove}>删除</Button>
            <Button onClick={open}>打开文件夹</Button>
            <Button variant="primary" onClick={publish} disabled={!media.length && !main}>去发布</Button>
          </div>
        </div>
      </div>

      {media.length > 0 && (
        <div className="dz-work-detail__grid">
          {media.map((f) => (
            <button key={f.path} className="dz-work__thumb" onClick={() => setPreview(all.indexOf(f))} aria-label={`预览 ${f.name}`}>
              {f.kind === 'image'
                ? <img src={`${mediaUrl(f.path)}?v=${f.mtime ?? 0}`} alt="" loading="lazy" />
                : <><video src={mediaUrl(f.path)} preload="metadata" muted /><span className="dz-work__play"><IconVideo size={18} /></span></>}
            </button>
          ))}
        </div>
      )}

      {main && (
        <Card>
          <div className="dz-sec-head">
            <h2 className="dz-h2">文案</h2>
            <Button size="sm" variant="secondary" onClick={copy}>{copied ? '已复制' : '复制'}</Button>
          </div>
          <div className="dz-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(main.content) }} />
        </Card>
      )}

      {docs.filter((f) => f.path !== main?.path).length > 0 && (
        <section>
          <h2 className="dz-h2" style={{ marginBottom: 10 }}>其他文件</h2>
          <ul className="dz-work__docs dz-card">
            {docs.filter((f) => f.path !== main?.path).map((f) => (
              <li key={f.path}>
                <button onClick={() => setPreview(all.indexOf(f))}>
                  {f.kind === 'audio' ? <IconMusic size={15} /> : <IconFile size={15} />}
                  <span>{f.path.slice(w.path.length + 1) || f.name}</span>
                  {isHtml(f.name) && <small>排版预览</small>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview !== null && <Preview files={all} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />}
    </div>
  );
}

export default function WorksLibrary({ jumpPath, onJumpHandled, onPublish }: {
  jumpPath?: string; onJumpHandled?: () => void; onPublish: (d: Partial<PublishDraft>) => void;
}) {
  const [roots, setRoots] = useState<OutputNode[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openName, setOpenName] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    setFailed(false);
    fetchOutputs().then(setRoots).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  // 对话里「作品库 › xxx」的链接、作品栏的「在作品库打开」：直接进到那个作品
  useEffect(() => {
    if (!jumpPath) return;
    setOpenName(jumpPath.split('/').filter(Boolean)[0] ?? null);
    onJumpHandled?.();
  }, [jumpPath, onJumpHandled]);

  const works = useMemo(() => (roots ?? [])
    .filter((n) => !n.name.startsWith('_') && !n.name.startsWith('.') && filesOf(n).length > 0)
    .sort((a, b) => latestMtime(b) - latestMtime(a)), [roots]);
  const shown = works.filter((w) => (kind === 'all' || kindOf(w) === kind)
    && (!query.trim() || (w.meta?.title || w.name).toLowerCase().includes(query.trim().toLowerCase())));

  const current = openName ? works.find((w) => w.name === openName) : undefined;
  if (current) {
    return <Detail w={current} onBack={() => setOpenName(null)} onDeleted={() => { setOpenName(null); load(); }} onPublish={onPublish} />;
  }

  return (
    <div className="dz-page dz-library">
      <header className="dz-library__head">
        <div>
          <h1 className="dz-title">作品库</h1>
          <p className="dz-muted">搭子做好的东西都在这里{works.length ? `，一共 ${works.length} 个` : ''}。</p>
        </div>
        <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />} onClick={load}>刷新</Button>
      </header>

      {works.length > 0 && (
        <div className="dz-inspire__bar">
          <div className="dz-inspire__chips">
            {KINDS.map((k) => <Chip key={k.id} selected={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</Chip>)}
          </div>
          <label className="dz-search dz-search--sm">
            <IconSearch size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜作品名" aria-label="搜作品名" />
          </label>
        </div>
      )}

      {failed && <ErrorState title="作品列表没打开" desc="搭子可能还在启动，稍等几秒再刷新。" actions={<Button onClick={load}>重试</Button>} />}
      {!failed && !roots && <Loading title="正在打开作品库…" />}
      {roots && works.length === 0 && <EmptyState title="还没有作品" desc="去「AI 创作」跟搭子说一句想做什么，做好的东西会自动放到这里。" />}
      {works.length > 0 && shown.length === 0 && <EmptyState title="没有符合条件的作品" desc="换个筛选条件试试。" />}

      {shown.length > 0 && (
        <div className="dz-tiles">
          {shown.map((w) => <Tile key={w.path} w={w} onOpen={() => setOpenName(w.name)} />)}
        </div>
      )}
    </div>
  );
}
