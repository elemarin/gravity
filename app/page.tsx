import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-bg font-pixel">
      <BackgroundStars />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-between px-6 py-10
                      pt-[calc(2.5rem+env(safe-area-inset-top))]
                      pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <header className="text-center fade-up">
          <div
            className="text-[11px] tracking-[0.35em] text-cyan/60 uppercase mb-3"
            style={{ textShadow: '0 0 12px rgba(0,229,255,0.4)' }}
          >
            ★ ★ ★
          </div>
          <h1
            className="text-4xl sm:text-6xl font-pixel tracking-[0.12em] text-ink"
            style={{
              textShadow: '0 0 30px rgba(0,229,255,0.6), 0 0 60px rgba(0,229,255,0.3), 3px 3px 0px rgba(0,229,255,0.15)',
              imageRendering: 'pixelated',
            }}
          >
            GRAVITY
          </h1>
          <p
            className="mt-4 text-[9px] tracking-[0.45em] text-dim/70 uppercase"
            style={{ textShadow: '0 0 8px rgba(138,160,181,0.3)' }}
          >
            BUILD · LAUNCH · ORBIT
          </p>
        </header>

        <div className="flex flex-col gap-3 w-full max-w-xs fade-up">
          <Link
            href="/play"
            className="btn btn-primary w-full py-4"
            style={{ fontSize: 11, letterSpacing: '0.15em' }}
          >
            ▶ PLAY
          </Link>
          <Link
            href="/builder"
            className="btn btn-secondary w-full py-3.5"
            style={{ fontSize: 9, letterSpacing: '0.12em' }}
          >
            ⚙ BUILD ROCKET
          </Link>
          <Link
            href="/career"
            className="btn btn-secondary w-full py-3.5"
            style={{ fontSize: 9, letterSpacing: '0.12em' }}
          >
            ★ CAREER
          </Link>
        </div>

        <footer
          className="text-center text-[7px] tracking-[0.3em] text-dim/40 uppercase"
        >
          SPACE PROGRAM ARCADE
        </footer>
      </div>
    </main>
  );
}

function BackgroundStars() {
  const stars = Array.from({ length: 80 }).map((_, i) => {
    const top   = Math.random() * 100;
    const left  = Math.random() * 100;
    const size  = Math.round(1 + Math.random() * 2);  // integer pixels for pixel look
    const delay = Math.random() * 4;
    const bright = Math.random() > 0.85;
    return (
      <div
        key={i}
        className="absolute bg-white"
        style={{
          top: `${top}%`,
          left: `${left}%`,
          width: size,
          height: size,
          opacity: bright ? 0.9 : (0.2 + Math.random() * 0.4),
          animation: bright ? `pixel-blink ${1.5 + Math.random()}s step-end infinite` : undefined,
          animationDelay: `${delay}s`,
          imageRendering: 'pixelated',
        }}
      />
    );
  });
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 bg-gradient-to-b from-bg via-[#08021a] to-bg" />
      {stars}
      {/* Pixel nebula glows */}
      <div className="absolute -top-32 -right-32 w-80 h-80 bg-purple/8 blur-[80px]" />
      <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-cyan/8 blur-[80px]" />
    </div>
  );
}
