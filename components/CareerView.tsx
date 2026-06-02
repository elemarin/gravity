'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MILESTONES } from '@/lib/game/career/Milestones';
import { PARTS_CATALOG } from '@/lib/game/career/Parts';
import { loadCompletedMilestones, loadUnlockedParts, resetProgress } from '@/lib/storage';

export default function CareerView() {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [unlocked,  setUnlocked]  = useState<Set<string>>(new Set());

  useEffect(() => {
    setCompleted(new Set(loadCompletedMilestones()));
    const u = new Set(loadUnlockedParts());
    PARTS_CATALOG.forEach((p) => { if (p.unlockedByDefault) u.add(p.id); });
    setUnlocked(u);
  }, []);

  const handleReset = () => {
    if (confirm('Reset all career progress? This cannot be undone.')) {
      resetProgress();
      setCompleted(new Set());
      setUnlocked(new Set(PARTS_CATALOG.filter((p) => p.unlockedByDefault).map((p) => p.id)));
    }
  };

  const totalDone = completed.size;

  return (
    <main className="fixed inset-0 overflow-y-auto bg-bg">
      <div className="min-h-screen px-5 py-6
                      pt-[calc(1rem+env(safe-area-inset-top))]
                      pb-[calc(2rem+env(safe-area-inset-bottom))]
                      max-w-2xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <Link href="/" className="w-10 h-10 rounded-full border border-white/15 bg-white/5
                                    flex items-center justify-center text-ink hover:border-white/30 active:scale-95">←</Link>
          <h1 className="text-xl sm:text-2xl font-black tracking-widest">CAREER</h1>
          <button onClick={handleReset} aria-label="Reset progress"
                  className="w-10 h-10 rounded-full border border-white/15 bg-white/5 text-xs
                             flex items-center justify-center text-dim hover:text-red hover:border-red/40 active:scale-95">⟲</button>
        </header>

        {/* Progress */}
        <div className="panel p-4 mb-5 flex items-center justify-between">
          <div>
            <div className="stat-label">Milestones</div>
            <div className="text-2xl font-black tabular-nums">
              <span className="text-cyan">{totalDone}</span>
              <span className="text-dim text-base">/{MILESTONES.length}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="stat-label">Parts Unlocked</div>
            <div className="text-2xl font-black tabular-nums">
              <span className="text-green">{unlocked.size}</span>
              <span className="text-dim text-base">/{PARTS_CATALOG.length}</span>
            </div>
          </div>
        </div>

        {/* Milestone list */}
        <h2 className="stat-label mb-3 px-1">Mission Progress</h2>
        <ol className="flex flex-col gap-2 mb-8 relative">
          {MILESTONES.map((m, i) => {
            const done = completed.has(m.id);
            const nextOne = !done && [...MILESTONES].slice(0, i).every((p) => completed.has(p.id));
            return (
              <li key={m.id}
                  className={`panel flex items-center gap-3 p-3
                              ${done ? 'border-green/30 bg-green/[0.04]' :
                                       nextOne ? 'border-yellow/40 bg-yellow/[0.04]' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black
                                ${done ? 'bg-green/20 text-green border border-green/40' :
                                         nextOne ? 'bg-yellow/15 text-yellow border border-yellow/40 animate-pulse' :
                                                  'bg-white/5 text-dim border border-white/10'}`}>
                  {done ? '✓' : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-bold text-sm ${done ? 'text-green' : nextOne ? 'text-ink' : 'text-dim'}`}>
                    {m.name}
                  </div>
                  <div className="text-xs text-dim truncate">{m.description}</div>
                </div>
                {m.unlocks.length > 0 && (
                  <div className="hidden sm:flex gap-1 shrink-0">
                    {m.unlocks.map((id) => {
                      const p = PARTS_CATALOG.find((x) => x.id === id);
                      if (!p) return null;
                      return (
                        <span key={id} className="pill text-[10px] px-2 py-0.5">{p.icon} {p.name}</span>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* Unlocked parts */}
        <h2 className="stat-label mb-3 px-1">Unlocked Parts</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-8">
          {PARTS_CATALOG.filter((p) => unlocked.has(p.id)).map((p) => (
            <div key={p.id} className="panel p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl" style={{ color: `#${p.color.toString(16).padStart(6, '0')}` }}>
                  {p.icon}
                </span>
                <span className="text-xs font-bold truncate">{p.name}</span>
              </div>
              <div className="text-[10px] text-dim line-clamp-2">{p.description}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <Link href="/builder" className="btn btn-primary w-full">🛠 Open Builder</Link>
          <Link href="/play"    className="btn btn-secondary w-full">▶ Launch</Link>
        </div>
      </div>
    </main>
  );
}
