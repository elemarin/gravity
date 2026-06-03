'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PARTS_CATALOG, RocketPart, PartType } from '@/lib/game/career/Parts';
import { RocketBuild, StageSpec, DEFAULT_BUILD } from '@/lib/game/types';
import { computeStats, estimateBuildDeltaV, getStages, buildPartIds } from '@/lib/game/BuildSpec';
import { loadBuild, saveBuild, loadUnlockedParts, loadFacilityLevel } from '@/lib/storage';
import { facilityTier } from '@/lib/game/career/Progress';
import { ROCKET_PRESETS, RocketPreset } from '@/lib/game/career/Presets';
import NavDrawer from './NavDrawer';

const CATEGORIES: { type: PartType; label: string; short: string }[] = [
  { type: 'engine',  label: 'Engines',  short: 'ENG'   },
  { type: 'booster', label: 'Boosters', short: 'BOOST' },
  { type: 'tank',    label: 'Tanks',    short: 'TANK'  },
  { type: 'nose',    label: 'Nose',     short: 'NOSE'  },
  { type: 'lander',  label: 'Landers',  short: 'LAND'  },
  { type: 'utility', label: 'Utility',  short: 'UTIL'  },
];

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
  const [activeCategory, setActiveCategory] = useState<PartType>('engine');
  const [facilityLevel, setFacilityLevel] = useState(0);

  useEffect(() => {
    setBuild(loadBuild());
    const ids = new Set(loadUnlockedParts());
    PARTS_CATALOG.forEach((p) => { if (p.unlockedByDefault) ids.add(p.id); });
    setUnlocked(ids);
    setFacilityLevel(loadFacilityLevel());
  }, []);

  const tier    = facilityTier(facilityLevel);
  const stages  = useMemo(() => getStages(build), [build]);
  const stats   = useMemo(() => computeStats(build), [build]);
  const deltaV  = useMemo(() => estimateBuildDeltaV(build), [build]);
  const activeStage = Math.min(selectedStage, stages.length - 1);
  const overMass = stats.wetMass > tier.maxMass;
  const atStageLimit = stages.length >= tier.maxStages;

  const categoryParts = useMemo(
    () => PARTS_CATALOG.filter((p) => p.type === activeCategory),
    [activeCategory],
  );

  const setStageEngine = (id: string) =>
    setBuild((b) => withStages(b, getStages(b).map((st, i) => i === activeStage ? { ...st, engineId: id } : st)));

  const addTankToStage = (id: string) =>
    setBuild((b) => withStages(b, getStages(b).map((st, i) => i === activeStage ? { ...st, tankIds: [...st.tankIds, id] } : st)));

  const removeTankFromStage = (si: number, ti: number) =>
    setBuild((b) => withStages(b, getStages(b).map((st, i) => i === si ? { ...st, tankIds: st.tankIds.filter((_, k) => k !== ti) } : st)));

  const addStage = () =>
    setBuild((b) => {
      if (getStages(b).length >= tier.maxStages) return b;
      const s = [...getStages(b), { engineId: 'engine-basic', tankIds: ['tank-basic'] }];
      setSelectedStage(s.length - 1);
      return withStages(b, s);
    });

  const toggleBooster = (id: string) =>
    setBuild((b) => {
      const cur = b.boosterIds ?? [];
      const has = cur.includes(id);
      // Cap strap-ons at four for sane geometry.
      const next = has ? cur.filter((x) => x !== id) : (cur.length >= 4 ? cur : [...cur, id]);
      return { ...b, boosterIds: next };
    });

  const removeStage = (si: number) =>
    setBuild((b) => {
      const cur = getStages(b);
      if (cur.length <= 1) return b;
      const s = cur.filter((_, i) => i !== si);
      setSelectedStage((sel) => Math.max(0, Math.min(sel, s.length - 1)));
      return withStages(b, s);
    });

  const loadPreset = (p: RocketPreset) => {
    setBuild({ ...p.build, stages: p.build.stages?.map((s) => ({ ...s, tankIds: [...s.tankIds] })) });
    setSelectedStage(0);
    setActiveCategory('engine');
  };
  const presetLocked = (p: RocketPreset) => buildPartIds(p.build).some((id) => !unlocked.has(id));

  const setNose = (id: string) => setBuild((b) => ({ ...b, noseId: id }));
  const toggleLander = (id: string) => setBuild((b) => ({ ...b, landerId: b.landerId === id ? undefined : id }));
  const toggleUtility = (id: string) =>
    setBuild((b) => ({
      ...b,
      utilityIds: b.utilityIds.includes(id) ? b.utilityIds.filter((x) => x !== id) : [...b.utilityIds, id],
    }));

  const handlePartTap = (p: RocketPart) => {
    if (!unlocked.has(p.id)) return;
    if (p.type === 'engine')  setStageEngine(p.id);
    else if (p.type === 'booster') toggleBooster(p.id);
    else if (p.type === 'tank') addTankToStage(p.id);
    else if (p.type === 'nose' || p.type === 'capsule') setNose(p.id);
    else if (p.type === 'lander') toggleLander(p.id);
    else if (p.type === 'utility') toggleUtility(p.id);
  };

  const isSelected = (p: RocketPart): boolean => {
    const stage = stages[activeStage];
    if (p.type === 'engine')  return stage?.engineId === p.id;
    if (p.type === 'booster') return !!build.boosterIds?.includes(p.id);
    if (p.type === 'tank')    return !!stage?.tankIds.includes(p.id);
    if (p.type === 'nose' || p.type === 'capsule') return build.noseId === p.id;
    if (p.type === 'lander')  return build.landerId === p.id;
    if (p.type === 'utility') return build.utilityIds.includes(p.id);
    return false;
  };

  const twr = stats.wetMass > 0 ? (stats.thrust / (stats.wetMass * 9.81)) : 0;

  return (
    <main className="fixed inset-0 flex flex-col bg-bg overflow-hidden"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <NavDrawer title="Build Menu" />

      {/* ── Header ── */}
      <header className="shrink-0 flex items-center justify-between px-4 py-2.5 pl-20 border-b border-white/10 bg-white/[0.03]">
        <div className="w-9" />
        <h1 className="text-sm font-black tracking-widest text-ink">ROCKET BUILDER</h1>
        <button onClick={() => { setBuild(DEFAULT_BUILD); setSelectedStage(0); }}
                className="w-9 h-9 rounded-full border border-white/15 bg-white/5
                           flex items-center justify-center text-dim hover:text-ink hover:border-white/30 active:scale-95"
                aria-label="Reset">↻</button>
      </header>

      {/* ── Preset quick-select ── */}
      <div className="shrink-0 flex items-center gap-1.5 px-4 pt-2 overflow-x-auto no-scrollbar">
        <span className="shrink-0 text-[9px] font-black tracking-widest uppercase text-dim pr-1">Presets</span>
        {ROCKET_PRESETS.map((p) => {
          const locked = presetLocked(p);
          return (
            <button
              key={p.id}
              disabled={locked}
              onClick={() => loadPreset(p)}
              title={locked ? 'Unlock its parts in Career to use this preset' : p.description}
              className={`shrink-0 h-8 px-3 rounded-full border text-[10px] font-black tracking-wide
                          flex items-center gap-1 transition-all active:scale-95
                ${locked
                  ? 'border-white/5 bg-white/[0.02] text-dim/40 cursor-not-allowed'
                  : 'border-cyan/40 bg-cyan/[0.07] text-cyan hover:bg-cyan/15'}`}
            >
              <span className="text-sm leading-none">{p.icon}</span>
              {p.name}
              {locked && <span className="text-[10px]">🔒</span>}
            </button>
          );
        })}
      </div>

      {/* ── Rocket preview ── */}
      <section className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3 px-4 py-3 md:grid md:grid-cols-[minmax(24rem,1fr)_minmax(22rem,30rem)] md:items-stretch">
      <div className="shrink-0 flex items-start justify-center gap-6 md:gap-10"
           style={{ minHeight: '32vh', maxHeight: '42vh' }}>
        {/* Blueprint */}
        <div className="flex-1 flex flex-col items-center justify-end h-full overflow-hidden">
          <BlueprintRocket
            stages={stages}
            noseId={build.noseId}
            landerId={build.landerId}
            utilityIds={build.utilityIds}
            boosterIds={build.boosterIds ?? []}
            selectedStage={activeStage}
            atStageLimit={atStageLimit}
            onSelectStage={setSelectedStage}
            onRemoveTank={removeTankFromStage}
            onRemoveStage={removeStage}
            onAddStage={addStage}
          />
        </div>

        {/* Stats column */}
        <div className="shrink-0 flex flex-col gap-2 justify-center h-full py-2" style={{ minWidth: 116 }}>
          <StatCard label={`MASS / ${tier.maxMass}t`} value={`${stats.wetMass.toFixed(1)} t`} warn={overMass} />
          <StatCard label="THRUST" value={`${stats.thrust.toFixed(0)} kN`} />
          <StatCard label="TWR" value={twr.toFixed(2)} warn={twr < 1.1} highlight={twr >= 1.1} />
          <StatCard label="Δv EST" value={`${deltaV.toFixed(0)} m/s`} highlight />
          <StatCard label="FUEL" value={`${stats.fuelCapacity.toFixed(0)} L`} />
        </div>
      </div>

      {/* ── Facility + stage hint ── */}
      <div className="shrink-0 px-0 pb-1 md:col-start-2 md:row-start-1 flex flex-col gap-1">
        <div className="rounded-lg border border-cyan/25 bg-cyan/[0.06] px-3 py-1.5 text-[11px] text-center">
          <span className="text-cyan font-black">🏭 {tier.name}</span>
          <span className="text-dim"> · up to {tier.maxMass}t · {tier.maxStages} stages</span>
        </div>
        <div className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-[11px] text-dim text-center">
          Editing <span className="text-cyan font-bold">Stage {activeStage + 1}</span>
          {' '}— tap a part below to add it
        </div>
      </div>

      {/* ── Category tabs ── */}
      <div className="shrink-0 flex gap-1.5 px-0 py-2 overflow-x-auto no-scrollbar md:col-start-2 md:row-start-1 md:mt-12">
        {CATEGORIES.map(({ type, short }) => (
          <button
            key={type}
            onClick={() => setActiveCategory(type)}
            className={`shrink-0 h-8 px-3 rounded-full border text-[10px] font-black tracking-widest uppercase
              transition-all active:scale-95
              ${activeCategory === type
                ? 'border-cyan/60 bg-cyan/15 text-cyan shadow-[0_0_10px_rgba(0,229,255,0.2)]'
                : 'border-white/10 bg-white/[0.04] text-dim'}`}
          >{short}</button>
        ))}
      </div>

      {/* ── Parts drawer ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-0 pb-1 md:col-start-2 md:row-start-1 md:mt-24 md:rounded-3xl md:border md:border-white/10 md:bg-white/[0.035] md:p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2">
          {categoryParts.map((p) => {
            const isUnlk = unlocked.has(p.id);
            const sel = isSelected(p);
            return (
              <button
                key={p.id}
                disabled={!isUnlk}
                onClick={() => handlePartTap(p)}
                className={`relative flex flex-col items-start gap-1 rounded-2xl border p-3
                            text-left transition-all active:scale-[0.97]
                            ${sel
                              ? 'border-cyan/70 bg-cyan/[0.08] shadow-[0_0_16px_rgba(0,229,255,0.2)]'
                              : isUnlk
                                ? 'border-white/10 bg-white/[0.04] hover:border-white/25'
                                : 'border-white/5 bg-white/[0.02] opacity-35 cursor-not-allowed'}`}
              >
                {/* Part icon + lock */}
                <div className="flex items-center w-full gap-2">
                  <span className="text-2xl leading-none"
                        style={{ color: `#${p.color.toString(16).padStart(6, '0')}` }}>
                    {p.icon}
                  </span>
                  {!isUnlk && (
                    <span className="ml-auto text-[11px] text-dim/50">🔒</span>
                  )}
                  {sel && (
                    <span className="ml-auto text-[10px] font-black text-cyan">✓</span>
                  )}
                </div>
                {/* Name */}
                <span className="text-xs font-bold text-ink leading-tight">{p.name}</span>
                {/* Key stat */}
                <PartStat part={p} />
              </button>
            );
          })}
        </div>
      </div>
      </section>

      {/* ── Launch button ── */}
      <div className="shrink-0 px-4 py-3 border-t border-white/10">
        {overMass && (
          <div className="mb-2 text-center text-[11px] text-red font-bold">
            Too heavy for the {tier.name} ({stats.wetMass.toFixed(1)}t &gt; {tier.maxMass}t) — upgrade your base in Career.
          </div>
        )}
        <button
          disabled={overMass}
          onClick={() => { if (overMass) return; saveBuild(build); router.push('/play'); }}
          className={`btn w-full text-base py-3.5 ${overMass ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary'}`}
        >
          🚀 Save &amp; Launch
        </button>
      </div>
    </main>
  );
}

function StatCard({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${warn ? 'border-red/40 bg-red/[0.08]' : 'border-white/[0.1] bg-white/[0.04]'}`}>
      <div className="text-[9px] font-bold tracking-[0.12em] uppercase text-dim">{label}</div>
      <div className={`text-[14px] font-bold tabular-nums leading-tight ${warn ? 'text-red' : highlight ? 'text-cyan' : 'text-ink'}`}>
        {value}
      </div>
    </div>
  );
}

function PartStat({ part }: { part: RocketPart }) {
  if (part.type === 'engine' || part.type === 'booster') return (
    <div className="text-[10px] tabular-nums text-dim">
      <span className="text-orange">⚡{part.thrust}kN</span>
      {part.fuelCapacity > 0 && (
        <><span className="mx-1">·</span><span className="text-cyan">{part.fuelCapacity}L</span></>
      )}
    </div>
  );
  if (part.type === 'tank') return (
    <div className="text-[10px] tabular-nums text-cyan">⛽ {part.fuelCapacity} L</div>
  );
  if (part.type === 'lander') return (
    <div className="text-[10px] tabular-nums text-dim">
      <span className="text-orange">⚡{part.thrust}kN</span>
      <span className="mx-1">·</span>
      <span className="text-cyan">{part.fuelCapacity}L</span>
    </div>
  );
  return <div className="text-[10px] tabular-nums text-dim">{part.mass} t</div>;
}

// ─── Blueprint rocket diagram ────────────────────────────────────────────────

function colorFor(id: string): string {
  const p = PARTS_CATALOG.find((x) => x.id === id);
  return p ? `#${p.color.toString(16).padStart(6, '0')}` : '#888';
}

function BlueprintRocket({
  stages, noseId, landerId, utilityIds, boosterIds,
  selectedStage, atStageLimit, onSelectStage, onRemoveTank, onRemoveStage, onAddStage,
}: {
  stages: StageSpec[];
  noseId: string;
  landerId?: string;
  utilityIds: string[];
  boosterIds: string[];
  selectedStage: number;
  atStageLimit: boolean;
  onSelectStage: (i: number) => void;
  onRemoveTank: (si: number, ti: number) => void;
  onRemoveStage: (si: number) => void;
  onAddStage: () => void;
}) {
  const noseColor = colorFor(noseId);
  const lander = landerId ? PARTS_CATALOG.find((x) => x.id === landerId) : undefined;
  const TANK_H = 44;
  const TANK_W = 52;

  return (
    <div className="flex flex-col items-center select-none w-full" style={{ maxWidth: 140 }}>
      {/* Nose */}
      <div className="w-0 h-0 mb-0"
           style={{
             borderLeft: '22px solid transparent',
             borderRight: '22px solid transparent',
             borderBottom: `44px solid ${noseColor}`,
             filter: 'drop-shadow(0 -2px 6px rgba(255,255,255,0.15))',
           }} />

      {/* Lander label if present */}
      {lander && (
        <div className="mb-1 flex items-center gap-1 rounded-full border border-cyan/35
                        bg-cyan/[0.07] px-2 py-0.5 text-[8px] font-bold text-cyan">
          {lander.icon} {lander.name}
        </div>
      )}

      {/* Stages — rendered top to bottom, but stage ordering is bottom-first */}
      {stages.map((_, idx) => stages.length - 1 - idx).map((si) => {
        const stage = stages[si];
        const selected = si === selectedStage;
        return (
          <button
            key={si}
            type="button"
            onClick={() => onSelectStage(si)}
            className={`relative flex flex-col items-center rounded-md transition w-full
                        border-x-2 ${selected ? 'border-cyan/70 bg-cyan/[0.06]' : 'border-transparent'}`}
          >
            {/* Stage label */}
            <span className={`absolute -left-5 top-1 text-[8px] font-black
                              ${selected ? 'text-cyan' : 'text-dim/50'}`}>S{si + 1}</span>

            {/* Tanks */}
            {stage.tankIds.map((id, ti) => (
              <div key={ti}
                   className="relative flex items-center justify-center border-x border-black/20"
                   style={{ width: TANK_W, height: TANK_H, background: colorFor(id) }}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemoveTank(si, ti); }}
                  className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full
                             bg-black/40 text-white/70 text-[9px] leading-4 text-center
                             hover:bg-red/60 hover:text-white active:scale-90 z-10"
                  aria-label="Remove tank">✕</button>
              </div>
            ))}

            {/* Engine nozzle shape */}
            <div className="mt-0"
                 style={{
                   width: TANK_W + 8,
                   height: 18,
                   background: colorFor(stage.engineId),
                   clipPath: 'polygon(6% 0, 94% 0, 100% 100%, 0 100%)',
                 }} />

            {/* Remove stage */}
            {stages.length > 1 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemoveStage(si); }}
                className="absolute -right-5 top-1 w-4 h-4 rounded-full bg-white/5 text-dim
                           text-[8px] leading-4 text-center border border-white/15
                           hover:text-red hover:border-red/40 active:scale-90 z-10"
                aria-label="Remove stage">🗑</button>
            )}
          </button>
        );
      })}

      {/* Boosters strapped to stage 1 */}
      {boosterIds.length > 0 && (
        <div className="mt-1.5 flex items-center justify-center gap-1 rounded-md border border-orange/35
                        bg-orange/[0.08] px-2 py-0.5 text-[10px] text-orange font-bold">
          ⟂ ×{boosterIds.length}
          {boosterIds.map((id, i) => {
            const p = PARTS_CATALOG.find((x) => x.id === id);
            return <span key={i}>{p?.icon ?? '🚀'}</span>;
          })}
        </div>
      )}

      {/* Add stage */}
      <button
        onClick={onAddStage}
        disabled={atStageLimit}
        className={`mt-2 w-full rounded-md border border-dashed text-[11px] font-bold py-1.5 active:scale-95
          ${atStageLimit ? 'border-white/15 text-dim/50 cursor-not-allowed' : 'border-cyan/40 text-cyan hover:bg-cyan/10'}`}
        style={{ maxWidth: TANK_W + 20 }}
      >{atStageLimit ? '🔒' : '＋ Stage'}</button>

      {/* Utility badges */}
      {utilityIds.length > 0 && (
        <div className="mt-1.5 flex flex-wrap justify-center gap-1">
          {utilityIds.map((id) => {
            const p = PARTS_CATALOG.find((x) => x.id === id);
            return p ? (
              <span key={id} className="rounded-full border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-dim">
                {p.icon}
              </span>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
