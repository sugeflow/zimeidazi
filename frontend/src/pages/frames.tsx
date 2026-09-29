// 页面外框：带标签的页面、尚未上线的页面、AI 创作页的对话历史栏。
import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ChatSession } from '../lib/store';
import type { TabId } from '../shell/routes';
import { Button, Mascot, Segmented } from '../ui';
import { IconNewChat, IconPanel, IconSkills, IconTrash } from '../components/icons';

export function TabbedPage({ title, desc, tab, tabs, onTab, children }: {
  title: string; desc?: string; tab: TabId;
  tabs: { value: TabId; label: string }[]; onTab: (t: TabId) => void; children: ReactNode;
}) {
  return (
    <div className="dz-tabbed">
      <header className="dz-tabbed__head">
        <div>
          <h1 className="dz-title">{title}</h1>
          {desc && <p className="dz-sub">{desc}</p>}
        </div>
        <Segmented label={title} value={tab} options={tabs} onChange={onTab} />
      </header>
      <div className="dz-tabbed__body">{children}</div>
    </div>
  );
}

/** 规划中、还没做的页面：说清楚会有什么，不放假数据 */
export function ComingSoon({ title, desc, points, action }: {
  title: string; desc: string; points: string[]; action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="dz-page dz-soon">
      <Mascot pose="thinking" size={128} />
      <h1 className="dz-title" style={{ marginTop: 20 }}>{title}</h1>
      <p className="dz-sub" style={{ maxWidth: 460 }}>{desc}</p>
      <ul className="dz-soon__list">{points.map((x) => <li key={x}>{x}</li>)}</ul>
      <span className="dz-tag dz-tag--sun">正在开发中</span>
      {action && <div style={{ marginTop: 20 }}><Button variant="secondary" onClick={action.onClick}>{action.label}</Button></div>}
    </div>
  );
}

function when(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 历史栏里的一条：双击改名，删除要再点一次确认 */
function HistoryItem({ s, active, live, onSelect, onDelete, onRename }: {
  s: ChatSession; active: boolean; live: boolean;
  onSelect: () => void; onDelete: () => void; onRename: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const title = s.title || '新的创作';
  const commit = (v: string) => { setEditing(false); if (v.trim() && v.trim() !== s.title) onRename(v.trim()); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(e.currentTarget.value);
    if (e.key === 'Escape') setEditing(false);
  };

  if (confirming) {
    return (
      <div className="dz-history__item is-confirm" role="group" aria-label={`删除「${title}」？`}>
        <span className="dz-history__title">删除「{title}」？</span>
        <span className="dz-history__confirm">
          <Button size="sm" variant="danger" onClick={onDelete}>删除</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>取消</Button>
        </span>
      </div>
    );
  }
  return (
    <div className={`dz-history__item${active ? ' is-active' : ''}`}>
      {editing ? (
        <input className="dz-input dz-history__edit" defaultValue={s.title} autoFocus aria-label="重命名"
          onBlur={(e) => commit(e.target.value)} onKeyDown={onKey} />
      ) : (
        <button className="dz-history__main" onClick={onSelect} onDoubleClick={() => setEditing(true)}
          aria-current={active || undefined} title="双击可以重命名">
          <span className="dz-history__title">{title}</span>
          <span className="dz-history__meta">{live ? <span className="dz-history__live">生成中</span> : when(s.created)}</span>
        </button>
      )}
      {!editing && (
        <button className="dz-history__del" aria-label={`删除「${title}」`} onClick={() => setConfirming(true)}>
          <IconTrash size={14} />
        </button>
      )}
    </div>
  );
}

/** AI 创作页：历史栏 + 对话 + 右侧作品栏（可收起） */
export function CreateFrame({ sessions, activeId, streamingIds, onSelect, onNew, onDelete, onRename, onAllSkills, works, worksOpen, onOpenWorks, children }: {
  sessions: ChatSession[]; activeId: string | null; streamingIds: string[];
  onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void; onAllSkills: () => void;
  /** 新对话还没开始时为空，不显示作品栏 */
  works: ReactNode; worksOpen: boolean; onOpenWorks: () => void; children: ReactNode;
}) {
  const list = sessions.filter((s) => !s.archived);
  const showWorks = Boolean(works) && worksOpen;
  return (
    <div className={`dz-create${showWorks ? ' has-works' : ''}`}>
      <aside className="dz-history" aria-label="对话历史">
        <Button variant="primary" block icon={<IconNewChat size={16} />} onClick={onNew}>新的创作</Button>
        <div className="dz-history__label">历史</div>
        <div className="dz-history__list">
          {list.map((s) => (
            <HistoryItem key={s.id} s={s} active={s.id === activeId} live={streamingIds.includes(s.id)}
              onSelect={() => onSelect(s.id)} onDelete={() => onDelete(s.id)} onRename={(t) => onRename(s.id, t)} />
          ))}
        </div>
        <Button variant="ghost" block icon={<IconSkills size={16} />} onClick={onAllSkills}>全部能力</Button>
      </aside>
      <div className="dz-create__main">
        {children}
        {Boolean(works) && !worksOpen && (
          <button className="dz-works-tab" onClick={onOpenWorks} title="展开作品栏">
            <IconPanel size={16} /><span>这次的作品</span>
          </button>
        )}
      </div>
      {showWorks && works}
    </div>
  );
}
