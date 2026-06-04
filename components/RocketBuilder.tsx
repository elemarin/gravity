'use client';

import { useState, useEffect, useMemo } from 'react';
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
  const [presetId, setPresetId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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

  // Any manual change means the build no longer matches a named preset.
  const markCustom = () => setPresetId(null);

  const setStageEngine = (id: string) =>
    setBuild((b) => withStages(b, getStages(b).map((st, i) => i === activeStage ? { ...st, engineId: id } : st)));

  const addTankToStage = (id: string) =>
    setBuild((b) => withStages(b, getStages(b).map((st, i) => i === activeStage ? { ...st, tankIds: [...st.tankIds, id] } : st)));

  const removeTankFromStage = (si: number, ti: number) => {
    markCustom();
    setBuild((b) => withStages(b, getStages(b).map((st, i) => i === si ? { ...st, tankIds: st.tankIds.filter((_, k) => k !== ti) } : st)));
  };

  const addStage = () => {
    markCustom();
    setBuild((b) => {
      if (getStages(b).length >= tier.maxStages) return b;
      const s = [...getStages(b), { engineId: 'engine-basic', tankIds: ['tank-basic'] }];
      setSelectedStage(s.length - 1);
      return withStages(b, s);
    });
  };

  const toggleBooster = (id: string) =>
    setBuild((b) => {
      const cur = b.boosterIds ?? [];
      const has = cur.includes(id);
      // Cap strap-ons at four for sane geometry.
      const next = has ? cur.filter((x) => x !== id) : (cur.length >= 4 ? cur : [...cur, id]);
      return { ...b, boosterIds: next };
    });

  const removeStage = (si: number) => {
    markCustom();
    setBuild((b) => {
      const cur = getStages(b);
      if (cur.length <= 1) return b;
      const s = cur.filter((_, i) => i !== si);
      setSelectedStage((sel) => Math.max(0, Math.min(sel, s.length - 1)));
      return withStages(b, s);
    });
  };

  const loadPreset = (p: RocketPreset) => {
    setBuild({ ...p.build, stages: p.build.stages?.map((s) => ({ ...s, tankIds: [...s.tankIds] })) });
    setSelectedStage(0);
    setActiveCategory('engine');
    setPresetId(p.id);
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
    markCustom();
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
      <NavDrawer title="Build Menu" open={menuOpen} onOpenChange={setMenuOpen} hideTrigger />

      {/* ── Header — menu, title and reset sit flush inside one toolbar ── */}
      <header className="shrink-0 flex items-center gap-2 px-3 py-2 border-b-2 border-white/12 bg-white/[0.05]">
        <button
          onClick={() => setMenuOpen(true)}
          className="md:hidden h-9 w-9 shrink-0 rounded-md border border-white/15 bg-white/[0.06]
                     flex items-center justify-center text-dim transition
                     hover:text-cyan hover:border-cyan/45 active:scale-95"
          aria-label="Open menu"
        >
          <span className="text-base font-black leading-none">≡</span>
        </button>
        {/* Reserve space under the desktop floating nav so the title stays centred. */}
        <div className="hidden md:block w-44 shrink-0" />
        <h1 className="flex-1 text-center text-sm font-black tracking-widest text-ink">ROCKET BUILDER</h1>
        <button onClick={() => { setBuild(DEFAULT_BUILD); setSelectedStage(0); setPresetId(null); }}
                className="h-9 w-9 shrink-0 rounded-md border border-white/15 bg-white/[0.06]
                           flex items-center justify-center text-dim transition
                           hover:text-cyan hover:border-cyan/45 active:scale-95"
                aria-label="Reset build">↻</button>
      </header>

      <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-2 overflow-hidden px-4 py-2
                          md:grid md:grid-rows-[auto_minmax(0,1fr)] md:grid-cols-2 md:gap-x-4 md:py-3">

        {/* ── Top band: preset dropdown + stats ── */}
        <div className="shrink-0 flex items-stretch gap-2 md:col-span-2">
          <PresetDropdown
            presets={ROCKET_PRESETS}
            isLocked={presetLocked}
            selectedId={presetId}
            onSelect={loadPreset}
          />
          <div className="flex min-w-0 flex-1 items-stretch gap-1.5 overflow-x-auto no-scrollbar">
            <StatCard label={`MASS / ${tier.maxMass}t`} value={`${stats.wetMass.toFixed(1)} t`} warn={overMass} />
            <StatCard label="THRUST" value={`${stats.thrust.toFixed(0)} kN`} />
            <StatCard label="TWR" value={twr.toFixed(2)} warn={twr < 1.1} highlight={twr >= 1.1} />
            <StatCard label="Δv EST" value={`${deltaV.toFixed(0)} m/s`} highlight />
            <StatCard label="FUEL" value={`${stats.fuelCapacity.toFixed(0)} L`} />
          </div>
        </div>

        {/* ── Rocket preview ── */}
        <div className="shrink-0 flex items-start justify-center overflow-hidden [max-height:30vh]
                        md:col-start-1 md:row-start-2 md:max-h-none md:h-full md:items-center">
          <div className="flex h-full max-h-full w-full flex-col items-center justify-start overflow-y-auto overflow-x-visible py-1">
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
        </div>

        {/* ── Parts panel: facility hint, category tabs, detailed list ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:col-start-2 md:row-start-2">

          {/* Facility capacity — compact one-liner */}
          <div className="shrink-0 rounded-md border border-cyan/25 bg-cyan/[0.06] px-3 py-1 text-[10px] text-center">
            <span className="text-cyan font-black">🏭 {tier.name}</span>
            <span className="text-dim"> · ≤{tier.maxMass}t · {tier.maxStages} stages</span>
          </div>

          {/* Category tabs */}
          <div className="shrink-0 flex gap-1.5 overflow-x-auto no-scrollbar">
            {CATEGORIES.map(({ type, short }) => (
              <button
                key={type}
                onClick={() => setActiveCategory(type)}
                className={`shrink-0 h-8 px-3 rounded-md border-2 text-[10px] font-black tracking-widest uppercase
                  transition-all active:scale-95
                  ${activeCategory === type
                    ? 'border-cyan/70 bg-cyan/15 text-cyan shadow-[0_0_10px_rgba(31,217,255,0.25)]'
                    : 'border-white/10 bg-white/[0.04] text-dim'}`}
              >{short}</button>
            ))}
          </div>

          {/* Detailed parts list */}
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pb-1">
            {categoryParts.map((p) => {
              const isUnlk = unlocked.has(p.id);
              const sel = isSelected(p);
              return (
                <button
                  key={p.id}
                  disabled={!isUnlk}
                  onClick={() => handlePartTap(p)}
                  className={`flex w-full items-center gap-3 rounded-md border-2 px-3 py-2.5 text-left
                              transition-all active:scale-[0.99]
                              ${sel
                                ? 'border-cyan bg-cyan/[0.1] shadow-[0_0_12px_rgba(31,217,255,0.22)]'
                                : isUnlk
                                  ? 'border-white/12 bg-white/[0.04] hover:border-white/30'
                                  : 'border-white/5 bg-white/[0.02] opacity-40 cursor-not-allowed'}`}
                >
                  <span className="shrink-0 text-2xl leading-none"
                        style={{ color: `#${p.color.toString(16).padStart(6, '0')}` }}>
                    {p.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[11px] font-black text-ink">{p.name}</span>
                      {sel && <span className="text-[9px] font-black text-cyan">✓ ON</span>}
                      {!isUnlk && <span className="ml-auto text-[11px] text-dim/60">🔒</span>}
                    </span>
                    <span className="mt-0.5 block text-[9px] leading-snug text-dim">{p.description}</span>
                    <PartChips part={p} />
                  </span>
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

// ─── Preset dropdown ─────────────────────────────────────────────────────────

function PresetDropdown({
  presets, isLocked, selectedId, onSelect,
}: {
  presets: RocketPreset[];
  isLocked: (p: RocketPreset) => boolean;
  selectedId: string | null;
  onSelect: (p: RocketPreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = presets.find((p) => p.id === selectedId);

  return (
    <div className="relative shrink-0 w-[8.5rem] sm:w-44 md:w-56">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-full w-full items-center gap-1.5 rounded-md border-2 border-cyan/50 bg-cyan/[0.07]
                   px-2.5 py-1.5 text-left transition-all hover:border-cyan/70 active:scale-[0.98]"
      >
        <span className="shrink-0 text-base leading-none">{current?.icon ?? '🛠'}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[7px] font-bold uppercase tracking-[0.2em] text-cyan/70">Preset</span>
          <span className="block truncate text-[10px] font-black text-ink">{current?.name ?? 'Custom Build'}</span>
        </span>
        <span className={`shrink-0 text-cyan transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close preset list"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
          />
          <div
            role="listbox"
            className="absolute left-0 top-[calc(100%+4px)] z-50 max-h-[55vh] w-[min(22rem,82vw)] overflow-y-auto
                       rounded-md border-2 border-cyan/40 bg-bg/95 p-1 shadow-2xl backdrop-blur-xl"
          >
            <div className="px-2 py-1 text-[8px] font-bold uppercase tracking-[0.25em] text-cyan/70">Prebuilt Rockets</div>
            {presets.map((p) => {
              const locked = isLocked(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={p.id === selectedId}
                  disabled={locked}
                  onClick={() => { onSelect(p); setOpen(false); }}
                  className={`flex w-full items-start gap-2 rounded p-2 text-left transition
                    ${locked
                      ? 'cursor-not-allowed opacity-40'
                      : p.id === selectedId
                        ? 'bg-cyan/15'
                        : 'hover:bg-cyan/10'}`}
                >
                  <span className="shrink-0 text-base leading-none">{p.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-[10px] font-black text-ink">
                      {p.name}
                      {locked && <span className="text-[10px]">🔒</span>}
                      {p.id === selectedId && <span className="ml-auto text-[9px] text-cyan">✓</span>}
                    </span>
                    <span className="mt-0.5 block text-[9px] leading-snug text-dim">{p.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div className={`flex shrink-0 min-w-[84px] flex-col justify-center rounded-md border px-2 py-1 md:min-w-[88px] ${warn ? 'border-red/40 bg-red/[0.08]' : 'border-white/[0.1] bg-white/[0.04]'}`}>
      <div className="text-[8px] font-bold uppercase leading-none tracking-[0.1em] text-dim">{label}</div>
      <div className={`text-[13px] font-bold leading-tight tabular-nums ${warn ? 'text-red' : highlight ? 'text-cyan' : 'text-ink'}`}>
        {value}
      </div>
    </div>
  );
}

function PartChips({ part }: { part: RocketPart }) {
  const chips: { label: string; cls: string }[] = [];
  if (part.thrust > 0)       chips.push({ label: `⚡${part.thrust} kN`, cls: 'text-orange' });
  if (part.fuelCapacity > 0) chips.push({ label: `⛽${part.fuelCapacity} L`, cls: 'text-cyan' });
  if (part.mass > 0)         chips.push({ label: `⚖${part.mass} t`, cls: 'text-dim' });
  if (part.burnRate > 0)     chips.push({ label: `🔥${part.burnRate}/s`, cls: 'text-yellow' });
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] tabular-nums">
      {chips.map((c, i) => <span key={i} className={c.cls}>{c.label}</span>)}
    </div>
  );
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
    <div className="flex flex-col items-center select-none w-full" style={{ maxWidth: 150 }}>
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
            className={`relative flex flex-col items-center rounded-md transition w-full border-x-2
                        ${selected
                          ? 'border-cyan bg-cyan/[0.1] shadow-[0_0_14px_rgba(31,217,255,0.45)]'
                          : 'border-transparent'}`}
          >
            {/* Stage label — strong, obvious "editing" marker on the active stage */}
            {selected ? (
              <span className="pixel-blink absolute -left-9 top-1 z-10 rounded-sm bg-cyan px-1 py-0.5
                               text-[8px] font-black leading-none text-bg shadow-[0_0_8px_rgba(31,217,255,0.6)]">
                ✎S{si + 1}
              </span>
            ) : (
              <span className="absolute -left-5 top-1 text-[8px] font-black text-dim/50">S{si + 1}</span>
            )}

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
