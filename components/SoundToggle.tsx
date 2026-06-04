'use client';

import { useEffect, useState } from 'react';
import { isSoundEnabled, setSoundEnabled } from '@/lib/audio/AudioEngine';

/**
 * Small floating mute toggle for the programmatic flight audio. Lives top-right
 * so it clears the nav (top-left) and HUD (top-centre). Persists via the audio
 * engine's localStorage-backed flag.
 */
export default function SoundToggle() {
  const [on, setOn] = useState(true);

  // Read the persisted state on the client after mount (avoids SSR mismatch).
  useEffect(() => { setOn(isSoundEnabled()); }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    setSoundEnabled(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={on ? 'Mute sound' : 'Unmute sound'}
      aria-pressed={on}
      className="absolute z-50 top-[calc(0.75rem+env(safe-area-inset-top))]
                 right-[calc(0.75rem+env(safe-area-inset-right))]
                 inline-flex h-11 w-11 items-center justify-center rounded-2xl border
                 border-white/20 bg-panel/90 text-ink shadow-lg backdrop-blur
                 transition hover:border-cyan/45 hover:text-cyan active:scale-95"
    >
      <span className="text-lg leading-none">{on ? '🔊' : '🔇'}</span>
    </button>
  );
}
