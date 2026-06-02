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
    <div className="fixed top-[35%] left-1/2 -translate-x-1/2 z-40 pop-in pointer-events-none">
      <div className="panel px-7 py-5 text-center min-w-[260px]"
           style={{
             borderColor: '#ffd54a',
             borderWidth: 2,
             boxShadow: '0 0 0 4px rgba(255,213,74,0.1), 0 8px 36px rgba(255,213,74,0.35)'
           }}>
        <div className="text-3xl mb-1">🏆</div>
        <div className="text-yellow text-[10px] font-black tracking-[0.3em] uppercase mb-1">
          Milestone
        </div>
        <div className="text-ink font-black text-lg mb-1">{title}</div>
        <div className="text-dim text-xs">{subtitle}</div>
      </div>
    </div>
  );
}
