// AI 创作页右侧：这次创作做出来的作品，生成过程中实时出现。
import { useMemo, useState } from 'react';
import { mediaUrl } from '../lib/api';
import type { OutputNode } from '../lib/api';
import type { ChatSession, StreamState } from '../lib/store';
import { Button, Mascot, Tag } from '../ui';
import { IconFile, IconMusic, IconPanel, IconVideo } from '../components/icons';
import { latestMtime, useSessionWorks } from './useSessionWorks';
import { Preview, isHtml, ordered } from './workFiles';

const KIND_LABEL: Record<string, string> = {
  article: '文章', 'xhs-note': '小红书', video: '视频', cards: '卡片', poster: '海报', audio: '音频',
};
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
