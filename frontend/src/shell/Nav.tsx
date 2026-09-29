// 侧边导航：今天 / 创作 / 运营三组 + 账号与定位、会员卡、设置。
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PersonaItem } from '../lib/api';
import type { Navigate, PageId } from './routes';
import { Badge } from '../ui';
import {
  IconChart, IconChat, IconChevron, IconHome, IconIdea, IconLayers, IconPlus, IconProfile, IconPublish, IconSettings, IconSkills,
} from '../components/icons';
import logo from '../assets/brand/logo.png';

export interface NavCounts { today?: number; engage?: number }

/** 会员信息；M3 接入激活码之前为 null */
export interface Membership { daysLeft: number; usedPct: number }

type Props = {
  page: PageId;
  onNavigate: Navigate;
  personas: PersonaItem[];
  persona: string;
  onPersonaChange: (name: string) => void;
  onNewPersona: () => void;
  counts: NavCounts;
  membership: Membership | null;
  gatewayOnline: boolean | null;
};

function Item({ id, page, icon, label, count, onNavigate }: {
  id: PageId; page: PageId; icon: ReactNode; label: string; count?: number; onNavigate: Navigate;
}) {
  const active = id === page || (id === 'create' && page === 'skills');
  return (
    <button className={`dz-nav__item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => onNavigate(id)}>
      <span className="dz-nav__icon">{icon}</span>
      <span className="dz-nav__label">{label}</span>
      <Badge count={count} />
    </button>
  );
}

function PersonaSwitcher({ personas, persona, onChange, onNew }: {
  personas: PersonaItem[]; persona: string; onChange: (n: string) => void; onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const pick = (name: string) => { onChange(name); setOpen(false); };
  return (
    <div className="dz-who" ref={ref}>
      <button className="dz-who__btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="dz-who__hint">{persona ? '正在为这个账号创作' : '还没选账号定位'}</span>
        <span className="dz-who__name">
          <span>{persona || '通用模式'}</span>
          <IconChevron size={14} className={open ? 'dz-chev is-open' : 'dz-chev'} />
        </span>
      </button>
      {open && (
        <div className="dz-who__menu" role="listbox" aria-label="切换账号定位">
          {personas.map((p) => (
            <button key={p.name} role="option" aria-selected={p.name === persona} onClick={() => pick(p.name)}>
              {p.name}
            </button>
          ))}
          <button role="option" aria-selected={!persona} onClick={() => pick('')}>
            通用模式<small>不按任何账号定位来写</small>
          </button>
          <button className="dz-who__new" onClick={() => { setOpen(false); onNew(); }}>
            <IconPlus size={14} /> 新建账号定位
          </button>
        </div>
      )}
    </div>
  );
}

export default function Nav(p: Props) {
  const nav = (id: PageId, icon: ReactNode, label: string, count?: number) => (
    <Item id={id} page={p.page} icon={icon} label={label} count={count} onNavigate={p.onNavigate} />
  );
  return (
    <aside className="dz-nav" aria-label="主导航">
      <div className="dz-nav__brand"><img src={logo} alt="" />自媒搭子</div>
      <PersonaSwitcher personas={p.personas} persona={p.persona} onChange={p.onPersonaChange} onNew={p.onNewPersona} />

      <nav className="dz-nav__list">
        {nav('today', <IconHome />, '今天', p.counts.today)}
        <div className="dz-nav__group">创作</div>
        {nav('inspire', <IconIdea />, '找灵感')}
        {nav('create', <IconSkills />, 'AI 创作')}
        {nav('works', <IconLayers />, '作品库')}
        <div className="dz-nav__group">运营</div>
        {nav('publish', <IconPublish />, '发布')}
        {nav('engage', <IconChat />, '互动', p.counts.engage)}
        {nav('data', <IconChart />, '数据')}
      </nav>

      <div className="dz-nav__bottom">
        {p.gatewayOnline === false && (
          <div className="dz-nav__alert" role="status">搭子的大脑暂时没连上，稍等一下或重启软件</div>
        )}
        {nav('accounts', <IconProfile />, '账号与定位')}
        {p.membership ? (
          <div className="dz-vip">
            <b>月度会员</b>
            <span>本月额度已用 {p.membership.usedPct}%</span>
            <div className="dz-progress dz-progress--sun" role="progressbar" aria-label="本月额度" aria-valuenow={p.membership.usedPct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${p.membership.usedPct}%` }} />
            </div>
            <span>还有 {p.membership.daysLeft} 天到期</span>
          </div>
        ) : (
          <div className="dz-vip"><b>测试版</b><span>免费体验中，正式版上线后需要激活</span></div>
        )}
        {nav('settings', <IconSettings />, '设置')}
      </div>
    </aside>
  );
}
