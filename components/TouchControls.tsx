'use client';

import { useCallback } from 'react';
import type { ControlAction } from '@/lib/game/InputManager';

type Props = {
  onAction:    (action: ControlAction, held: boolean) => void;
  onReset:     () => void;
  onWarp:      () => void;
  timeScale:   number;
};

export default function TouchControls({ onAction, onReset, onWarp, timeScale }: Props) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 grid grid-cols-3 items-end gap-3
                    px-[calc(1rem+env(safe-area-inset-left))]
                    pr-[calc(1rem+env(safe-area-inset-right))]
                    pb-[calc(1rem+env(safe-area-inset-bottom))]
                    pointer-events-none">
      {/* LEFT */}
      <div className="flex justify-end pointer-events-auto pr-1">
        <HoldButton
          label="◀"
          ariaLabel="Rotate Left"
          onChange={(held) => onAction('rotateLeft', held)}
        />
      </div>

      {/* CENTER */}
      <div className="flex flex-col items-center gap-2 pointer-events-auto">
        <HoldButton
          label="▲"
          ariaLabel="Throttle Up"
          variant="primary"
          large
          onChange={(held) => onAction('throttleUp', held)}
        />
        <HoldButton
          label="▼"
          ariaLabel="Throttle Down"
          small
          onChange={(held) => onAction('throttleDown', held)}
        />
        <div className="flex gap-2">
          <SmallButton onClick={onReset} ariaLabel="Reset">↺</SmallButton>
          <SmallButton
            onClick={onWarp}
            ariaLabel="Time Warp"
            highlighted={timeScale > 1}
          >
            ⏩
          </SmallButton>
        </div>
      </div>

      {/* RIGHT */}
      <div className="flex justify-start pointer-events-auto pl-1">
        <HoldButton
          label="▶"
          ariaLabel="Rotate Right"
          onChange={(held) => onAction('rotateRight', held)}
        />
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
  const dim = large ? 'w-[5.25rem] h-[5.25rem] text-3xl' :
              small ? 'w-12 h-12 text-base' :
                      'w-16 h-16 text-2xl';

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

function SmallButton({
  children, onClick, ariaLabel, highlighted,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      className={`w-11 h-11 rounded-full border text-sm font-bold backdrop-blur-md
                  transition-all active:scale-90 touch-none
                  ${highlighted
                    ? 'border-yellow/60 bg-yellow/15 text-yellow shadow-[0_0_14px_rgba(255,213,74,0.5)]'
                    : 'border-white/15 bg-white/[0.05] text-dim hover:text-ink'}`}
    >
      {children}
    </button>
  );
}
