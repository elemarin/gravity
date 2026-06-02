'use client';

import { useCallback } from 'react';
import type { ControlAction } from '@/lib/game/InputManager';

type Props = {
  onAction:    (action: ControlAction, held: boolean) => void;
  onReset:     () => void;
  onWarp:      () => void;
  onStage:     () => void;
  onSkip:      () => void;
  timeScale:   number;
  canStage:    boolean;
  stageCount:  number;
  activeStage: number;
  canSkip:     boolean;
};

export default function TouchControls({
  onAction, onReset, onWarp, onStage, onSkip,
  timeScale, canStage, stageCount, activeStage, canSkip,
}: Props) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-between
                    px-[calc(1.25rem+env(safe-area-inset-left))]
                    pr-[calc(1.25rem+env(safe-area-inset-right))]
                    pb-[calc(1.25rem+env(safe-area-inset-bottom))]
                    pointer-events-none">
      {/* LEFT THUMB — rotation */}
      <div className="flex items-center gap-2.5 pointer-events-auto">
        <HoldButton label="◀" ariaLabel="Rotate Left"  onChange={(h) => onAction('rotateLeft', h)} />
        <HoldButton label="▶" ariaLabel="Rotate Right" onChange={(h) => onAction('rotateRight', h)} />
      </div>

      {/* CENTER — stage + secondary actions */}
      <div className="flex flex-col items-center gap-2 pointer-events-auto pb-1">
        <StageButton
          onClick={onStage}
          disabled={!canStage}
          stageCount={stageCount}
          activeStage={activeStage}
        />
        <div className="flex gap-2">
          <SmallButton onClick={onSkip} ariaLabel="Skip to landing" disabled={!canSkip}>⏭</SmallButton>
          <SmallButton onClick={onWarp} ariaLabel="Time Warp" highlighted={timeScale > 1}>⏩</SmallButton>
          <SmallButton onClick={onReset} ariaLabel="Reset">↺</SmallButton>
        </div>
      </div>

      {/* RIGHT THUMB — throttle */}
      <div className="flex flex-col items-center gap-2 pointer-events-auto">
        <HoldButton label="▲" ariaLabel="Throttle Up" variant="primary" large
                    onChange={(h) => onAction('throttleUp', h)} />
        <HoldButton label="▼" ariaLabel="Throttle Down" small
                    onChange={(h) => onAction('throttleDown', h)} />
      </div>
    </div>
  );
}

function HoldButton({
  label, ariaLabel, onChange,
  variant = 'default', large = false, small = false,
}: {
  label: string;
  ariaLabel: string;
  onChange: (held: boolean) => void;
  variant?: 'default' | 'primary';
  large?: boolean;
  small?: boolean;
}) {
  const dim = large ? 'w-[5.5rem] h-[5.5rem] text-3xl' :
              small ? 'w-14 h-14 text-lg' :
                      'w-[4.5rem] h-[4.5rem] text-2xl';

  const style = variant === 'primary'
    ? 'bg-orange/15 border-orange/40 text-orange active:bg-orange/40 active:shadow-[0_0_22px_rgba(255,138,61,0.6)]'
    : 'bg-white/[0.06] border-white/15 text-ink active:bg-white/15';

  const start = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(true);
  }, [onChange]);

  const end = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    onChange(false);
  }, [onChange]);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={start}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
      onContextMenu={(e) => e.preventDefault()}
      className={`rounded-full border-2 font-bold backdrop-blur-md
                  transition-all duration-100 active:scale-95
                  select-none touch-none ${dim} ${style}`}
    >
      {label}
    </button>
  );
}

function StageButton({
  onClick, disabled, stageCount, activeStage,
}: {
  onClick: () => void;
  disabled: boolean;
  stageCount: number;
  activeStage: number;
}) {
  const remaining = Math.max(0, stageCount - 1 - activeStage);
  return (
    <button
      type="button"
      aria-label="Separate stage"
      onClick={() => { if (!disabled) onClick(); }}
      disabled={disabled}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex flex-col items-center justify-center w-[4.75rem] h-[4.75rem] rounded-full border-2
                  font-black backdrop-blur-md transition-all touch-none active:scale-95
                  ${disabled
                    ? 'border-white/10 bg-white/[0.03] text-dim/50 cursor-default'
                    : 'border-yellow/60 bg-yellow/15 text-yellow active:bg-yellow/35 shadow-[0_0_18px_rgba(255,213,74,0.45)] animate-pulse'}`}
    >
      <span className="text-[10px] tracking-[0.15em] leading-none">STAGE</span>
      <span className="text-lg leading-none mt-0.5">⏏</span>
      {stageCount > 1 && (
        <span className="text-[8px] tracking-wider leading-none mt-0.5 tabular-nums">{remaining} left</span>
      )}
    </button>
  );
}

function SmallButton({
  children, onClick, ariaLabel, highlighted, disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  highlighted?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => { if (!disabled) onClick(); }}
      disabled={disabled}
      onContextMenu={(e) => e.preventDefault()}
      className={`w-12 h-12 rounded-full border text-base font-bold backdrop-blur-md
                  transition-all active:scale-90 touch-none
                  ${disabled
                    ? 'border-white/10 bg-white/[0.02] text-dim/40 cursor-default'
                    : highlighted
                      ? 'border-yellow/60 bg-yellow/15 text-yellow shadow-[0_0_14px_rgba(255,213,74,0.5)]'
                      : 'border-white/15 bg-white/[0.05] text-dim hover:text-ink'}`}
    >
      {children}
    </button>
  );
}
