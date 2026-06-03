'use client';

import { FlightState, FlightPhase } from '@/lib/game/types';

const PHASE_META: Record<FlightPhase, { label: string; color: string }> = {
  prelaunch: { label: 'PRE-LAUNCH', color: '#8aa0b5' },
  flight:    { label: 'FLIGHT',     color: '#00e5ff' },
  orbit:     { label: 'ORBIT',      color: '#2ee59d' },
  reentry:   { label: 'RE-ENTRY',   color: '#ff8a3d' },
  landed:    { label: 'LANDED',     color: '#b070ff' },
  destroyed: { label: 'DESTROYED',  color: '#ff5577' },
};

function fmtAlt(km: number): string {
  const m = km * 1000;
  if (m >= 100_000) return `${(m / 1000).toFixed(0)}km`;
  if (m >= 1000)    return `${(m / 1000).toFixed(1)}km`;
  return `${Math.max(0, Math.round(m))}m`;
}

function fmtSpd(kms: number): string {
  const ms = kms * 1000;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}km/s`;
  return `${Math.round(ms)}m/s`;
}

function fmtOrbit(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}Mm`;
  return `${Math.round(km)}km`;
}

export default function HUDOverlay({
  state,
  nextTarget,
  timeScale,
}: {
  state: FlightState | null;
  nextTarget: string;
  timeScale: number;
}) {
  const phase    = state?.phase ?? 'prelaunch';
  const meta     = PHASE_META[phase];
  const altLabel = state ? fmtAlt(state.altitude) : '0m';
  const spdLabel = state ? fmtSpd(state.speed) : '0m/s';
  const fuelPct  = state ? Math.max(0, Math.min(100, Math.round(state.fuel))) : 100;
  const fuelColor = fuelPct > 50 ? '#2ee59d' : fuelPct > 20 ? '#ffd54a' : '#ff5577';

  const apo  = state?.apoapsis;
  const peri = state?.periapsis;
  const showOrbit = state && state.altitude > 1 && apo !== undefined && peri !== undefined;

  const stageCount  = state?.stageCount ?? 1;
  const activeStage = state?.activeStage ?? 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-pixel">

      {/* Fuel bar — very top edge, full width */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-white/5">
        <div
          className="h-full transition-[width] duration-300"
          style={{ width: `${fuelPct}%`, background: fuelColor, boxShadow: `0 0 4px ${fuelColor}` }}
        />
      </div>

      {/* Main HUD card — top right */}
      <div
        className="absolute top-[calc(0.6rem+env(safe-area-inset-top))]
                   right-[calc(0.6rem+env(safe-area-inset-right))]
                   max-w-[calc(100vw-1.2rem)] overflow-hidden"
        style={{
          background: 'rgba(4,6,14,0.85)',
          border: `1px solid ${meta.color}55`,
          borderLeft: `3px solid ${meta.color}`,
          boxShadow: `0 0 20px rgba(0,0,0,0.6), -4px 0 16px ${meta.color}22`,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          imageRendering: 'pixelated',
        }}
      >
        {/* Phase row */}
        <div
          className="px-2.5 pt-2 pb-1 text-[12px] tracking-[0.2em]"
          style={{ color: meta.color, textShadow: `0 0 8px ${meta.color}` }}
        >
          {meta.label}
          {timeScale > 1 && (
            <span className="ml-2 text-yellow" style={{ textShadow: '0 0 8px #ffd54a' }}>
              {timeScale}×
            </span>
          )}
        </div>

        {/* Alt + Vel values */}
        <div className="px-2.5 pb-2 grid grid-cols-2 gap-x-3">
          <div>
            <div className="text-[10px] text-dim/60 tracking-widest mb-0.5">ALT</div>
            <div
              className="text-[18px] tabular-nums leading-none text-ink"
              style={{ textShadow: `0 0 10px ${meta.color}88` }}
            >{altLabel}</div>
          </div>
          <div>
            <div className="text-[10px] text-orange/60 tracking-widest mb-0.5">VEL</div>
            <div
              className="text-[18px] tabular-nums leading-none text-ink"
              style={{ textShadow: '0 0 10px rgba(255,138,61,0.5)' }}
            >{spdLabel}</div>
          </div>
        </div>

        {/* Orbit info */}
        {showOrbit && (
          <div
            className="px-2.5 pb-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] leading-tight"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span>
              <span className="text-dim/50">AP </span>
              <span className="text-green">{fmtOrbit(apo)}</span>
            </span>
            <span>
              <span className="text-dim/50">PE </span>
              <span className={peri < 80 ? 'text-orange' : 'text-cyan'}>{fmtOrbit(peri)}</span>
            </span>
          </div>
        )}

        {/* Stage indicator */}
        {stageCount > 1 && (
          <div
            className="px-2.5 pb-1.5 text-[11px]"
            style={{
              borderTop: '1px solid rgba(255,255,255,0.06)',
              color: meta.color,
              paddingTop: 4,
            }}
          >
            STG {activeStage + 1}/{stageCount}
          </div>
        )}
      </div>

      {/* Target — compact strip near bottom, above controls */}
      {nextTarget && (
        <div
          className="absolute bottom-[calc(5.5rem+env(safe-area-inset-bottom))]
                     left-1/2 -translate-x-1/2
                     px-3 py-1.5 text-[12px] text-center
                     max-w-[calc(100vw-3rem)] truncate"
          style={{
            background: 'rgba(4,6,14,0.8)',
            border: '1px solid rgba(255,213,74,0.25)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            color: 'rgba(255,213,74,0.7)',
            textShadow: '0 0 8px rgba(255,213,74,0.4)',
          }}
        >
          ★ {nextTarget}
        </div>
      )}
    </div>
  );
}
