// 设置：会员、作品保存位置、遇到问题、关于。模型和密钥不在这里——由搭子云统一管理，用户看不到。
import { useEffect, useState } from 'react';
import { fetchInfo, openFolder } from '../lib/dazi';
import type { DaziInfo } from '../lib/dazi';
import { formatBytes } from '../lib/format';
import { alertDialog } from '../ui/dialog';
import { Button, Card, Segmented, Tag } from '../ui';
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

export default function SettingsPage({ onReplayGuide }: { onReplayGuide: () => void }) {
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

      <section>
        <h2 className="dz-h2">会员</h2>
        <Card>
          <Row title="测试版" desc="现在免费体验全部功能。正式版上线后，在这里输入激活码开通月度会员。">
            <Tag tone="sun">免费体验中</Tag>
          </Row>
        </Card>
      </section>

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
