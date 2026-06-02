'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PARTS_CATALOG, RocketPart, PartType } from '@/lib/game/career/Parts';
import { RocketBuild, StageSpec, DEFAULT_BUILD } from '@/lib/game/types';
import { computeStats, estimateBuildDeltaV, getStages } from '@/lib/game/BuildSpec';
import { loadBuild, saveBuild, loadUnlockedParts } from '@/lib/storage';

const CATEGORY_ORDER: { type: PartType; label: string }[] = [
  { type: 'engine',  label: 'Engines' },
  { type: 'tank',    label: 'Tanks'   },
  { type: 'nose',    label: 'Noses'   },
  { type: 'capsule', label: 'Capsules'},
  { type: 'utility', label: 'Utility' },
];

/** Keep the legacy engineId/tankIds mirrored to stage 0 for save compatibility. */
function withStages(build: RocketBuild, stages: StageSpec[]): RocketBuild {
  const safe = stages.length > 0 ? stages : [{ engineId: 'engine-basic', tankIds: ['tank-basic'] }];
  return {
    ...build,
    stages: safe,
    engineId: safe[0].engineId,
    tankIds:  safe[0].tankIds,
  };
}

export default function RocketBuilder() {
  const router = useRouter();
  const [build, setBuild] = useState<RocketBuild>(DEFAULT_BUILD);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [selectedStage, setSelectedStage] = useState(0);

  useEffect(() => {
    setBuild(loadBuild());
    const unlockedIds = new Set(loadUnlockedParts());
    PARTS_CATALOG.forEach((p) => { if (p.unlockedByDefault) unlockedIds.add(p.id); });
    setUnlocked(unlockedIds);
  }, []);

  const stages = useMemo(() => getStages(build), [build]);
  const stats  = useMemo(() => computeStats(build), [build]);
  const deltaV = useMemo(() => estimateBuildDeltaV(build), [build]);

  const partsByCategory = useMemo(() => {
    const map = new Map<PartType, RocketPart[]>();
    PARTS_CATALOG.forEach((p) => {
      const list = map.get(p.type) ?? [];
      list.push(p);
      map.set(p.type, list);
    });
    return map;
  }, []);

  const activeStage = Math.min(selectedStage, stages.length - 1);

  const setStageEngine = (id: string) =>
    setBuild((b) => {
      const s = getStages(b).map((st, i) => (i === activeStage ? { ...st, engineId: id } : st));
      return withStages(b, s);
    });

  const addTankToStage = (id: string) =>
    setBuild((b) => {
      const s = getStages(b).map((st, i) =>
        i === activeStage ? { ...st, tankIds: [...st.tankIds, id] } : st);
      return withStages(b, s);
    });

  const removeTankFromStage = (si: number, index: number) =>
    setBuild((b) => {
      const s = getStages(b).map((st, i) =>
        i === si ? { ...st, tankIds: st.tankIds.filter((_, k) => k !== index) } : st);
      return withStages(b, s);
    });

  const addStage = () =>
    setBuild((b) => {
      const s = [...getStages(b), { engineId: 'engine-basic', tankIds: ['tank-basic'] }];
      setSelectedStage(s.length - 1);
      return withStages(b, s);
    });

  const removeStage = (si: number) =>
    setBuild((b) => {
      const cur = getStages(b);
      if (cur.length <= 1) return b;
      const s = cur.filter((_, i) => i !== si);
      setSelectedStage((sel) => Math.max(0, Math.min(sel, s.length - 1)));
      return withStages(b, s);
    });

  const setNose = (id: string) => setBuild((b) => ({ ...b, noseId: id }));
  const toggleUtility = (id: string) =>
    setBuild((b) => ({
      ...b,
      utilityIds: b.utilityIds.includes(id)
        ? b.utilityIds.filter((x) => x !== id)
        : [...b.utilityIds, id],
    }));

  const saveAndLaunch = () => {
    saveBuild(build);
    router.push('/play');
  };

  const reset = () => { setBuild(DEFAULT_BUILD); setSelectedStage(0); };

  return (
    <main className="fixed inset-0 overflow-hidden flex flex-col bg-bg">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between gap-2 px-4 py-3
                         pt-[calc(0.75rem+env(safe-area-inset-top))] border-b border-white/5">
        <Link href="/" className="w-10 h-10 rounded-full border border-white/15 bg-white/5
                                  flex items-center justify-center text-ink hover:border-white/30 active:scale-95">←</Link>
        <h1 className="text-base sm:text-xl font-black tracking-widest text-ink">ROCKET BUILDER</h1>
        <button onClick={reset} aria-label="Reset"
                className="w-10 h-10 rounded-full border border-white/15 bg-white/5
                           flex items-center justify-center text-dim hover:text-ink hover:border-white/30 active:scale-95">↻</button>
      </header>

      {/* Body — split layout */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 sm:grid-cols-[260px_1fr] gap-3 p-3">
        {/* Visual stack */}
        <aside className="panel p-4 overflow-y-auto flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="stat-label">Your Rocket</h2>
            <span className="text-[10px] text-dim tabular-nums">{stages.length} stage{stages.length > 1 ? 's' : ''}</span>
          </div>
          <RocketStack
            stages={stages}
            noseId={build.noseId}
            utilityIds={build.utilityIds}
            selectedStage={activeStage}
            onSelectStage={setSelectedStage}
            onRemoveTank={removeTankFromStage}
            onRemoveStage={removeStage}
          />
          <button onClick={addStage}
                  className="mt-3 w-full rounded-lg border border-dashed border-cyan/40 bg-cyan/[0.06]
                             text-cyan text-xs font-bold py-2 hover:bg-cyan/15 active:scale-[0.98]">
            ＋ Add Stage
          </button>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Stat label="Dry mass" value={`${stats.dryMass.toFixed(2)} t`} />
            <Stat label="Wet mass" value={`${stats.wetMass.toFixed(2)} t`} />
            <Stat label="Thrust"   value={`${stats.thrust.toFixed(0)} kN`} />
            <Stat label="Fuel"     value={`${stats.fuelCapacity.toFixed(0)} L`} />
            <Stat label="Δv (est)" value={`${deltaV.toFixed(0)} m/s`} highlight />
            <Stat label="TWR"      value={
              stats.wetMass > 0
                ? (stats.thrust / (stats.wetMass * 9.81)).toFixed(2)
                : '—'
            } />
          </div>
          <button onClick={saveAndLaunch} className="btn btn-primary mt-4 w-full text-base py-3">
            🚀 Save &amp; Launch
          </button>
        </aside>

        {/* Palette */}
        <section className="panel p-4 overflow-y-auto">
          <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-dim">
            Editing <span className="text-cyan font-bold">Stage {activeStage + 1}</span>
            {' '}· engines &amp; tanks apply to this stage. Lower stages fire and drop first.
          </div>
          {CATEGORY_ORDER.map(({ type, label }) => {
            const items = partsByCategory.get(type) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={type} className="mb-5">
                <h3 className="stat-label mb-2">{label}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {items.map((p) => {
                    const isUnlocked = unlocked.has(p.id);
                    const selected = isSelected(build, stages[activeStage], p);
                    return (
                      <button
                        key={p.id}
                        disabled={!isUnlocked}
                        onClick={() => {
                          if (!isUnlocked) return;
                          if (p.type === 'engine')  setStageEngine(p.id);
                          else if (p.type === 'tank') addTankToStage(p.id);
                          else if (p.type === 'nose' || p.type === 'capsule') setNose(p.id);
                          else if (p.type === 'utility') toggleUtility(p.id);
                        }}
                        className={`text-left rounded-xl border p-3 transition-all active:scale-[0.98]
                                    ${selected ? 'border-cyan/70 bg-cyan/10 shadow-[0_0_14px_rgba(0,229,255,0.25)]' :
                                                isUnlocked ? 'border-white/10 bg-white/[0.04] hover:border-white/30' :
                                                            'border-white/5 bg-white/[0.02] opacity-40 cursor-not-allowed'}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl" style={{ color: `#${p.color.toString(16).padStart(6, '0')}` }}>
                            {p.icon}
                          </span>
                          <span className="text-xs font-bold text-ink truncate">{p.name}</span>
                          {!isUnlocked && <span className="ml-auto text-[10px]">🔒</span>}
                        </div>
                        <div className="text-[10px] text-dim line-clamp-2">{p.description}</div>
                        <PartStats part={p} />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}

function isSelected(build: RocketBuild, stage: StageSpec | undefined, p: RocketPart): boolean {
  if (p.type === 'engine')  return stage?.engineId === p.id;
  if (p.type === 'tank')    return !!stage?.tankIds.includes(p.id);
  if (p.type === 'nose' || p.type === 'capsule') return build.noseId === p.id;
  if (p.type === 'utility') return build.utilityIds.includes(p.id);
  return false;
}

function PartStats({ part }: { part: RocketPart }) {
  if (part.type === 'engine') {
    return (
      <div className="mt-2 flex gap-2 text-[9px] tabular-nums text-dim">
        <span className="text-orange">⚡ {part.thrust} kN</span>
        <span>· {part.burnRate} L/s</span>
      </div>
    );
  }
  if (part.type === 'tank') {
    return <div className="mt-2 text-[9px] tabular-nums text-cyan">⛽ {part.fuelCapacity} L</div>;
  }
  return <div className="mt-2 text-[9px] tabular-nums text-dim">{part.mass} t</div>;
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="stat-label">{label}</span>
      <span className={`tabular-nums font-bold ${highlight ? 'text-cyan' : 'text-ink'}`}>{value}</span>
    </div>
  );
}

function RocketStack({
  stages, noseId, utilityIds, selectedStage,
  onSelectStage, onRemoveTank, onRemoveStage,
}: {
  stages: StageSpec[];
  noseId: string;
  utilityIds: string[];
  selectedStage: number;
  onSelectStage: (i: number) => void;
  onRemoveTank: (stageIndex: number, tankIndex: number) => void;
  onRemoveStage: (stageIndex: number) => void;
}) {
  const noseColor = colorFor(noseId);

  return (
    <div className="relative flex flex-col items-center mx-auto" style={{ width: 132 }}>
      {/* Nose */}
      <div className="w-0 h-0"
           style={{
             borderLeft: '24px solid transparent',
             borderRight: '24px solid transparent',
             borderBottom: `48px solid ${noseColor}`,
           }} />

      {/* Stages, top-most stage first in DOM */}
      {stages.map((_, idx) => stages.length - 1 - idx).map((si) => {
        const stage = stages[si];
        const selected = si === selectedStage;
        return (
          <button
            key={si}
            type="button"
            onClick={() => onSelectStage(si)}
            className={`relative w-full flex flex-col items-center rounded-md py-1.5 my-0.5 transition
                        border ${selected ? 'border-cyan/70 bg-cyan/[0.08]' : 'border-transparent hover:border-white/15'}`}
          >
            <span className={`absolute -left-0.5 top-1 text-[8px] font-black tracking-wider
                              ${selected ? 'text-cyan' : 'text-dim'}`}>S{si + 1}</span>

            {/* Tanks (top to bottom) */}
            {stage.tankIds.map((id, ti) => (
              <div key={ti} className="relative w-12 h-12 border-x-2 border-black/30"
                   style={{ background: colorFor(id) }}>
                <span
                  onClick={(e) => { e.stopPropagation(); onRemoveTank(si, ti); }}
                  className="absolute -right-6 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full
                             bg-red/20 text-red text-[10px] leading-5 text-center border border-red/40
                             hover:bg-red/40 active:scale-90 cursor-pointer"
                  aria-label="Remove tank">✕</span>
              </div>
            ))}

            {/* Engine */}
            <div className="w-14 h-5"
                 style={{
                   background: colorFor(stage.engineId),
                   clipPath: 'polygon(8% 0, 92% 0, 100% 100%, 0 100%)',
                 }} />

            {stages.length > 1 && (
              <span
                onClick={(e) => { e.stopPropagation(); onRemoveStage(si); }}
                className="absolute -right-6 top-1 w-5 h-5 rounded-full bg-white/10 text-dim text-[9px]
                           leading-5 text-center border border-white/20 hover:text-red hover:border-red/40
                           active:scale-90 cursor-pointer"
                aria-label="Remove stage">🗑</span>
            )}
          </button>
        );
      })}

      {utilityIds.length > 0 && (
        <div className="mt-2 flex flex-wrap justify-center gap-1 text-[10px]">
          {utilityIds.map((id) => {
            const p = PARTS_CATALOG.find((x) => x.id === id);
            if (!p) return null;
            return <span key={id} className="pill px-2 py-0.5 text-dim">{p.icon}</span>;
          })}
        </div>
      )}
    </div>
  );
}

function colorFor(id: string): string {
  const p = PARTS_CATALOG.find((x) => x.id === id);
  if (!p) return '#888';
  return `#${p.color.toString(16).padStart(6, '0')}`;
}
