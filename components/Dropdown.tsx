'use client';

import { useState } from 'react';

export type DropdownOption = { id: string; name: string };

/**
 * Compact, theme-matched select used across the plan UI (destination, launch
 * site). A real popover list rather than a row of chips — far easier to use on a
 * phone when the option count grows.
 */
export default function Dropdown({
  value, options, onChange, label, className,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (id: string) => void;
  /** Optional inline label rendered before the value (e.g. "LAUNCH FROM"). */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border-2 border-cyan/45
                   bg-cyan/[0.07] px-3 py-2 text-left transition hover:border-cyan/70 active:scale-[0.99]"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {label && <span className="shrink-0 text-[9px] tracking-[0.18em] text-dim">{label}</span>}
          <span className="truncate text-[12px] font-black text-ink">{current?.name ?? 'Select…'}</span>
        </span>
        <span className={`shrink-0 text-cyan transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
          <div
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-[40vh] overflow-y-auto
                       rounded-md border-2 border-cyan/40 bg-bg/95 p-1 shadow-2xl backdrop-blur-xl"
          >
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value}
                onClick={() => { onChange(o.id); setOpen(false); }}
                className={`flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-[12px] font-bold transition
                  ${o.id === value ? 'bg-cyan/15 text-cyan' : 'text-ink hover:bg-cyan/10'}`}
              >
                {o.name}
                {o.id === value && <span className="text-[10px] text-cyan">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
