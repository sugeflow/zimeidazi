// 作品文件的整理和大图预览：AI 创作页的作品栏和作品库共用。
import { useEffect, useState } from 'react';
import { fetchOutputContent, mediaUrl } from '../lib/api';
import type { OutputNode } from '../lib/api';
import { renderMarkdown } from '../lib/sanitize';
import { IconChevron, IconClose } from '../components/icons';

export const isHtml = (name: string) => /\.html?$/i.test(name);
const byName = (a: OutputNode, b: OutputNode) => a.path.localeCompare(b.path, 'zh', { numeric: true });

/** 隐藏文件和给程序看的数据文件（json、yaml 等）不展示 */
export const hidden = (name: string) => name.startsWith('.') || /\.(json|ya?ml|log|lock)$/i.test(name);

export function filesOf(n: OutputNode): OutputNode[] {
  if (n.type === 'file') return hidden(n.name) ? [] : [n];
  return (n.children ?? []).filter((c) => !c.name.startsWith('.')).flatMap(filesOf);
}

/** 成品排前面，其余按文件名（卡片 01、02… 按数字顺序） */
export function ordered(w: OutputNode) {
  const files = filesOf(w).sort(byName);
  const first = new Set(w.meta?.deliverablePaths ?? []);
  const rank = (f: OutputNode) => (first.has(f.path) ? 0 : 1);
  const sorted = [...files].sort((a, b) => rank(a) - rank(b));
  const media = sorted.filter((f) => f.kind === 'image' || f.kind === 'video');
  const docs = sorted.filter((f) => f.kind === 'text' || f.kind === 'audio');
  // 大图预览里按"先图后文"的顺序翻
  return { media, docs, all: [...media, ...docs] };
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
export function Preview({ files, index, onIndex, onClose }: {
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

