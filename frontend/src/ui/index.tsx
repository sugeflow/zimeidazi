// 自媒搭子基础组件。样式在 styles/ui.css，token 在 styles/tokens.css。
import type { ButtonHTMLAttributes, CSSProperties, Ref, HTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';

import welcome from '../assets/mascot/welcome.webp';
import thinking from '../assets/mascot/thinking.webp';
import done from '../assets/mascot/done.webp';
import error from '../assets/mascot/error.webp';
import empty from '../assets/mascot/empty.webp';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- 按钮

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'link' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = 'secondary', size = 'md', block, loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx('dz-btn', `dz-btn--${variant}`, size !== 'md' && `dz-btn--${size}`, block && 'dz-btn--block', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="dz-btn__spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- 卡片、标签、角标、药丸

type CardProps = HTMLAttributes<HTMLDivElement> & { interactive?: boolean; sunken?: boolean };

export function Card({ interactive, sunken, className, ...rest }: CardProps) {
  return (
    <div
      className={cx('dz-card', interactive && 'dz-card--interactive', sunken && 'dz-card--sunken', className)}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      {...rest}
    />
  );
}

export type Tone = 'neutral' | 'coral' | 'sun' | 'mint' | 'sky' | 'danger';

export function Tag({ tone = 'neutral', tilt, children }: { tone?: Tone; tilt?: boolean; children: ReactNode }) {
  return <span className={cx('dz-tag', tone !== 'neutral' && `dz-tag--${tone}`, tilt && 'dz-tag--tilt')}>{children}</span>;
}

/** 数字角标；count 为 0 时不显示，超过 99 显示 99+ */
export function Badge({ count, dot, label }: { count?: number; dot?: boolean; label?: string }) {
  if (dot) return <span className="dz-badge dz-badge--dot" aria-label={label} />;
  if (!count) return null;
  return <span className="dz-badge" aria-label={label ?? `${count} 条未处理`}>{count > 99 ? '99+' : count}</span>;
}

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; icon?: ReactNode };

export function Chip({ selected, icon, className, children, ...rest }: ChipProps) {
  return (
    <button type="button" className={cx('dz-chip', className)} aria-pressed={selected} {...rest}>
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- 表单

type FieldProps = { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode };

/** 标签、说明、错误提示与控件正确关联（label for / aria-describedby） */
export function Field({ label, hint, error: err, children }: FieldProps) {
  const id = useId();
  const hintId = hint || err ? `${id}-desc` : undefined;
  return (
    <div className="dz-field">
      <label className="dz-field__label" htmlFor={id}>{label}</label>
      {children(id, hintId)}
      {err ? <span id={hintId} className="dz-field__error">{err}</span> : hint && <span id={hintId} className="dz-field__hint">{hint}</span>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('dz-input', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('dz-textarea', props.className)} />;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="dz-switch">
      <input type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

// ---------------------------------------------------------------- 分段控件、进度条

type SegOption<T extends string> = { value: T; label: ReactNode };

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: SegOption<T>[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="dz-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** value 为 0–100；不传 value 表示进度未知 */
export function Progress({ value, tone = 'coral', label }: { value?: number; tone?: 'coral' | 'sun'; label: string }) {
  const known = typeof value === 'number';
  return (
    <div
      className={cx('dz-progress', tone === 'sun' && 'dz-progress--sun', !known && 'dz-progress--indeterminate')}
      role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? Math.round(value) : undefined}
    >
      <span style={{ width: known ? `${Math.min(100, Math.max(0, value))}%` : undefined }} />
    </div>
  );
}

// ---------------------------------------------------------------- 吉祥物与状态页

export type MascotPose = 'welcome' | 'thinking' | 'done' | 'error' | 'empty';
const POSES: Record<MascotPose, string> = { welcome, thinking, done, error, empty };

export function Mascot({ pose, size = 120, bob }: { pose: MascotPose; size?: number; bob?: boolean }) {
  return (
    <span className={cx('dz-mascot', bob && 'dz-mascot--bob')} style={{ '--_size': `${size}px` } as CSSProperties} aria-hidden>
      <img src={POSES[pose]} alt="" draggable={false} />
    </span>
  );
}

type StateProps = { title: string; desc?: ReactNode; actions?: ReactNode; size?: number };

/** 空状态：还没有内容时告诉用户下一步做什么 */
export function EmptyState({ title, desc, actions, size = 120 }: StateProps) {
  return (
    <div className="dz-state">
      <Mascot pose="empty" size={size} />
      <div className="dz-state__title">{title}</div>
      {desc && <div className="dz-state__desc">{desc}</div>}
      {actions && <div className="dz-state__actions">{actions}</div>}
    </div>
  );
}

/** 加载 / 生成中 */
export function Loading({ title = '搭子正在忙…', desc, progress, size = 108 }: StateProps & { progress?: number }) {
  return (
    <div className="dz-state" role="status" aria-live="polite">
      <Mascot pose="thinking" size={size} bob />
      <div className="dz-state__title">{title}</div>
      {desc && <div className="dz-state__desc">{desc}</div>}
      <div style={{ width: 240 }}><Progress value={progress} label={title} /></div>
    </div>
  );
}

/** 出错：说清楚发生了什么、用户能做什么 */
export function ErrorState({ title, desc, actions, size = 120 }: StateProps) {
  return (
    <div className="dz-state" role="alert">
      <Mascot pose="error" size={size} />
      <div className="dz-state__title">{title}</div>
      {desc && <div className="dz-state__desc">{desc}</div>}
      {actions && <div className="dz-state__actions">{actions}</div>}
    </div>
  );
}

/** 完成 */
export function SuccessState({ title, desc, actions, size = 120 }: StateProps) {
  return (
    <div className="dz-state">
      <Mascot pose="done" size={size} />
      <div className="dz-state__title">{title}</div>
      {desc && <div className="dz-state__desc">{desc}</div>}
      {actions && <div className="dz-state__actions">{actions}</div>}
    </div>
  );
}
