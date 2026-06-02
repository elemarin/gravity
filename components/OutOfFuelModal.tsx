'use client';

import { FlightState } from '@/lib/game/types';

export default function OutOfFuelModal({
  state, onRestart, onWarp,
}: {
  state: FlightState | null;
  onRestart: () => void;
  onWarp:    () => void;
}) {
  const altKm = state ? Math.round(state.altitude) : 0;
  const inSpace = altKm >= 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm fade-up">
      <div className="panel pop-in mx-6 max-w-sm w-full p-7 text-center"
           style={{ borderColor: 'rgba(255,138,61,0.4)', boxShadow: '0 0 0 4px rgba(255,138,61,0.08), 0 20px 50px rgba(0,0,0,0.5)' }}>
        <div className="text-5xl mb-3">⛽</div>
        <div className="text-orange text-xs font-black tracking-[0.3em] uppercase mb-2">Out of Fuel</div>
        <h2 className="text-2xl font-black text-ink mb-1">Engine Silent</h2>
        <p className="text-dim text-sm mb-6">
          {inSpace
            ? `You're coasting at ${altKm} km. Gravity will eventually bring you home.`
            : `Without thrust, you'll fall back to Earth.`}
        </p>

        <div className="flex flex-col gap-3">
          <button onClick={onWarp} className="btn btn-warn w-full text-base">
            ⏩ Fast Forward
          </button>
          <button onClick={onRestart} className="btn btn-secondary w-full text-base">
            ↻ Restart Flight
          </button>
        </div>

        <p className="text-[10px] text-dim/70 mt-4 tracking-widest uppercase">
          Tip: Build a bigger tank in the rocket builder
        </p>
      </div>
    </div>
  );
}
