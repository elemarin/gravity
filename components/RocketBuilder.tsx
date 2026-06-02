'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PARTS_CATALOG, RocketPart, PartType } from '@/lib/game/career/Parts';
import { RocketBuild, DEFAULT_BUILD } from '@/lib/game/types';
import { computeStats, estimateDeltaV } from '@/lib/game/BuildSpec';
import { loadBuild, saveBuild, loadUnlockedParts } from '@/lib/storage';

const CATEGORY_ORDER: { type: PartType; label: string }[] = [
  { type: 'engine',  label: 'Engines' },
  { type: 'tank',    label: 'Tanks'   },
  { type: 'nose',    label: 'Noses'   },
  { type: 'capsule', label: 'Capsules'},
  { type: 'utility', label: 'Utility' },
];

export default function RocketBuilder() {
  const router = useRouter();
  const [build, setBuild] = useState<RocketBuild>(DEFAULT_BUILD);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());

  useEffect(() => {
    setBuild(loadBuild());
    const unlockedIds = new Set(loadUnlockedParts());
    PARTS_CATALOG.forEach((p) => { if (p.unlockedByDefault) unlockedIds.add(p.id); });
    setUnlocked(unlockedIds);
  }, []);

  const stats = useMemo(() => computeStats(build), [build]);
  const deltaV = useMemo(() => estimateDeltaV(stats), [stats]);

  const partsByCategory = useMemo(() => {
    const map = new Map<PartType, RocketPart[]>();
    PARTS_CATALOG.forEach((p) => {
      const list = map.get(p.type) ?? [];
      list.push(p);
      map.set(p.type, list);
    });
    return map;
  }, []);

  const setEngine = (id: string) => setBuild((b) => ({ ...b, engineId: id }));
  const setNose   = (id: string) => setBuild((b) => ({ ...b, noseId: id }));
  const addTank   = (id: string) => setBuild((b) => ({ ...b, tankIds: [...b.tankIds, id] }));
  const removeTank = (index: number) =>
    setBuild((b) => ({ ...b, tankIds: b.tankIds.filter((_, i) => i !== index) }));
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

  const reset = () => setBuild(DEFAULT_BUILD);

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
          <h2 className="stat-label mb-3">Your Rocket</h2>
          <RocketStack
            build={build}
            onRemoveTank={removeTank}
          />
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
          {CATEGORY_ORDER.map(({ type, label }) => {
            const items = partsByCategory.get(type) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={type} className="mb-5">
                <h3 className="stat-label mb-2">{label}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {items.map((p) => {
                    const isUnlocked = unlocked.has(p.id);
                    const selected = isSelected(build, p);
                    return (
                      <button
                        key={p.id}
                        disabled={!isUnlocked}
                        onClick={() => {
                          if (!isUnlocked) return;
                          if (p.type === 'engine')  setEngine(p.id);
                          else if (p.type === 'tank') addTank(p.id);
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

function isSelected(build: RocketBuild, p: RocketPart): boolean {
  if (p.type === 'engine')  return build.engineId === p.id;
  if (p.type === 'nose' || p.type === 'capsule') return build.noseId === p.id;
  if (p.type === 'tank')    return build.tankIds.includes(p.id);
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

function RocketStack({ build, onRemoveTank }: { build: RocketBuild; onRemoveTank: (i: number) => void }) {
  const noseColor   = colorFor(build.noseId);
  const tankColors  = build.tankIds.map((id) => colorFor(id));
  const engineColor = colorFor(build.engineId);

  return (
    <div className="relative flex flex-col items-center mx-auto"
         style={{ width: 100 }}>
      {/* Nose */}
      <div className="w-0 h-0"
           style={{
             borderLeft: '24px solid transparent',
             borderRight: '24px solid transparent',
             borderBottom: `48px solid ${noseColor}`,
           }} />

      {/* Tanks */}
      {build.tankIds.map((id, i) => (
        <div key={i} className="relative w-12 h-14 border-x-2 border-black/30" style={{ background: tankColors[i] }}>
          {build.tankIds.length > 1 && (
            <button onClick={() => onRemoveTank(i)}
                    className="absolute -right-7 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full
                               bg-red/20 text-red text-[10px] border border-red/40 hover:bg-red/40 active:scale-90"
                    aria-label="Remove tank">✕</button>
          )}
        </div>
      ))}

      {/* Engine */}
      <div className="w-14 h-6"
           style={{
             background: engineColor,
             clipPath: 'polygon(8% 0, 92% 0, 100% 100%, 0 100%)',
           }} />

      {build.utilityIds.length > 0 && (
        <div className="mt-2 flex gap-1 text-[10px]">
          {build.utilityIds.map((id) => {
            const p = PARTS_CATALOG.find((x) => x.id === id);
            if (!p) return null;
            return (
              <span key={id} className="pill px-2 py-0.5 text-dim">{p.icon}</span>
            );
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
