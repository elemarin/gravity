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
  if (m >= 100_000) return `${(m / 1000).toFixed(0)} km`;
  if (m >= 1000)    return `${(m / 1000).toFixed(1)} km`;
  return `${Math.max(0, Math.round(m))} m`;
}

function fmtSpd(kms: number): string {
  const ms = kms * 1000;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} km/s`;
  return `${Math.round(ms)} m/s`;
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
  const phase     = state?.phase ?? 'prelaunch';
  const meta      = PHASE_META[phase];
  const altLabel  = state ? fmtAlt(state.altitude) : '0 m';
  const spdLabel  = state ? fmtSpd(state.speed) : '0 m/s';
  const fuelPct   = state ? Math.max(0, Math.min(100, Math.round(state.fuel))) : 100;
  const fuelColor = fuelPct > 50 ? '#2ee59d' : fuelPct > 20 ? '#ffd54a' : '#ff5577';

  const apo = state?.apoapsis;
  const peri = state?.periapsis;
  const showOrbitInfo = state && state.altitude > 1 && apo !== undefined && peri !== undefined;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* TOP STATS */}
      <div className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2
                      flex items-center gap-3 max-w-[calc(100vw-7rem)]">
        <div className="pill flex items-center gap-2.5 pl-3 pr-4">
          <span className="text-cyan text-sm">▲</span>
          <div className="flex flex-col leading-tight">
            <span className="stat-label">Alt</span>
            <span className="stat-value text-sm sm:text-base">{altLabel}</span>
          </div>
        </div>

        <div
          className="pill text-[10px] sm:text-xs font-black tracking-[0.2em] uppercase
                     border-2 transition-all duration-300 whitespace-nowrap"
          style={{
            color: meta.color,
            borderColor: meta.color,
            background: `${meta.color}15`,
            boxShadow: `0 0 18px ${meta.color}55`,
          }}
        >
          {meta.label}
        </div>

        <div className="pill flex items-center gap-2.5 pl-4 pr-3">
          <div className="flex flex-col leading-tight items-end">
            <span className="stat-label">Vel</span>
            <span className="stat-value text-sm sm:text-base">{spdLabel}</span>
          </div>
          <span className="text-orange text-sm">⚡</span>
        </div>
      </div>

      {/* FUEL BAR */}
      <div className="absolute top-[calc(5.25rem+env(safe-area-inset-top))]
                      left-[calc(1rem+env(safe-area-inset-left))]
                      right-[calc(1rem+env(safe-area-inset-right))]
                      flex items-center gap-3">
        <span className="stat-label text-[9px] w-16 shrink-0 tabular-nums">FUEL {fuelPct}%</span>
        <div className="flex-1 h-1.5 rounded-full bg-white/5 border border-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width,background] duration-150"
            style={{
              width: `${fuelPct}%`,
              background: fuelColor,
              boxShadow: `0 0 8px ${fuelColor}`,
            }}
          />
        </div>
        {timeScale > 1 && (
          <span className="text-yellow text-[10px] font-black tabular-nums">{timeScale}×</span>
        )}
      </div>

      {/* APOAPSIS / PERIAPSIS (only when in flight/orbit) */}
      {showOrbitInfo && (
        <div className="absolute top-[calc(6.5rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2
                        flex gap-2 text-[9px] tracking-[0.15em] uppercase">
          <span className="pill px-2.5 py-1">
            <span className="text-dim">Ap</span>{' '}
            <span className="text-green tabular-nums">{fmtAlt(apo)}</span>
          </span>
          <span className="pill px-2.5 py-1">
            <span className="text-dim">Pe</span>{' '}
            <span className={`tabular-nums ${peri < 80 ? 'text-orange' : 'text-cyan'}`}>{fmtAlt(peri)}</span>
          </span>
        </div>
      )}

      {/* TARGET (bottom center, above controls) */}
      <div className="absolute bottom-[calc(11rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2
                      pill flex items-center gap-2 max-w-[calc(100vw-2rem)] px-4 py-2">
        <span className="text-yellow text-[10px] font-black tracking-[0.2em] shrink-0">★ TARGET</span>
        <span className="text-ink text-xs sm:text-sm font-semibold truncate">{nextTarget}</span>
      </div>
    </div>
  );
}
