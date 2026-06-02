'use client';

import dynamic from 'next/dynamic';

const CareerView = dynamic(() => import('@/components/CareerView'), { ssr: false });

export default function CareerPage() {
  return <CareerView />;
}
