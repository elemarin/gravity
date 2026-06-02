'use client';

import { useState } from 'react';
import Link from 'next/link';

const MENU_ITEMS = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/play', label: 'Launch', icon: '▶' },
  { href: '/builder', label: 'Rocket Builder', icon: '🛠' },
  { href: '/career', label: 'Career', icon: '★' },
];

export default function NavDrawer({ title = 'Menu' }: { title?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute z-50 top-[calc(0.75rem+env(safe-area-inset-top))] left-[calc(0.75rem+env(safe-area-inset-left))]
                   inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20
                   bg-panel/90 text-ink shadow-lg backdrop-blur transition hover:border-cyan/45 hover:text-cyan active:scale-95"
        aria-label="Open menu"
      >
        <span className="text-xl leading-none">☰</span>
      </button>

      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px]"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(20rem,82vw)] flex-col gap-4 border-r border-white/15
                    bg-bg/95 px-5 pb-6 pt-[calc(5rem+env(safe-area-inset-top))] shadow-2xl backdrop-blur-xl
                    transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-hidden={!open}
      >
        <div>
          <div className="text-[8px] uppercase tracking-[0.35em] text-cyan/70">Gravity</div>
          <h2 className="mt-2 text-lg font-black tracking-widest text-ink">{title}</h2>
        </div>

        <nav className="flex flex-col gap-2">
          {MENU_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3
                         text-xs font-bold text-ink transition hover:border-cyan/45 hover:bg-cyan/10 hover:text-cyan"
            >
              <span className="w-5 text-center text-base">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}
