'use client';

import { useCallback, useRef, useState } from 'react';

type Props = {
  heading: number;          // current committed heading (deg from up)
  power: number;            // current committed power (0..1)
  onCommit: (heading: number, power: number) => void;
};

const MAX_PULL = 200; // px drag length that maps to full power

/**
 * Angry-Birds style launch controller. The player drags on the launch area to
 * set direction (heading) and pull length (power/throttle). An arrow + power
 * gauge preview the vector; releasing commits it and recomputes the arc.
 */
export default function PlanControls({ heading, power, onCommit }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ heading: number; power: number } | null>(null);

  const compute = useCallback((clientX: number, clientY: number) => {
    const o = originRef.current;
    const dx = clientX - o.x;
    const dy = clientY - o.y;
    const len = Math.hypot(dx, dy);
    // angle measured from straight up; right = +, left = -
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    deg = Math.max(-90, Math.min(90, deg));
    const pwr = Math.max(0, Math.min(1, len / MAX_PULL));
    return { heading: deg, power: pwr };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Launch origin: bottom-centre, where the rocket sits.
    originRef.current = { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.74 };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(compute(e.clientX, e.clientY));
  }, [compute]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag(compute(e.clientX, e.clientY));
  }, [drag, compute]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    onCommit(drag.heading, drag.power);
    setDrag(null);
  }, [drag, onCommit]);

  const shown = drag ?? { heading, power };
  const rad = (shown.heading * Math.PI) / 180;
  const len = 60 + shown.power * 140;
  const tipX = Math.sin(rad) * len;
  const tipY = -Math.cos(rad) * len;
  const pct = Math.round(shown.power * 100);

  return (
    <div
      ref={layerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="absolute inset-0 z-20 touch-none"
    >
      {/* Aim arrow anchored at the launch origin (bottom-centre) */}
      <div className="pointer-events-none absolute" style={{ left: '50%', top: '74%' }}>
        <svg width="1" height="1" style={{ overflow: 'visible' }} aria-hidden>
          <defs>
            <marker id="aimhead" markerWidth="10" markerHeight="10" refX="6" refY="5" orient="auto">
              <path d="M0,0 L8,5 L0,10 z" fill={drag ? '#00e5ff' : '#8aa0b5'} />
            </marker>
          </defs>
          <line
            x1="0" y1="0" x2={tipX} y2={tipY}
            stroke={drag ? '#00e5ff' : '#8aa0b5'}
            strokeWidth={drag ? 4 : 3}
            strokeDasharray={drag ? '0' : '6 6'}
            markerEnd="url(#aimhead)"
            opacity={drag ? 0.95 : 0.6}
          />
        </svg>
      </div>

      {/* Live readout while dragging */}
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[calc(40%)]
                      flex flex-col items-center gap-1">
        {drag && (
          <div className="panel px-4 py-2 flex items-center gap-4 pop-in">
            <span className="text-cyan text-sm font-black tabular-nums">{Math.round(shown.heading)}°</span>
            <span className="text-dim text-xs">·</span>
            <span className="text-orange text-sm font-black tabular-nums">{pct}%</span>
          </div>
        )}
      </div>

      {/* Hint when idle */}
      {!drag && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[42%]
                        text-[11px] tracking-[0.25em] uppercase text-dim/80 text-center">
          Drag to aim · pull for power
        </div>
      )}
    </div>
  );
}
