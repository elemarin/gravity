'use client';

import dynamic from 'next/dynamic';

const GameScreen = dynamic(() => import('@/components/GameScreen'), { ssr: false });

export default function PlayPage() {
  return <GameScreen />;
}
