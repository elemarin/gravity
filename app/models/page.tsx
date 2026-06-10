'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { buildSystem, Body } from '@/lib/game/bodies';
import { PlanetCanvas } from './PlanetCanvas';

export default function ModelsPage() {
  const [bodies, setBodies] = useState<Body[]>([]);
  const [selectedId, setSelectedId] = useState<string>('earth');

  useEffect(() => {
    // buildSystem is safe to call client-side
    setBodies(buildSystem(0));
  }, []);

  if (bodies.length === 0) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center font-pixel text-ink">
        <p className="animate-pulse">LOADING CELESTIAL MODELS...</p>
      </div>
    );
  }

  const selectedBody = bodies.find((b) => b.id === selectedId) || bodies[0];

  const getBodyType = (b: Body) => {
    if (b.star) return 'Star';
    if (b.gas) return 'Gas Giant';
    return 'Terrestrial';
  };

  return (
    <main className="min-h-screen bg-bg font-pixel text-ink p-4 md:p-8 flex flex-col">
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8 border-b-2 border-cyan/30 pb-4">
        <div>
          <h1 className="text-2xl md:text-3xl text-cyan tracking-wider uppercase" style={{ textShadow: '0 0 10px rgba(0,229,255,0.4)' }}>
            Celestial Models
          </h1>
          <p className="text-[10px] text-dim mt-1 uppercase tracking-widest">
            Dev Mode Sandbox & Explorer
          </p>
        </div>
        <Link href="/" className="btn btn-secondary py-2 px-4 text-xs">
          ◀ BACK TO LAUNCH
        </Link>
      </header>

      {/* Mobile View: Selectable via Dropdown */}
      <div className="block md:hidden flex-1 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label className="text-[10px] text-dim uppercase tracking-wider">Select Model:</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-bg-dark border-2 border-cyan/40 text-cyan px-3 py-2 text-sm rounded font-pixel focus:outline-none focus:border-cyan"
          >
            {bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {/* Selected Model Card */}
        <div className="flex-1 min-h-[350px] bg-bg-dark border-2 border-cyan/20 rounded p-4 flex flex-col justify-between shadow-lg">
          <div className="h-[220px] bg-black/40 border border-cyan/10 rounded relative overflow-hidden">
            <PlanetCanvas body={selectedBody} />
          </div>

          <div className="mt-4 flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg text-ink uppercase tracking-wide">{selectedBody.name}</h2>
                <span className="text-[8px] px-2 py-0.5 bg-cyan/10 text-cyan border border-cyan/20 rounded uppercase">
                  {getBodyType(selectedBody)}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-[9px] uppercase tracking-wider text-dim">
                <div>Radius:</div>
                <div className="text-cyan text-right">{selectedBody.radius} km</div>
                <div>Gravity:</div>
                <div className="text-cyan text-right">{(selectedBody.gravityScale * 9.81).toFixed(2)} m/s²</div>
                <div>Atmosphere:</div>
                <div className="text-cyan text-right">
                  {selectedBody.atmosphereHeight > 0 ? `${selectedBody.atmosphereHeight} km` : 'None'}
                </div>
                <div>Sphere of Influence:</div>
                <div className="text-cyan text-right">{selectedBody.soiRadius} km</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop View: Cards */}
      <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 flex-1">
        {bodies.map((b) => (
          <div
            key={b.id}
            className="bg-bg-dark border-2 border-cyan/20 rounded hover:border-cyan/50 transition-colors p-4 flex flex-col justify-between shadow-md"
          >
            <div className="h-[180px] bg-black/30 border border-cyan/10 rounded relative overflow-hidden">
              <PlanetCanvas body={b} />
            </div>

            <div className="mt-4 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm text-ink uppercase tracking-wide">{b.name}</h3>
                  <span className="text-[8px] px-1.5 py-0.5 bg-cyan/10 text-cyan border border-cyan/20 rounded uppercase">
                    {getBodyType(b)}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-y-1.5 text-[9px] uppercase tracking-wider text-dim">
                  <div>Radius:</div>
                  <div className="text-cyan text-right">{b.radius} km</div>
                  <div>Gravity:</div>
                  <div className="text-cyan text-right">{(b.gravityScale * 9.81).toFixed(2)} m/s²</div>
                  <div>Atmosphere:</div>
                  <div className="text-cyan text-right">
                    {b.atmosphereHeight > 0 ? `${b.atmosphereHeight} km` : 'None'}
                  </div>
                  <div>SOI Radius:</div>
                  <div className="text-cyan text-right">{b.soiRadius} km</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
