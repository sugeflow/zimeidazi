// 全部能力：114 个技能按"我要做什么"分组，点一个就带着它开始一次创作。
import { useEffect, useMemo, useState } from 'react';
import { fetchSkills } from '../lib/api';
import type { SkillItem } from '../lib/api';
import { displayName } from '../lib/skillDisplayNames';
import { SCENARIOS, scenarioOf } from '../lib/templates';
import { Button, Chip, EmptyState, ErrorState, Loading } from '../ui';
import { IconSearch } from '../components/icons';

/** 上游的描述有的很长、有的是英文开头的说明，只取第一句 */
function shortDesc(s: SkillItem) {
  const d = (s.description || '').replace(/\s+/g, ' ').trim();
  const first = d.split(/(?<=[。！？!?；;])|(?<=\.)\s/)[0] || d;
  return first.length > 60 ? `${first.slice(0, 58)}…` : first;
}

export default function AbilitiesPage({ onUse, onBack }: { onUse: (skill: string, label: string) => void; onBack: () => void }) {
  const [skills, setSkills] = useState<SkillItem[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [scene, setScene] = useState('all');

  const load = () => { setError(false); fetchSkills().then(setSkills).catch(() => setError(true)); };
  useEffect(load, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (s: SkillItem) => !q || displayName(s.name).toLowerCase().includes(q)
      || s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q);
    return SCENARIOS.map((sc) => ({
      ...sc,
      items: (skills ?? []).filter((s) => scenarioOf(s.name, s.layer) === sc.id && hit(s)),
    })).filter((g) => g.items.length && (scene === 'all' || g.id === scene));
  }, [skills, query, scene]);

  return (
    <div className="dz-page dz-abilities">
      <header>
        <Button variant="link" onClick={onBack}>← 回到 AI 创作</Button>
        <h1 className="dz-title" style={{ marginTop: 10 }}>搭子的全部能力</h1>
        <p className="dz-sub">
          {skills ? `一共 ${skills.length} 项。` : ''}平时直接跟搭子说想做什么就行，它会自己挑合适的能力；想指定用哪个，就在这里点一下。
        </p>
      </header>

      <div className="dz-abilities__tools">
        <label className="dz-search">
          <IconSearch size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜一搜，比如：封面、字幕、去 AI 味" aria-label="搜索能力" />
        </label>
        <div className="dz-abilities__chips">
          <Chip selected={scene === 'all'} onClick={() => setScene('all')}>全部</Chip>
          {SCENARIOS.map((s) => (
            <Chip key={s.id} selected={scene === s.id} onClick={() => setScene(s.id)}><span aria-hidden>{s.emoji}</span>{s.label}</Chip>
          ))}
        </div>
      </div>

      {error && <ErrorState title="能力列表没加载出来" desc="搭子可能还在启动，稍等几秒再试。" actions={<Button onClick={load}>重试</Button>} />}
      {!error && !skills && <Loading title="正在加载…" />}
      {skills && groups.length === 0 && <EmptyState title={`没找到「${query}」`} desc="换个说法试试，或者直接去 AI 创作里跟搭子说。" />}

      {groups.map((g) => (
        <section key={g.id}>
          <h2 className="dz-h2"><span aria-hidden>{g.emoji}</span>{g.label}<small>{g.desc}</small></h2>
          <div className="dz-ability-grid">
            {g.items.map((s) => {
              const label = displayName(s.name);
              return (
                <button key={s.name} className="dz-ability" onClick={() => onUse(s.name, label)}>
                  <b>{label}</b>
                  <span>{shortDesc(s)}</span>
                  <i>用它来做 →</i>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
