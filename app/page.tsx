'use client';

import dynamic from 'next/dynamic';

// Boot straight into the launch screen — no title menu. Builder, Career and
// Models stay reachable from the in-game NavDrawer.
const GameScreen = dynamic(() => import('@/components/GameScreen'), { ssr: false });

export default function HomePage() {
  return <GameScreen />;
}
