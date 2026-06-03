'use client';

import { FlightPhase } from '@/lib/game/types';

type Props = {
  finished: boolean;
  phase: FlightPhase;
  timeScale: number;
  canSkip: boolean;
  canStage: boolean;
  hasParachute: boolean;
  parachuteDeployed: boolean;
  hasLander: boolean;
  landerDeployed: boolean;
  onEdit: () => void;
  onReplay: () => void;
  onWarp: () => void;
  onSkip: () => void;
  onStage: () => void;
  onLander: () => void;
};

function PixelBtn({
  label, color, onClick, glow = false, large = false,
}: {
  label: string; color: string; onClick: () => void; glow?: boolean; large?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`${large ? 'px-4 py-3.5' : 'px-3.5 py-3'} font-pixel uppercase tracking-wider
                  rounded-lg border-2 active:scale-95 transition-transform`}
      style={{
        fontSize: large ? 13 : 11,
        borderColor: color,
        background: `rgba(${hexToRgb(color)},0.14)`,
        color,
        boxShadow: glow ? `0 0 14px ${color}66, inset 0 0 8px ${color}11` : undefined,
      }}
    >
      {label}
    </button>
  );
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

export default function SimControls({
  finished, phase, timeScale, canSkip,
  canStage, hasParachute, parachuteDeployed,
  hasLander, landerDeployed,
  onEdit, onReplay, onWarp, onSkip, onStage, onLander,
}: Props) {
  const active = !finished && phase !== 'prelaunch';
  const inFlight = phase !== 'prelaunch' && phase !== 'landed' && phase !== 'destroyed';
  const showLander = hasLander && !landerDeployed && inFlight;

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 flex items-end justify-between gap-2
                 pb-[calc(0.75rem+env(safe-area-inset-bottom))]
                 px-[calc(0.75rem+env(safe-area-inset-left))]
                 pr-[calc(0.75rem+env(safe-area-inset-right))]"
    >
      {/* Left: action buttons */}
      <div className="flex items-center gap-2">
        {active && canStage && (
          <PixelBtn label="STAGE" color="#ff9a45" onClick={onStage} glow large />
        )}
        {active && showLander && (
          <PixelBtn label="LANDER" color="#bb8bff" onClick={onLander} glow />
        )}
        {active && hasParachute && (
          <div
            className="rounded-lg border-2 px-3 py-2.5 font-pixel uppercase tracking-wider"
            style={{
              fontSize: 10,
              borderColor: parachuteDeployed ? '#39e9a6' : 'rgba(255,255,255,0.25)',
              color: parachuteDeployed ? '#39e9a6' : '#c4d6f0',
              background: parachuteDeployed ? 'rgba(57,233,166,0.12)' : 'rgba(255,255,255,0.04)',
            }}
          >
            {parachuteDeployed ? 'CHUTE ▼' : 'CHUTE ◇'}
          </div>
        )}
        {finished && (
          <PixelBtn label="✎ EDIT" color="#c4d6f0" onClick={onEdit} />
        )}
      </div>

      {/* Right: time/nav controls */}
      <div className="flex items-center gap-2">
        {!finished && (
          <>
            {canSkip && <PixelBtn label="SKIP" color="#c4d6f0" onClick={onSkip} />}
            <PixelBtn
              label={timeScale > 1 ? `${timeScale}× ▶▶` : '▶▶'}
              color={timeScale > 1 ? '#ffd84d' : '#c4d6f0'}
              onClick={onWarp}
              glow={timeScale > 1}
            />
          </>
        )}
        <PixelBtn label="↻ REPLAY" color="#1fd9ff" onClick={onReplay} glow />
      </div>
    </div>
  );
}
