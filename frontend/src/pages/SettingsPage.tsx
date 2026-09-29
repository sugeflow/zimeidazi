// 设置：会员、作品保存位置、遇到问题、关于。模型和密钥不在这里——由搭子云统一管理，用户看不到。
import { useEffect, useState } from 'react';
import { activateCode, fetchInfo, openFolder } from '../lib/dazi';
import type { DaziInfo, Membership } from '../lib/dazi';
import { formatBytes } from '../lib/format';
import { alertDialog } from '../ui/dialog';
import { Button, Card, Input, Segmented, Tag } from '../ui';
import { getThemePref, setThemePref } from '../lib/theme';
import type { ThemePref } from '../lib/theme';

function Row({ title, desc, children }: { title: string; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="dz-set-row">
      <div className="dz-set-row__text"><b>{title}</b>{desc && <span>{desc}</span>}</div>
      {children && <div className="dz-set-row__act">{children}</div>}
    </div>
  );
}

const KIND = { chat: '对话', image: '生图', video: '生视频' } as const;

/** 会员：激活、续费、本月额度 */
function MemberSection({ m, onChange }: { m: Membership | null; onChange: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ok = m?.activated && m.state === 'ok' ? m : null;

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await activateCode(code);
      const d = new Date(r.expiresAt * 1000);
      setMsg({ ok: true, text: `激活成功，会员到 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日。重启一下软件，AI 创作就会用上会员的模型。` });
      setCode(''); onChange();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  };

  const state = !m ? '正在查询…'
    : !m.activated ? '输入激活码开通月度会员，激活后所有功能都能用。'
    : m.state === 'ok' ? `还有 ${m.daysLeft} 天到期（${new Date(m.expiresAt * 1000).toLocaleDateString('zh-CN')}），激活码 ${m.code}`
    : m.message;

  return (
    <section>
      <h2 className="dz-h2">会员</h2>
      <Card>
        <div className="dz-set-row">
          <div className="dz-set-row__text"><b>{!m?.activated ? '还没激活' : ok ? '月度会员' : m.state === 'offline' ? '连不上搭子云' : '会员不可用'}</b><span>{state}</span></div>
          {ok && <Tag tone={ok.daysLeft <= 3 ? 'danger' : 'mint'}>{ok.daysLeft <= 3 ? '快到期了' : '使用中'}</Tag>}
        </div>
        {ok && (
          <div className="dz-set-row dz-quota">
            {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => (
              <div key={k}>
                <span>本月{KIND[k]}</span>
                <b>{ok.used[k]}<small> / {ok.quota[k]}</small></b>
                <div className="dz-progress" role="progressbar" aria-label={`本月${KIND[k]}额度`} aria-valuenow={ok.used[k]} aria-valuemin={0} aria-valuemax={ok.quota[k]}>
                  <span style={{ width: `${Math.min(100, (ok.used[k] * 100) / Math.max(1, ok.quota[k]))}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="dz-set-row">
          <div className="dz-set-row__text" style={{ flexDirection: 'row', gap: 8 }}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={ok ? '续费：输入新的激活码，天数会接在后面' : '输入激活码，比如 ABCD-EFGH-JKLM-NPQR'}
              aria-label="激活码" onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) void submit(); }} />
            <Button variant="primary" onClick={submit} loading={busy} disabled={!code.trim()}>{ok ? '续费' : '激活'}</Button>
          </div>
        </div>
        {msg && <p className={`dz-notice dz-notice--${msg.ok ? 'ok' : 'err'}`} role="status" style={{ margin: '0 0 14px' }}>{msg.text}</p>}
      </Card>
    </section>
  );
}

export default function SettingsPage({ membership, onMembershipChange, onReplayGuide }: {
  membership: Membership | null; onMembershipChange: () => void; onReplayGuide: () => void;
}) {
  const [info, setInfo] = useState<DaziInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  useEffect(() => { fetchInfo().then(setInfo).catch(() => setFailed(true)); }, []);

  const open = async (target: 'outputs' | 'logs') => {
    try { await openFolder(target); } catch (e) { await alertDialog((e as Error).message || '打开失败'); }
  };

  return (
    <div className="dz-page dz-settings">
      <header>
        <h1 className="dz-title">设置</h1>
      </header>

      <MemberSection m={membership} onChange={onMembershipChange} />

      <section>
        <h2 className="dz-h2">外观</h2>
        <Card>
          <Row title="深浅色" desc="跟随系统时，电脑切换深色模式，软件也会跟着变。">
            <Segmented label="深浅色" value={theme} onChange={(v) => { setTheme(v); setThemePref(v); }} options={[
              { value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
            ]} />
          </Row>
        </Card>
      </section>

      <section>
        <h2 className="dz-h2">作品</h2>
        <Card>
          <Row
            title="作品保存在"
            desc={info ? <><code className="dz-set-path">{info.outputsDir}</code>，目前占用 {formatBytes(info.outputsBytes)}</> : failed ? '暂时读不到，重启软件后再看看' : '正在读取…'}
          >
            <Button onClick={() => open('outputs')} disabled={!info}>打开文件夹</Button>
          </Row>
        </Card>
      </section>

      <section>
        <h2 className="dz-h2">帮助</h2>
        <Card>
          <Row title="新手引导" desc="重新看一遍：怎么告诉搭子你的账号定位、怎么开始第一篇。">
            <Button onClick={onReplayGuide}>再看一遍</Button>
          </Row>
          <Row title="遇到问题" desc="联系客服时，把日志文件夹里的文件一起发过去，能更快找到原因。">
            <Button variant="ghost" onClick={() => open('logs')} disabled={!info}>打开日志文件夹</Button>
          </Row>
        </Card>
      </section>

      <section>
        <h2 className="dz-h2">关于</h2>
        <Card>
          <Row title="自媒搭子" desc={`版本 ${info?.version ?? '—'}`} />
          <Row
            title="开源许可"
            desc="创作能力基于开源项目 Easel（ZJU-REAL，Apache License 2.0）修改而来，感谢原作者。"
          />
        </Card>
      </section>
    </div>
  );
}
