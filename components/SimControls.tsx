'use client';

type Props = {
  finished: boolean;
  timeScale: number;
  canSkip: boolean;
  onEdit: () => void;
  onReplay: () => void;
  onWarp: () => void;
  onSkip: () => void;
};

/** Bottom controls shown while watching the plan play out. */
export default function SimControls({
  finished, timeScale, canSkip, onEdit, onReplay, onWarp, onSkip,
}: Props) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-center gap-2
                    pb-[calc(1rem+env(safe-area-inset-bottom))]
                    px-[calc(1rem+env(safe-area-inset-left))]
                    pr-[calc(1rem+env(safe-area-inset-right))]">
      <button onClick={onEdit} className="btn btn-secondary px-4 py-3 text-sm">✎ Edit plan</button>

      {!finished && (
        <>
          <button onClick={onWarp}
            className={`w-12 h-12 rounded-full border text-base font-bold backdrop-blur-md active:scale-90
              ${timeScale > 1 ? 'border-yellow/60 bg-yellow/15 text-yellow' : 'border-white/15 bg-white/[0.05] text-dim'}`}
            aria-label="Time warp">⏩</button>
          {canSkip && (
            <button onClick={onSkip}
              className="w-12 h-12 rounded-full border border-white/15 bg-white/[0.05] text-dim text-base
                         font-bold backdrop-blur-md active:scale-90" aria-label="Skip to end">⏭</button>
          )}
        </>
      )}

      <button onClick={onReplay} className="btn btn-primary px-4 py-3 text-sm">↻ Replay</button>
    </div>
  );
}
