import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-bg">
      <BackgroundStars />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-between px-6 py-10
                      pt-[calc(2.5rem+env(safe-area-inset-top))]
                      pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <header className="text-center fade-up">
          <h1 className="text-5xl sm:text-7xl font-black tracking-widest text-ink drop-shadow-[0_0_24px_rgba(0,229,255,0.5)]">
            GRAVITY
          </h1>
          <p className="mt-3 text-xs sm:text-sm tracking-[0.4em] text-dim uppercase">
            Build · Launch · Orbit
          </p>
        </header>

        <div className="flex flex-col gap-4 w-full max-w-xs fade-up">
          <Link href="/play"     className="btn btn-primary w-full text-lg py-4">▶ Play</Link>
          <Link href="/builder"  className="btn btn-secondary w-full text-lg py-4">🛠 Build Rocket</Link>
          <Link href="/career"   className="btn btn-secondary w-full text-lg py-4">🏆 Career</Link>
        </div>

        <footer className="text-center text-[10px] tracking-[0.3em] text-dim/60 uppercase">
          A space program arcade
        </footer>
      </div>
    </main>
  );
}

function BackgroundStars() {
  // CSS-only star field for the menu (game uses Three.js stars in /play)
  const stars = Array.from({ length: 60 }).map((_, i) => {
    const top  = Math.random() * 100;
    const left = Math.random() * 100;
    const size = 1 + Math.random() * 2;
    const delay = Math.random() * 3;
    return (
      <div
        key={i}
        className="absolute rounded-full bg-white animate-pulse"
        style={{
          top: `${top}%`,
          left: `${left}%`,
          width: `${size}px`,
          height: `${size}px`,
          opacity: 0.3 + Math.random() * 0.5,
          animationDelay: `${delay}s`,
        }}
      />
    );
  });
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 bg-gradient-to-b from-bg via-[#0c0420] to-bg" />
      {stars}
      <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-purple/10 blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-cyan/10 blur-3xl" />
    </div>
  );
}
