'use client';

import { useEffect } from 'react';

export default function MilestoneToast({
  title, subtitle, onDone,
}: {
  title: string;
  subtitle: string;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className="fixed inset-x-0 z-50 pointer-events-none font-pixel fade-up"
      style={{ top: 'env(safe-area-inset-top)' }}
    >
      <div
        className="mx-auto max-w-sm flex items-center gap-3 px-4 py-2.5"
        style={{
          background: 'rgba(4,6,14,0.95)',
          borderBottom: '1px solid rgba(255,213,74,0.45)',
          boxShadow: '0 2px 16px rgba(255,213,74,0.18)',
        }}
      >
        <span className="text-yellow shrink-0" style={{ fontSize: 10 }}>★</span>
        <div className="flex flex-col min-w-0">
          <span className="text-yellow uppercase tracking-[0.2em] truncate" style={{ fontSize: 8 }}>
            {title}
          </span>
          <span className="text-dim truncate" style={{ fontSize: 7 }}>{subtitle}</span>
        </div>
      </div>
    </div>
  );
}
