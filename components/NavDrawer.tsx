'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadDevMode, saveDevMode } from '@/lib/storage';

const MENU_ITEMS = [
  { href: '/', label: 'Launch', icon: '▶' },
  { href: '/builder', label: 'Rocket Builder', icon: '🛠' },
  { href: '/career', label: 'Contracts & Career', icon: '📋' },
  { href: '/models', label: 'Celestial Models', icon: '🪐' },
];

export default function NavDrawer({
  title = 'Menu',
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  title?: string;
  /** Controlled open state. When provided, the parent owns the open/close. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in mobile floating hamburger (e.g. when a screen renders
      its own menu button inside a header bar). */
  hideTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };

  useEffect(() => { setDevMode(loadDevMode()); }, []);

  const toggleDev = () => {
    const next = !devMode;
    setDevMode(next);
    saveDevMode(next);
    // Reload so all screens pick up the unlock/lock change.
    window.location.reload();
  };

  return (
    <>
      {/* Desktop nav — horizontal bar, visible on md+ */}
      <nav
        className="hidden md:flex absolute z-50 top-[calc(0.75rem+env(safe-area-inset-top))]
                   left-[calc(0.75rem+env(safe-area-inset-left))] items-center gap-2"
      >
        {MENU_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2 rounded-xl border border-white/20
                       bg-panel/90 px-4 py-2 text-sm font-bold text-ink shadow-lg backdrop-blur
                       transition hover:border-cyan/45 hover:text-cyan active:scale-95"
          >
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={toggleDev}
          className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold shadow-lg backdrop-blur
                      transition active:scale-95
                      ${devMode
                        ? 'border-yellow/50 bg-yellow/15 text-yellow'
                        : 'border-white/20 bg-panel/90 text-ink hover:border-cyan/45 hover:text-cyan'}`}
          title={devMode ? 'Dev mode ON — all parts unlocked' : 'Enable dev mode'}
        >
          <span className="text-base leading-none">⚙</span>
          {devMode && <span className="text-[10px]">DEV</span>}
        </button>
      </nav>

      {/* Mobile hamburger — retro pixel button, visible below md */}
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="md:hidden absolute z-50 top-[calc(0.75rem+env(safe-area-inset-top))] left-[calc(0.75rem+env(safe-area-inset-left))]
                     inline-flex h-11 w-11 items-center justify-center rounded-md border-2 border-cyan/50
                     bg-cyan/[0.08] text-cyan shadow-[0_0_12px_rgba(31,217,255,0.25)] transition
                     hover:bg-cyan/15 hover:border-cyan/70 active:scale-95"
          aria-label="Open menu"
        >
          <span className="text-lg font-black leading-none tracking-tighter">≡</span>
        </button>
      )}

      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px] md:hidden"
        />
      )}

      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 flex w-[min(20rem,82vw)] flex-col gap-4 border-r border-white/15
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
              className="flex items-center gap-3 rounded-md border-2 border-white/12 bg-white/[0.06] px-4 py-3
                         text-xs font-bold text-ink transition hover:border-cyan/45 hover:bg-cyan/10 hover:text-cyan"
            >
              <span className="w-5 text-center text-base">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Settings */}
        <div className="mt-auto border-t border-white/10 pt-4">
          <div className="text-[8px] uppercase tracking-[0.25em] text-dim/60 mb-2">Settings</div>
          <button
            type="button"
            onClick={toggleDev}
            className={`flex items-center gap-3 w-full rounded-md border-2 px-4 py-3 text-xs font-bold transition
              ${devMode
                ? 'border-yellow/40 bg-yellow/10 text-yellow'
                : 'border-white/12 bg-white/[0.06] text-dim hover:border-cyan/45 hover:text-cyan'}`}
          >
            <span className="w-5 text-center text-base">⚙</span>
            {devMode ? 'Dev Mode ✓' : 'Dev Mode'}
          </button>
          {devMode && (
            <p className="text-[9px] text-yellow/70 mt-1.5 px-1 leading-relaxed">
              All parts &amp; facilities unlocked. Copy Flight Log available during flight.
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
