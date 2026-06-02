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
  onEdit: () => void;
  onReplay: () => void;
  onWarp: () => void;
  onSkip: () => void;
  onStage: () => void;
  onChute: () => void;
};

function PixelBtn({
  label, color, onClick, glow = false, large = false,
}: {
  label: string; color: string; onClick: () => void; glow?: boolean; large?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`${large ? 'px-4 py-3' : 'px-3 py-2.5'} font-pixel uppercase tracking-wider
                  border-2 active:scale-95 transition-transform`}
      style={{
        fontSize: large ? 10 : 8,
        borderColor: color,
        background: `rgba(${hexToRgb(color)},0.1)`,
        color,
        boxShadow: glow ? `0 0 12px ${color}66, inset 0 0 8px ${color}11` : undefined,
        imageRendering: 'pixelated',
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
  onEdit, onReplay, onWarp, onSkip, onStage, onChute,
}: Props) {
  const active = !finished && phase !== 'prelaunch';
  const showChute = hasParachute && !parachuteDeployed &&
    phase !== 'prelaunch' && phase !== 'landed' && phase !== 'destroyed';

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
          <PixelBtn label="STAGE" color="#ff8a3d" onClick={onStage} glow large />
        )}
        {active && showChute && (
          <PixelBtn label="CHUTE" color="#2ee59d" onClick={onChute} glow />
        )}
        {finished && (
          <PixelBtn label="✎ EDIT" color="#8aa0b5" onClick={onEdit} />
        )}
      </div>

      {/* Right: time/nav controls */}
      <div className="flex items-center gap-2">
        {!finished && (
          <>
            {canSkip && (
              <PixelBtn label="SKIP" color="#8aa0b5" onClick={onSkip} />
            )}
            <PixelBtn
              label={timeScale > 1 ? `${timeScale}× ▶▶` : '▶▶'}
              color={timeScale > 1 ? '#ffd54a' : '#8aa0b5'}
              onClick={onWarp}
              glow={timeScale > 1}
            />
          </>
        )}
        <PixelBtn label="↻ REPLAY" color="#00e5ff" onClick={onReplay} glow />
      </div>
    </div>
  );
}
