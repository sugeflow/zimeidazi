// 设计系统展示页：地址后加 #design 打开。用于核对组件在浅色 / 深色下的效果，不对用户开放入口。
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Badge, Button, Card, Chip, EmptyState, ErrorState, Field, Input, Loading, Mascot, Progress,
  Segmented, SuccessState, Switch, Tag, Textarea,
} from './index';
import type { MascotPose } from './index';
import { getThemePref, setThemePref } from '../lib/theme';
import type { ThemePref } from '../lib/theme';

const SWATCHES: [string, string][] = [
  ['--dz-bg', '页面底'], ['--dz-surface', '卡片'], ['--dz-surface-2', '凹陷'], ['--dz-line', '分割线'],
  ['--dz-ink', '正文'], ['--dz-ink-2', '次要文字'], ['--dz-ink-3', '占位'],
  ['--dz-coral', '品牌橙'], ['--dz-primary', '主按钮'], ['--dz-coral-soft', '橙·浅'],
  ['--dz-sun', '暖黄'], ['--dz-sun-soft', '黄·浅'], ['--dz-mint-soft', '绿·浅'], ['--dz-sky-soft', '蓝·浅'], ['--dz-danger', '危险'],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 40 }}>
      <h2 className="dz-h2" style={{ marginBottom: 16 }}>{title}</h2>
      {children}
    </section>
  );
}

const row = { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' } as const;

export default function Showcase() {
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [chip, setChip] = useState('小红书图文');
  const [seg, setSeg] = useState('hot');
  const [on, setOn] = useState(true);
  const [loading, setLoading] = useState(false);

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--dz-bg)', color: 'var(--dz-ink)' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 32px 80px' }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 className="dz-h1"><span className="dz-squiggle">设计系统</span></h1>
            <p className="dz-sub" style={{ marginTop: 18 }}>自媒搭子 · 方向 A「暖橙手帐」</p>
          </div>
          <Segmented<ThemePref>
            label="主题" value={theme}
            options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }]}
            onChange={(v) => { setTheme(v); setThemePref(v); }}
          />
        </header>

        <Section title="颜色">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
            {SWATCHES.map(([v, name]) => (
              <div key={v}>
                <div style={{ height: 56, borderRadius: 12, background: `var(${v})`, border: '1.5px solid var(--dz-line)' }} />
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{name}</div>
                <code style={{ fontSize: 11, color: 'var(--dz-ink-2)', fontFamily: 'var(--dz-font-mono)' }}>{v}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="文字">
          <div className="dz-h1">下午好，小林</div>
          <div className="dz-h2" style={{ marginTop: 12 }}>搭子今天帮你挑的选题 <small>结合热点和你的定位</small></div>
          <p style={{ fontSize: 'var(--dz-fs-md)', marginTop: 12, lineHeight: 1.7, maxWidth: 620 }}>
            正文 15px：节前两天「错峰出游」搜索量暴涨 3 倍，这个选题和你的定位高度吻合，建议今晚 20:00 前发出。
          </p>
          <p className="dz-sub" style={{ fontSize: 'var(--dz-fs-sm)', marginTop: 6 }}>次要文字 13.5px：和你近 3 篇高赞笔记风格一致</p>
        </Section>

        <Section title="按钮">
          <div style={row}>
            <Button variant="primary">开始创作</Button>
            <Button variant="secondary">保存草稿</Button>
            <Button variant="ghost">取消</Button>
            <Button variant="link">帮我做成图文 →</Button>
            <Button variant="danger">删除作品</Button>
            <Button variant="primary" disabled>不可用</Button>
            <Button variant="primary" loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1500); }}>
              {loading ? '生成中' : '点我看加载态'}
            </Button>
          </div>
          <div style={{ ...row, marginTop: 12 }}>
            <Button variant="primary" size="sm">小按钮</Button>
            <Button variant="secondary" size="sm">小按钮</Button>
            <Button variant="primary" size="lg">大按钮</Button>
          </div>
        </Section>

        <Section title="卡片 · 标签 · 角标">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <Card interactive>
              <Tag tone="coral" tilt>抖音热榜 · 12.4 万</Tag>
              <div className="dz-card__title" style={{ marginTop: 10 }}>国庆不想人挤人？5 个「反向旅游」小众去处</div>
              <p className="dz-sub" style={{ fontSize: 13, marginBottom: 12 }}>节前两天搜索量暴涨，适合做 6 页攻略卡片</p>
              <Button variant="link">帮我做成图文 →</Button>
            </Card>
            <Card>
              <div className="dz-card__title">普通卡片</div>
              <div style={row}>
                <Tag>草稿</Tag><Tag tone="sun">待确认</Tag><Tag tone="mint">已发布</Tag><Tag tone="sky">定时</Tag><Tag tone="danger">失败</Tag>
              </div>
            </Card>
            <Card sunken>
              <div className="dz-card__title">凹陷卡片</div>
              <div style={row}>互动 <Badge count={6} /> 今天 <Badge count={128} /> 新消息 <Badge dot label="有新消息" /></div>
            </Card>
          </div>
        </Section>

        <Section title="大输入框（跟搭子说）">
          <div className="dz-compose">
            <textarea rows={1} placeholder="比如：帮我写一篇国庆去成都玩的小红书图文，配 6 张卡片" aria-label="想做什么内容" />
            <div className="dz-compose__bar">
              {['小红书图文', '知识卡片', '一键出短视频', '公众号文章'].map((c) => (
                <Chip key={c} selected={chip === c} onClick={() => setChip(c)}>{c}</Chip>
              ))}
              <Button variant="primary">开始 →</Button>
            </div>
          </div>
        </Section>

        <Section title="表单">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 760 }}>
            <Field label="账号名称" hint="会显示在侧边栏顶部">
              {(id, d) => <Input id={id} aria-describedby={d} placeholder="小林的生活记录" />}
            </Field>
            <Field label="主页链接" error="链接格式不对，请复制完整的主页地址">
              {(id, d) => <Input id={id} aria-describedby={d} aria-invalid defaultValue="xiaohongshu" />}
            </Field>
            <Field label="账号简介">
              {(id) => <Textarea id={id} placeholder="一句话介绍你的账号" />}
            </Field>
            <div className="dz-field">
              <span className="dz-field__label">发布成功后通知我</span>
              <div style={row}><Switch checked={on} onChange={setOn} label="发布成功后通知我" /><span className="dz-sub" style={{ fontSize: 13 }}>{on ? '已开启' : '已关闭'}</span></div>
            </div>
          </div>
        </Section>

        <Section title="分段控件 · 进度">
          <Segmented label="找灵感" value={seg} onChange={setSeg}
            options={[{ value: 'hot', label: '热点' }, { value: 'ideas', label: '选题库' }, { value: 'break', label: '拆解爆款' }, { value: 'bench', label: '对标账号' }]} />
          <div style={{ display: 'grid', gap: 12, maxWidth: 420, marginTop: 20 }}>
            <Progress value={68} label="本月额度" tone="sun" />
            <Progress value={50} label="生成进度" />
            <Progress label="准备中" />
          </div>
        </Section>

        <Section title="吉祥物">
          <div style={row}>
            {(['welcome', 'thinking', 'done', 'error', 'empty'] as MascotPose[]).map((p) => <Mascot key={p} pose={p} size={96} />)}
          </div>
        </Section>

        <Section title="状态页">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            <Card><EmptyState title="还没有作品" desc="跟搭子说一句想做什么，第一篇作品几分钟就能做好。" actions={<Button variant="primary">去创作</Button>} /></Card>
            <Card><Loading title="搭子正在画卡片…" desc="第 3 / 6 张，大约还要 1 分钟" progress={50} /></Card>
            <Card><SuccessState title="6 张卡片做好啦" desc="看看效果，满意的话可以直接去发布。" actions={<><Button variant="primary">去发布</Button><Button>再改改</Button></>} /></Card>
            <Card><ErrorState title="抖音需要重新登录" desc="登录状态过期了，周三 12:00 的发布会受影响。重新扫码就好，不会丢失任何内容。" actions={<Button variant="primary">去登录</Button>} /></Card>
          </div>
        </Section>
      </div>
    </div>
  );
}
