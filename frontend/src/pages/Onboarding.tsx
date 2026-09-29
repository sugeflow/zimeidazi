// 首次使用：欢迎 → 3 步问答 → 生成账号定位（后端 /api/profile/build，和上游一致）。
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { buildProfile, profileBuildStatus } from '../lib/api';
import { Button, Chip, Mascot, Progress } from '../ui';

const DIRECTIONS = ['美食探店', '穿搭分享', '旅行攻略', '育儿日常', '职场干货', '读书成长', '家居好物', '健身减脂'];
const PLATFORMS = ['小红书', '抖音', '视频号', 'B站', '公众号', '快手', '知乎', '微博'];
const FORMATS = ['图文', '短视频', '长文章'];
const GOALS = ['涨粉', '接广告变现', '带货', '打造个人品牌', '引流到私域'];
const TONES = ['亲切日常', '轻松幽默', '干货实用', '治愈温暖', '专业严谨', '犀利吐槽'];

interface Form {
  direction: string; name: string; nameTouched: boolean;
  platforms: string[]; formats: string[]; accountStage: string; links: Record<string, string>;
  goals: string[]; tone: string; avoid: string;
}

const EMPTY: Form = {
  direction: '', name: '', nameTouched: false,
  platforms: ['小红书'], formats: ['图文'], accountStage: '全新起号', links: {},
  goals: [], tone: '', avoid: '',
};

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function Shell({ children, onClose, closable = true }: { children: ReactNode; onClose: () => void; closable?: boolean }) {
  useEffect(() => {
    if (!closable) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [closable, onClose]);
  return (
    <div className="dz-dialog__scrim">
      <div className="dz-dialog dz-guide" role="dialog" aria-modal="true" aria-label="新手引导">{children}</div>
    </div>
  );
}

/** 第一次打开时的欢迎 */
export function Welcome({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <Shell onClose={onSkip}>
      <div className="dz-guide__welcome">
        <Mascot pose="welcome" size={120} />
        <h2 className="dz-h1">欢迎来到自媒搭子</h2>
        <p className="dz-sub">先花 1 分钟，告诉搭子你想做什么内容、发在哪。之后写出来的东西会更像你，不用每次都重新交代。</p>
        <div className="dz-guide__actions">
          <Button variant="ghost" onClick={onSkip}>先随便逛逛</Button>
          <Button variant="primary" size="lg" onClick={onStart} autoFocus>开始，1 分钟</Button>
        </div>
      </div>
    </Shell>
  );
}

function Q({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="dz-guide__q">
      <b>{title}</b>
      {hint && <span>{hint}</span>}
      <div className="dz-guide__opts">{children}</div>
    </div>
  );
}

/** 3 步问答 */
export function Wizard({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(EMPTY);
  const [phase, setPhase] = useState<'form' | 'saving' | 'enhancing'>('form');
  const [error, setError] = useState('');
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));

  // 名字默认跟着方向走，用户自己改过就不再覆盖
  const setDirection = (direction: string) =>
    setF((x) => ({ ...x, direction, name: x.nameTouched ? x.name : direction.trim() ? `我的${direction.trim().slice(0, 10)}号` : '' }));

  const canNext = step === 0 ? Boolean(f.direction.trim() && f.name.trim()) : step === 1 ? f.platforms.length > 0 : true;

  const submit = async () => {
    setPhase('saving');
    setError('');
    const name = f.name.trim();
    try {
      // 字段名沿用上游表单，后端据此写账号定位
      const res = await buildProfile(name, {
        name, direction: f.direction.trim(), platforms: f.platforms, accountStage: f.accountStage,
        links: f.links, formats: f.formats.join('、'), goal: f.goals.join('、'), tone: f.tone,
        avoid: f.avoid.trim(), reason: '', likes: '',
      });
      if (!res.created) throw new Error('没有创建成功，再试一次');
      setPhase('enhancing');
    } catch (e) {
      setError(e instanceof Error ? e.message : '没有创建成功，再试一次');
      setPhase('form');
    }
  };

  // 后台会根据主页链接等补充定位细节，完成后进入；也可以不等
  useEffect(() => {
    if (phase !== 'enhancing') return;
    let alive = true;
    const name = f.name.trim();
    const tick = async () => {
      try {
        const st = await profileBuildStatus(name);
        if (!alive) return;
        if (st.state !== 'running') { onCreated(name); return; }
      } catch { /* 查询失败就继续等 */ }
      if (alive) setTimeout(tick, 5000);
    };
    const t = setTimeout(tick, 4000);
    return () => { alive = false; clearTimeout(t); };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase !== 'form') {
    return (
      <Shell onClose={onClose} closable={false}>
        <div className="dz-guide__welcome" role="status" aria-live="polite">
          <Mascot pose={phase === 'saving' ? 'thinking' : 'done'} size={112} bob={phase === 'saving'} />
          <h2 className="dz-h2">{phase === 'saving' ? '正在记下来…' : `「${f.name.trim()}」建好了`}</h2>
          <p className="dz-sub">
            {phase === 'saving' ? '马上就好。' : '搭子还在后台补充细节，大概一两分钟。不用等，现在就可以开始创作。'}
          </p>
          {phase === 'enhancing' && (
            <>
              <div style={{ width: 240 }}><Progress label="正在补充账号定位" /></div>
              <div className="dz-guide__actions"><Button variant="primary" onClick={() => onCreated(f.name.trim())}>开始创作</Button></div>
            </>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      <header className="dz-guide__head">
        <span className="dz-muted">第 {step + 1} 步，共 3 步</span>
        <button className="dz-icon-btn" onClick={onClose} aria-label="关闭">×</button>
      </header>
      <div className="dz-guide__steps" aria-hidden>{[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'is-on' : ''} />)}</div>

      {step === 0 && (
        <>
          <h2 className="dz-h2">你想做什么内容？</h2>
          <Q title="内容方向" hint="越具体越好，比如「上班族的平价穿搭」比「穿搭」好">
            <input className="dz-input" value={f.direction} onChange={(e) => setDirection(e.target.value)} placeholder="写一句，或者点下面的例子" autoFocus aria-label="内容方向" />
            <div className="dz-guide__chips">
              {DIRECTIONS.map((d) => <Chip key={d} selected={f.direction === d} onClick={() => setDirection(d)}>{d}</Chip>)}
            </div>
          </Q>
          <Q title="给这个账号起个名字" hint="只有你自己看得到，用来区分多个账号">
            <input className="dz-input" value={f.name} onChange={(e) => set({ name: e.target.value, nameTouched: true })} aria-label="账号名字" maxLength={20} />
          </Q>
        </>
      )}

      {step === 1 && (
        <>
          <h2 className="dz-h2">发在哪里？</h2>
          <Q title="平台" hint="可以多选">
            {PLATFORMS.map((p) => <Chip key={p} selected={f.platforms.includes(p)} onClick={() => set({ platforms: toggle(f.platforms, p) })}>{p}</Chip>)}
          </Q>
          <Q title="主要做什么形式">
            {FORMATS.map((p) => <Chip key={p} selected={f.formats.includes(p)} onClick={() => set({ formats: toggle(f.formats, p) })}>{p}</Chip>)}
          </Q>
          <Q title="账号现在是">
            {['全新起号', '已有账号'].map((s) => <Chip key={s} selected={f.accountStage === s} onClick={() => set({ accountStage: s })}>{s}</Chip>)}
          </Q>
          {f.accountStage === '已有账号' && (
            <Q title="主页链接（可以不填）" hint="填了的话，搭子会去看看你发过的内容，学你的风格">
              <div className="dz-guide__links">
                {f.platforms.map((p) => (
                  <label key={p}><span>{p}</span>
                    <input className="dz-input" value={f.links[p] || ''} placeholder="https://…" onChange={(e) => set({ links: { ...f.links, [p]: e.target.value } })} />
                  </label>
                ))}
              </div>
            </Q>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <h2 className="dz-h2">想要什么感觉？</h2>
          <Q title="说话的调性">
            {TONES.map((t) => <Chip key={t} selected={f.tone === t} onClick={() => set({ tone: f.tone === t ? '' : t })}>{t}</Chip>)}
          </Q>
          <Q title="做账号是为了" hint="可以多选">
            {GOALS.map((g) => <Chip key={g} selected={f.goals.includes(g)} onClick={() => set({ goals: toggle(f.goals, g) })}>{g}</Chip>)}
          </Q>
          <Q title="有没有不想碰的内容（可以不填）">
            <input className="dz-input" value={f.avoid} onChange={(e) => set({ avoid: e.target.value })} placeholder="比如：不接医美广告，不说脏话" aria-label="不想碰的内容" />
          </Q>
        </>
      )}

      {error && <p className="dz-field__error" role="alert" style={{ marginTop: 12 }}>{error}</p>}

      <footer className="dz-guide__actions">
        <Button variant="ghost" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>{step === 0 ? '以后再说' : '上一步'}</Button>
        {step < 2
          ? <Button variant="primary" onClick={() => setStep(step + 1)} disabled={!canNext}>下一步</Button>
          : <Button variant="primary" onClick={submit}>完成</Button>}
      </footer>
    </Shell>
  );
}
