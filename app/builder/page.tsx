'use client';

import dynamic from 'next/dynamic';

const RocketBuilder = dynamic(() => import('@/components/RocketBuilder'), { ssr: false });

export default function BuilderPage() {
  return <RocketBuilder />;
}
