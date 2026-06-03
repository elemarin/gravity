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
  objective,
}: {
  state: FlightState | null;
  nextTarget: string;
  timeScale: number;
  objective: string;
}) {
  const phase    = state?.phase ?? 'prelaunch';
  const meta     = PHASE_META[phase];
  const altLabel = state ? fmtAlt(state.altitude) : '0m';
  const spdLabel = state ? fmtSpd(state.speed) : '0m/s';
  const fuelPct  = state ? Math.max(0, Math.min(100, Math.round(state.fuel))) : 100;
  // Steps through green → yellow → orange → red as the active stage drains.
  const fuelColor =
    fuelPct > 50 ? '#2ee59d' :
    fuelPct > 25 ? '#ffd54a' :
    fuelPct > 10 ? '#ff9a45' : '#ff5577';
  const fuelLow = fuelPct <= 10;

  const apo  = state?.apoapsis;
  const peri = state?.periapsis;
  const showOrbit = state && state.altitude > 1 && apo !== undefined && peri !== undefined;

  const stageCount  = state?.stageCount ?? 1;
  const activeStage = state?.activeStage ?? 0;
  const guidance = state?.guidanceSteps ?? [];
  const currentStepIndex = guidance.findIndex((s) => s.status === 'current');
  const guidanceStart = guidance.length === 0
    ? 0
    : currentStepIndex < 0
      ? Math.max(0, guidance.length - 3)
      : Math.max(0, currentStepIndex - 1);
  const visibleGuidance = guidance.slice(guidanceStart, guidanceStart + 4);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-pixel">

      {/* Vertical fuel gauge — left edge, hard to miss. Fills bottom-up and
          steps colour as the active stage drains. */}
      <div
        className="absolute z-20 flex flex-col items-center gap-1 select-none
                   left-[calc(0.5rem+env(safe-area-inset-left))] top-1/2 -translate-y-1/2"
      >
        <span className="text-[8px] tracking-[0.2em] text-dim/80">FUEL</span>
        <div
          className="relative w-3.5 h-[36vh] max-h-44 min-h-[7rem] rounded-full overflow-hidden
                     border border-white/25"
          style={{
            background: 'rgba(4,6,14,0.7)',
            boxShadow: '0 0 10px rgba(0,0,0,0.45), inset 0 0 6px rgba(0,0,0,0.6)',
          }}
        >
          {/* quarter tick marks */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to top, transparent 0, transparent calc(25% - 1px), rgba(255,255,255,0.16) calc(25% - 1px), rgba(255,255,255,0.16) 25%)',
            }}
          />
          {/* fill */}
          <div
            className={`absolute inset-x-0 bottom-0 transition-[height] duration-300 ${fuelLow ? 'pixel-blink' : ''}`}
            style={{
              height: `${fuelPct}%`,
              background: `linear-gradient(to top, ${fuelColor}, ${fuelColor}bb)`,
              boxShadow: `0 0 8px ${fuelColor}`,
            }}
          />
        </div>
        <span
          className="text-[12px] font-black tabular-nums leading-none"
          style={{ color: fuelColor, textShadow: `0 0 6px ${fuelColor}99` }}
        >
          {fuelPct}%
        </span>
      </div>

      {/* Main HUD card */}
      <div
        className="absolute top-[calc(0.6rem+env(safe-area-inset-top))]
                   left-[calc(0.6rem+env(safe-area-inset-left))]
                   right-[calc(0.6rem+env(safe-area-inset-right))]
                   overflow-hidden
                   sm:left-auto sm:max-w-[calc(100vw-1.2rem)]"
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
          className="pl-14 pr-2.5 sm:px-3 pt-2.5 pb-1 text-[11px] sm:text-[13px] tracking-[0.2em]"
          style={{ color: meta.color, textShadow: `0 0 8px ${meta.color}` }}
        >
          {meta.label}
          {timeScale > 1 && (
            <span className="ml-2 text-yellow" style={{ textShadow: '0 0 8px #ffd84d' }}>
              {timeScale}×
            </span>
          )}
        </div>

        <div className="pl-14 pr-2.5 sm:px-3 pb-2 text-[9px] sm:text-[10px] leading-tight text-yellow truncate">
          <span className="text-dim/70">OBJECTIVE </span>{objective}
        </div>

        {/* Alt + Vel values */}
        <div className="pl-14 pr-2.5 sm:px-3 pb-2.5 grid grid-cols-2 gap-x-3 sm:gap-x-4">
          <div>
            <div className="text-[11px] text-dim/70 tracking-widest mb-0.5">ALT</div>
            <div
              className="text-[16px] sm:text-[21px] tabular-nums leading-none text-ink"
              style={{ textShadow: `0 0 10px ${meta.color}88` }}
            >{altLabel}</div>
          </div>
          <div>
            <div className="text-[11px] text-orange/80 tracking-widest mb-0.5">VEL</div>
            <div
              className="text-[16px] sm:text-[21px] tabular-nums leading-none text-ink"
              style={{ textShadow: '0 0 10px rgba(255,154,69,0.5)' }}
            >{spdLabel}</div>
          </div>
        </div>

        {/* Orbit info */}
        {showOrbit && (
          <div
            className="px-2.5 sm:px-3 pb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] sm:text-[12px] leading-tight"
            style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}
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

        {/* Target distance (interplanetary guidance) */}
        {state?.targetName && state.targetDistance !== undefined && (
          <div
            className="px-2.5 sm:px-3 pb-1.5 text-[11px] sm:text-[12px]"
            style={{ borderTop: '1px solid rgba(255,255,255,0.1)', color: '#bb8bff', paddingTop: 4 }}
          >
            → {state.targetName} {fmtOrbit(state.targetDistance)}
          </div>
        )}

        {visibleGuidance.length > 0 && (
          <div
            className="px-2.5 sm:px-3 pb-2 pt-1.5 text-[9px] sm:text-[10px] leading-tight"
            style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}
          >
            <div className="mb-1 tracking-[0.18em] text-cyan/80">MANEUVERS</div>
            <div className="flex flex-col gap-1">
              {visibleGuidance.map((step) => {
                const current = step.status === 'current';
                const done = step.status === 'done';
                return (
                  <div
                    key={step.id}
                    className={`grid grid-cols-[1rem_1fr] gap-1 ${current ? 'text-yellow' : done ? 'text-green/80' : 'text-dim/70'}`}
                  >
                    <span>{done ? '✓' : current ? '▶' : '·'}</span>
                    <span className={current ? 'text-ink' : ''}>
                      <span className="font-black">{step.trigger}</span>
                      <span className="text-dim/70"> → </span>
                      {step.action}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stage indicator */}
        {stageCount > 1 && (
          <div
            className="px-2.5 sm:px-3 pb-1.5 text-[11px] sm:text-[12px]"
            style={{
              borderTop: '1px solid rgba(255,255,255,0.1)',
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
          className="hidden sm:block absolute bottom-[calc(5.5rem+env(safe-area-inset-bottom))]
                     left-[calc(0.6rem+env(safe-area-inset-left))]
                     px-3 py-2 text-[13px] text-left
                     max-w-[calc(100vw-5rem)] truncate rounded-lg"
          style={{
            background: 'rgba(8,24,56,0.78)',
            border: '1px solid rgba(255,216,77,0.35)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            color: 'rgba(255,216,77,0.95)',
            textShadow: '0 0 8px rgba(255,216,77,0.4)',
          }}
        >
          ★ {nextTarget}
        </div>
      )}
    </div>
  );
}
