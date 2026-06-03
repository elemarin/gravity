'use client';

import { FlightState } from '@/lib/game/types';

/**
 * Stage stack indicator — bottom-right of the HUD. Stages are drawn bottom-up
 * (stage 1 at the bottom, like the real rocket) with the active stage lit and
 * its remaining fuel shown as a fill.
 */
export default function StageStack({ state }: { state: FlightState | null }) {
  const count = state?.stageCount ?? 1;
  if (!state || count <= 1) return null;

  const active = state.activeStage;
  const fuel = Math.max(0, Math.min(100, state.fuel));

  // Indices top→bottom so the flex column renders stage 1 at the bottom.
  const order = Array.from({ length: count }, (_, i) => count - 1 - i);

  return (
    <div className="pointer-events-none absolute z-20 font-pixel flex flex-col gap-1 items-stretch
                    right-[calc(0.5rem+env(safe-area-inset-right))]
                    top-1/2 -translate-y-1/2"
         style={{ width: 30 }}>
      {order.map((i) => {
        const isActive = i === active;
        const spent = i < active;
        return (
          <div
            key={i}
            className="relative h-6 rounded-md border overflow-hidden flex items-center justify-center"
            style={{
              borderColor: isActive ? 'rgba(31,217,255,0.9)' : spent ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.28)',
              background: spent ? 'rgba(255,255,255,0.04)' : 'rgba(8,24,56,0.5)',
              boxShadow: isActive ? '0 0 10px rgba(31,217,255,0.45)' : undefined,
              opacity: spent ? 0.4 : 1,
            }}
          >
            {isActive && (
              <div
                className="absolute inset-y-0 left-0 transition-[width] duration-200"
                style={{
                  width: `${fuel}%`,
                  background: fuel > 50 ? 'rgba(57,233,166,0.35)' : fuel > 20 ? 'rgba(255,216,77,0.35)' : 'rgba(255,107,134,0.4)',
                }}
              />
            )}
            <span
              className="relative text-[10px] font-black tabular-nums"
              style={{ color: isActive ? '#1fd9ff' : spent ? '#9fb3d0' : '#f3f9ff' }}
            >
              S{i + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}
