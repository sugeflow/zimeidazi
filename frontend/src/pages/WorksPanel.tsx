// AI 创作页右侧：这次创作做出来的作品，生成过程中实时出现。
import { useEffect, useMemo, useState } from 'react';
import { fetchOutputContent, mediaUrl } from '../lib/api';
import type { OutputNode } from '../lib/api';
import type { ChatSession, StreamState } from '../lib/store';
import { renderMarkdown } from '../lib/sanitize';
import { Button, Mascot, Tag } from '../ui';
import { IconChevron, IconClose, IconFile, IconMusic, IconPanel, IconVideo } from '../components/icons';
import { latestMtime, useSessionWorks } from './useSessionWorks';

const KIND_LABEL: Record<string, string> = {
  article: '文章', 'xhs-note': '小红书', video: '视频', cards: '卡片', poster: '海报', audio: '音频',
};
const isHtml = (name: string) => /\.html?$/i.test(name);
const byName = (a: OutputNode, b: OutputNode) => a.path.localeCompare(b.path, 'zh', { numeric: true });

/** 隐藏文件和给程序看的数据文件（json、yaml 等）不展示 */
const hidden = (name: string) => name.startsWith('.') || /\.(json|ya?ml|log|lock)$/i.test(name);

function filesOf(n: OutputNode): OutputNode[] {
  if (n.type === 'file') return hidden(n.name) ? [] : [n];
  return (n.children ?? []).filter((c) => !c.name.startsWith('.')).flatMap(filesOf);
}

/** 成品排前面，其余按文件名（卡片 01、02… 按数字顺序） */
function ordered(w: OutputNode) {
  const files = filesOf(w).sort(byName);
  const first = new Set(w.meta?.deliverablePaths ?? []);
  const rank = (f: OutputNode) => (first.has(f.path) ? 0 : 1);
  const sorted = [...files].sort((a, b) => rank(a) - rank(b));
  const media = sorted.filter((f) => f.kind === 'image' || f.kind === 'video');
  const docs = sorted.filter((f) => f.kind === 'text' || f.kind === 'audio');
  // 大图预览里按"先图后文"的顺序翻
  return { media, docs, all: [...media, ...docs] };
}

function when(t: number) {
  if (!t) return '';
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function WorkCard({ w, onPreview, onOpen }: {
  w: OutputNode; onPreview: (files: OutputNode[], i: number) => void; onOpen: () => void;
}) {
  const { media, docs, all } = useMemo(() => ordered(w), [w]);
  const shown = media.slice(0, 9);
  const more = media.length - shown.length;
  const kind = w.meta?.kind ? KIND_LABEL[w.meta.kind] : undefined;
  const open = (f: OutputNode) => onPreview(all, all.indexOf(f));

  return (
    <article className="dz-work">
      <header className="dz-work__head">
        <b title={w.meta?.title || w.name}>{w.meta?.title || w.name}</b>
        <span className="dz-work__meta">
          {kind && <Tag tone="coral">{kind}</Tag>}
          <span>{all.length} 个文件 · {when(latestMtime(w))}</span>
        </span>
      </header>
      {shown.length > 0 && (
        <div className={`dz-work__grid${shown.length === 1 ? ' is-single' : ''}`}>
          {shown.map((f, i) => (
            <button key={f.path} className="dz-work__thumb" onClick={() => open(f)} aria-label={`预览 ${f.name}`}>
              {f.kind === 'image'
                ? <img src={`${mediaUrl(f.path)}?v=${f.mtime ?? 0}`} alt="" loading="lazy" />
                : <><video src={mediaUrl(f.path)} preload="metadata" muted /><span className="dz-work__play"><IconVideo size={18} /></span></>}
              {i === shown.length - 1 && more > 0 && <span className="dz-work__more">+{more}</span>}
            </button>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <ul className="dz-work__docs">
          {docs.slice(0, 3).map((f) => (
            <li key={f.path}>
              <button onClick={() => open(f)}>
                {f.kind === 'audio' ? <IconMusic size={15} /> : <IconFile size={15} />}
                <span>{f.name}</span>
                {isHtml(f.name) && <small>排版预览</small>}
              </button>
            </li>
          ))}
          {docs.length > 3 && <li className="dz-work__rest">还有 {docs.length - 3} 个文档</li>}
        </ul>
      )}
      <footer className="dz-work__foot">
        <Button variant="link" size="sm" onClick={onOpen}>在作品库打开 →</Button>
      </footer>
    </article>
  );
}

function PreviewBody({ f }: { f: OutputNode }) {
  const [text, setText] = useState<string | null>(null);
  const url = mediaUrl(f.path);
  const markdown = f.kind === 'text' && !isHtml(f.name);
  useEffect(() => {
    if (!markdown) return;
    let alive = true;
    setText(null);
    fetchOutputContent(f.path)
      .then((r) => alive && setText(r.isBinary ? '' : r.content))
      .catch(() => alive && setText(''));
    return () => { alive = false; };
  }, [f.path, markdown]);

  if (f.kind === 'image') return <img className="dz-preview__media" src={`${url}?v=${f.mtime ?? 0}`} alt={f.name} />;
  if (f.kind === 'video') return <video className="dz-preview__media" src={url} controls autoPlay />;
  if (f.kind === 'audio') return <audio src={url} controls autoPlay style={{ width: '100%' }} />;
  // 不给 allow-same-origin：页面脚本能跑（公众号排版里的「复制」按钮），但碰不到本软件
  if (isHtml(f.name)) return <iframe className="dz-preview__frame" src={`${url}?v=${f.mtime ?? 0}`} title={f.name} sandbox="allow-scripts" allow="clipboard-write" />;
  if (markdown) {
    if (text === null) return <p className="dz-muted">正在打开…</p>;
    return <div className="dz-preview__doc outputs-viewer-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
  }
  return <p className="dz-muted">这个文件没法直接预览，<a href={url} download>下载 {f.name}</a></p>;
}

/** 大图预览，左右键切换同一个作品里的文件 */
function Preview({ files, index, onIndex, onClose }: {
  files: OutputNode[]; index: number; onIndex: (i: number) => void; onClose: () => void;
}) {
  const f = files[index];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < files.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [index, files.length, onIndex, onClose]);
  if (!f) return null;

  return (
    <div className="dz-preview" role="dialog" aria-modal="true" aria-label={f.name} onClick={onClose}>
      <div className="dz-preview__box" onClick={(e) => e.stopPropagation()}>
        <header className="dz-preview__head">
          <b>{f.name}</b>
          <span className="dz-muted">{index + 1} / {files.length}</span>
          <a className="dz-btn dz-btn--ghost dz-btn--sm" href={mediaUrl(f.path)} download={f.name}>下载</a>
          <button className="dz-icon-btn" onClick={onClose} aria-label="关闭预览"><IconClose size={18} /></button>
        </header>
        <div className="dz-preview__body">
          {index > 0 && (
            <button className="dz-preview__nav is-prev" onClick={() => onIndex(index - 1)} aria-label="上一个"><IconChevron size={22} /></button>
          )}
          <PreviewBody key={f.path} f={f} />
          {index < files.length - 1 && (
            <button className="dz-preview__nav" onClick={() => onIndex(index + 1)} aria-label="下一个"><IconChevron size={22} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorksPanel({ session, stream, onCollapse, onOpenInWorks }: {
  session: ChatSession; stream?: StreamState;
  onCollapse: () => void; onOpenInWorks: (path: string) => void;
}) {
  const streaming = !!stream;
  const { works, loaded } = useSessionWorks(session, streaming);
  const [preview, setPreview] = useState<{ files: OutputNode[]; index: number } | null>(null);
  const activity = (stream?.activity || stream?.stillWorking || '').replace(/^[⏳🔧⚙️🛠]\s*/u, '');

  return (
    <aside className="dz-works" aria-label="这次的作品">
      <header className="dz-works__head">
        <b>这次的作品</b>
        {works.length > 0 && <span className="dz-works__count">{works.length}</span>}
        <button className="dz-icon-btn" onClick={onCollapse} aria-label="收起作品栏" title="收起"><IconPanel size={17} /></button>
      </header>
      <div className="dz-works__body">
        {streaming && (
          <div className="dz-works__live" role="status" aria-live="polite">
            <Mascot pose="thinking" size={52} bob />
            <span><b>搭子正在做</b><span>{activity || '做好的东西会马上出现在这里'}</span></span>
          </div>
        )}
        {works.map((w) => (
          <WorkCard key={w.path} w={w} onPreview={(files, index) => setPreview({ files, index })} onOpen={() => onOpenInWorks(w.path)} />
        ))}
        {!streaming && loaded && works.length === 0 && (
          <div className="dz-works__empty">
            <Mascot pose="empty" size={84} />
            <b>还没有作品</b>
            <span>做好的卡片、图片、视频和文章，会出现在这里，点开就能看大图。</span>
          </div>
        )}
      </div>
      {preview && (
        <Preview files={preview.files} index={preview.index}
          onIndex={(index) => setPreview((p) => (p ? { ...p, index } : p))} onClose={() => setPreview(null)} />
      )}
    </aside>
  );
}
