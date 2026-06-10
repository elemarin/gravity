'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MILESTONES } from '@/lib/game/career/Milestones';
import { PARTS_CATALOG } from '@/lib/game/career/Parts';
import {
  facilityTier, nextFacilityTier, canUpgradeFacility, CAMPAIGN_GOALS,
} from '@/lib/game/career/Progress';
import {
  Contract, dailyContracts, dateKey, STANDING_CONTRACTS,
  PAYLOAD_LABELS, destinationName,
} from '@/lib/game/career/Contracts';
import { rankProgress } from '@/lib/game/career/Rank';
import { fmtMoney } from '@/lib/game/career/Economy';
import { MISSION_LABELS } from '@/lib/game/plan/FlightPlan';
import { bodyDef } from '@/lib/game/bodies';
import {
  loadCompletedMilestones, loadUnlockedParts, resetProgress,
  loadFacilityLevel, saveFacilityLevel, loadGoals, loadBases,
  loadMoney, spendMoney, loadReputation,
  loadActiveContract, saveActiveContract, loadCompletedContracts,
} from '@/lib/storage';
import NavDrawer from './NavDrawer';

export default function CareerView() {
  const router = useRouter();
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [unlocked,  setUnlocked]  = useState<Set<string>>(new Set());
  const [facility, setFacility]   = useState(0);
  const [goals, setGoals]         = useState<Set<string>>(new Set());
  const [bases, setBases]         = useState<string[]>(['earth']);
  const [money, setMoney]         = useState(0);
  const [reputation, setReputation] = useState(0);
  const [active, setActive]       = useState<Contract | null>(null);
  const [contractsDone, setContractsDone] = useState<Set<string>>(new Set());
  const [board, setBoard]         = useState<Contract[]>([]);

  const refresh = () => {
    setCompleted(new Set(loadCompletedMilestones()));
    const u = new Set(loadUnlockedParts());
    PARTS_CATALOG.forEach((p) => { if (p.unlockedByDefault) u.add(p.id); });
    setUnlocked(u);
    setFacility(loadFacilityLevel());
    setGoals(new Set(loadGoals()));
    setBases(loadBases());
    setMoney(loadMoney());
    setReputation(loadReputation());
    setActive(loadActiveContract());
    setContractsDone(new Set(loadCompletedContracts()));
    setBoard(dailyContracts(dateKey()));
  };

  useEffect(() => { refresh(); }, []);

  const handleReset = () => {
    if (confirm('Reset all career progress? Money, rank, contracts — everything. This cannot be undone.')) {
      resetProgress();
      refresh();
    }
  };

  const { rank, next: nextRankUp, fraction, toNext } = rankProgress(reputation);

  const acceptContract = (c: Contract) => {
    saveActiveContract(c);
    setActive(c);
    router.push('/');
  };
  const abandonContract = () => {
    saveActiveContract(null);
    setActive(null);
  };

  const tier = facilityTier(facility);
  const next = nextFacilityTier(facility);
  const canUpgrade = canUpgradeFacility(facility, money);
  const handleUpgrade = () => {
    if (!next || !canUpgrade) return;
    if (!spendMoney(next.cost)) return;
    const lvl = facility + 1;
    saveFacilityLevel(lvl);
    setFacility(lvl);
    setMoney(loadMoney());
  };

  const renderContract = (c: Contract) => {
    const done = contractsDone.has(c.id);
    const isActive = active?.id === c.id;
    const locked = rank.level < c.rankRequired;
    return (
      <li key={c.id}
          className={`panel p-3 ${done ? 'border-green/40 bg-green/[0.05]' :
                                  isActive ? 'border-yellow/50 bg-yellow/[0.05]' :
                                  locked ? 'opacity-55' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-bold ${done ? 'text-green' : 'text-ink'}`}>
              {done ? '✓ ' : ''}{c.title}
            </div>
            <div className="mt-0.5 text-xs text-dim leading-snug">{c.description}</div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="pill text-[9px] px-1.5 py-0.5 text-cyan">
                🪐 {destinationName(c.destinationId, c.launchBodyId)}
              </span>
              <span className="pill text-[9px] px-1.5 py-0.5 text-purple">
                {MISSION_LABELS[c.missionKind]}
              </span>
              <span className="pill text-[9px] px-1.5 py-0.5 text-ink">
                {PAYLOAD_LABELS[c.payloadType]}
              </span>
              <span className="pill text-[9px] px-1.5 py-0.5 text-yellow">
                +{c.reputation} rep
              </span>
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1.5">
            <span className="text-sm font-black tabular-nums text-green">{fmtMoney(c.reward)}</span>
            {done ? (
              <span className="text-[10px] font-bold text-green">PAID</span>
            ) : locked ? (
              <span className="text-[9px] font-bold text-dim text-right leading-tight">
                🔒 Rank {c.rankRequired}
              </span>
            ) : isActive ? (
              <button onClick={abandonContract}
                      className="rounded-md border border-red/40 bg-red/10 px-2 py-1 text-[10px] font-black text-red active:scale-95">
                ✕ DROP
              </button>
            ) : (
              <button onClick={() => acceptContract(c)}
                      className="rounded-md border-2 border-green/60 bg-green/15 px-2.5 py-1 text-[10px] font-black text-green active:scale-95">
                ▶ ACCEPT
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <main className="fixed inset-0 overflow-y-auto bg-bg">
      <NavDrawer title="Career Menu" />
      <div className="min-h-screen px-5 py-6
                      pt-[calc(1rem+env(safe-area-inset-top))]
                      pb-[calc(2rem+env(safe-area-inset-bottom))]
                      max-w-2xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div className="w-10" />
          <h1 className="text-xl sm:text-2xl font-black tracking-widest">CAREER</h1>
          <button onClick={handleReset} aria-label="Reset progress"
                  className="w-10 h-10 rounded-full border border-white/15 bg-white/5 text-xs
                             flex items-center justify-center text-dim hover:text-red hover:border-red/40 active:scale-95">⟲</button>
        </header>

        {/* Money + rank */}
        <div className="panel p-4 mb-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="stat-label">Agency Funds</div>
              <div className="text-2xl font-black tabular-nums text-green">{fmtMoney(money)}</div>
            </div>
            <div className="text-right">
              <div className="stat-label">Rank</div>
              <span className="pill px-3 py-1 text-[11px] font-black text-yellow">★ {rank.title}</span>
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-dim mb-1">
              <span>{rank.perk}</span>
              <span className="tabular-nums shrink-0">
                {nextRankUp ? `${toNext} rep to ${nextRankUp.title}` : 'MAX RANK'}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/8 overflow-hidden">
              <div className="h-full rounded-full bg-yellow/80 transition-[width]"
                   style={{ width: `${Math.round(fraction * 100)}%` }} />
            </div>
          </div>
        </div>

        {/* Contract board */}
        <h2 className="stat-label mb-1 px-1">Contract Board — Today’s Jobs</h2>
        <p className="text-[10px] text-dim mb-3 px-1">
          Fresh contracts every midnight. Accept one, fly the delivery, get paid. The space economy runs on you.
        </p>
        <ol className="flex flex-col gap-2 mb-5">
          {board.map(renderContract)}
        </ol>

        <h2 className="stat-label mb-3 px-1">Standing Contracts</h2>
        <ol className="flex flex-col gap-2 mb-5">
          {STANDING_CONTRACTS.map(renderContract)}
        </ol>

        {/* Launch facility */}
        <h2 className="stat-label mb-3 px-1">Launch Facility</h2>
        <div className="panel p-4 mb-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-black text-cyan">🏭 {tier.name}</div>
              <div className="text-[11px] text-dim mt-0.5">
                Lifts up to <span className="text-ink font-bold">{tier.maxMass}t</span> ·
                {' '}<span className="text-ink font-bold">{tier.maxStages}</span> stages
              </div>
            </div>
            {next ? (
              <button
                onClick={handleUpgrade}
                disabled={!canUpgrade}
                className={`shrink-0 rounded-lg border-2 px-3 py-2 text-[11px] font-black tracking-wider
                  ${canUpgrade
                    ? 'border-green/70 bg-green/15 text-green active:scale-95'
                    : 'border-white/15 bg-white/5 text-dim/60 cursor-not-allowed'}`}
              >
                {canUpgrade ? `⬆ ${next.name} · ${fmtMoney(next.cost)}` : `🔒 ${fmtMoney(next.cost)}`}
              </button>
            ) : (
              <span className="shrink-0 text-[11px] text-green font-bold">MAX TIER</span>
            )}
          </div>
          {next && !canUpgrade && (
            <div className="mt-2 text-[10px] text-dim">
              Next: {next.name} — lifts {next.maxMass}t, {next.maxStages} stages.
              Costs {fmtMoney(next.cost)}; you have {fmtMoney(money)}. Contracts pay; gravity doesn’t.
            </div>
          )}
        </div>

        {/* Campaign goals */}
        <h2 className="stat-label mb-3 px-1">Campaign — Conquer the System</h2>
        <ol className="flex flex-col gap-2 mb-5">
          {CAMPAIGN_GOALS.map((g) => {
            const done = goals.has(g.id);
            return (
              <li key={g.id}
                  className={`panel flex items-center gap-3 p-3 ${done ? 'border-green/40 bg-green/[0.06]' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm
                                ${done ? 'bg-green/20 text-green border border-green/40' : 'bg-white/5 text-dim border border-white/12'}`}>
                  {done ? '✓' : '🏆'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-bold text-sm ${done ? 'text-green' : 'text-ink'}`}>{g.name}</div>
                  <div className="text-xs text-dim">{g.description}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="pill text-[9px] px-1.5 py-0.5 text-green">+{fmtMoney(g.cash)}</span>
                    <span className="pill text-[9px] px-1.5 py-0.5 text-yellow">+{g.reputation} rep</span>
                    {g.baseUnlock && (
                      <span className="pill text-[9px] px-1.5 py-0.5 text-cyan">🚩 {bodyDef(g.baseUnlock).name} base</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {/* Launch sites */}
        <h2 className="stat-label mb-3 px-1">Launch Sites</h2>
        <div className="flex flex-wrap gap-2 mb-8">
          {bases.map((id) => (
            <span key={id} className="pill text-[11px] px-3 py-1.5 text-cyan font-bold">
              🚩 {bodyDef(id).name}
            </span>
          ))}
        </div>

        {/* Milestone list */}
        <h2 className="stat-label mb-3 px-1">Flight School — One-Time Bonuses</h2>
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
                <span className={`shrink-0 text-[11px] font-black tabular-nums ${done ? 'text-dim/50 line-through' : 'text-green'}`}>
                  {fmtMoney(m.cash)}
                </span>
              </li>
            );
          })}
        </ol>

        {/* Unlocked parts */}
        <h2 className="stat-label mb-3 px-1">Owned Parts</h2>
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
          <Link href="/" className="btn btn-secondary w-full">▶ Launch</Link>
        </div>
      </div>
    </main>
  );
}
