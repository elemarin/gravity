'use client';

import Link from 'next/link';
import { MissionResult } from '@/lib/game/types';
import { missionHeadline } from '@/lib/game/career/Flavor';
import { fmtMoney } from '@/lib/game/career/Economy';

const RATING_COLOR: Record<string, string> = {
  S: '#2ee59d',
  A: '#00e5ff',
  B: '#ffd54a',
  C: '#ff8a3d',
  D: '#ff5577',
};

/** Contract settlement to show alongside the flight stats, if one was flown. */
export type PayoutInfo = { title: string; amount: number; line: string };

export default function MissionSummary({
  result, payout, onRestart, onCopyLog, logCopied,
}: {
  result: MissionResult;
  payout?: PayoutInfo | null;
  onRestart: () => void;
  onCopyLog?: () => void;
  logCopied?: boolean;
}) {
  const crashed = result.outcome === 'crashed';
  const inOrbit = !crashed && !result.landedBody && result.reachedOrbit;
  const icon = crashed ? '💥' : result.stationDeployed ? '🛰' : inOrbit ? '🛰' : '🚀';
  const headline = missionHeadline(result);
  const ratingColor = RATING_COLOR[result.rating] ?? '#e8f4ff';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/75 backdrop-blur-sm fade-up">
      <div className="panel pop-in mx-6 max-w-sm w-full p-7 text-center"
           style={{
             borderColor: crashed ? 'rgba(255,85,119,0.4)' : 'rgba(46,229,157,0.4)',
             boxShadow: `0 0 0 4px ${crashed ? 'rgba(255,85,119,0.08)' : 'rgba(46,229,157,0.08)'}, 0 20px 50px rgba(0,0,0,0.5)`,
           }}>
        <div className="text-5xl mb-2">{icon}</div>
        <div className={`text-xs font-black tracking-[0.3em] uppercase mb-1 ${crashed ? 'text-red' : 'text-green'}`}>
          {crashed ? 'Vehicle Lost' : 'Mission Complete'}
        </div>
        <h2 className="text-2xl font-black text-ink mb-4">{headline}</h2>
        {result.stationDeployed && !crashed && (
          <div className="-mt-2 mb-3 text-[11px] font-bold text-cyan">🛰 Station deployed</div>
        )}

        {/* Contract payout */}
        {payout && (
          <div className={`mb-4 rounded-lg border px-3 py-2.5 text-left
            ${payout.amount > 0 ? 'border-green/45 bg-green/[0.07]' : 'border-orange/40 bg-orange/[0.06]'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] font-black text-ink">📋 {payout.title}</span>
              <span className={`shrink-0 text-base font-black tabular-nums ${payout.amount > 0 ? 'text-green' : 'text-orange'}`}>
                {payout.amount > 0 ? `+${fmtMoney(payout.amount)}` : '$0'}
              </span>
            </div>
            <div className="mt-1 text-[10px] leading-snug text-dim">{payout.line}</div>
          </div>
        )}

        {/* Rating */}
        <div className="flex items-center justify-center gap-4 mb-5">
          <div className="flex flex-col items-center">
            <span className="stat-label">Rating</span>
            <span className="font-black leading-none" style={{ fontSize: '3.2rem', color: ratingColor }}>
              {result.rating}
            </span>
          </div>
          <div className="h-12 w-px bg-white/10" />
          <div className="flex flex-col items-center">
            <span className="stat-label">Score</span>
            <span className="text-3xl font-black tabular-nums text-ink">{result.score}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 text-left mb-4">
          <Row label="Max altitude" value={fmtAlt(result.maxAltitude)} />
          <Row label="Top speed"    value={`${(result.maxSpeed * 1000).toFixed(0)} m/s`} />
          <Row label="Touchdown"    value={`${result.landingSpeed.toFixed(0)} m/s`} danger={crashed} />
          <Row label="Reached"      value={result.reachedOrbit ? 'Orbit' : result.reachedSpace ? 'Space' : 'Atmosphere'} />
        </div>

        {result.transferCompleted && (
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-purple/50
                          bg-purple/15 px-4 py-1.5 text-xs font-black tracking-wider text-purple">
            🪐 Transfer to {result.landedBody ?? 'another body'}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button onClick={onRestart} className="btn btn-primary w-full text-base">
            ↻ Launch Again
          </button>
          <div className="flex gap-3">
            <Link href="/builder" className="btn btn-secondary flex-1 text-sm">🛠 Builder</Link>
            <Link href="/career" className="btn btn-secondary flex-1 text-sm">📋 Contracts</Link>
          </div>
          {onCopyLog && (
            <button
              onClick={onCopyLog}
              className="btn btn-secondary w-full text-[11px] border-yellow/40 text-yellow hover:bg-yellow/10"
            >
              {logCopied ? '✓ Copied!' : '📋 Copy Flight Log'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex flex-col rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
      <span className="stat-label">{label}</span>
      <span className={`tabular-nums font-bold text-sm ${danger ? 'text-red' : 'text-ink'}`}>{value}</span>
    </div>
  );
}

function fmtAlt(km: number): string {
  const m = km * 1000;
  if (m >= 100_000) return `${(m / 1000).toFixed(0)} km`;
  if (m >= 1000)    return `${(m / 1000).toFixed(1)} km`;
  return `${Math.max(0, Math.round(m))} m`;
}
