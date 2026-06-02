'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Game } from '@/lib/game/Game';
import type { FlightState, FlightPhase, MissionResult } from '@/lib/game/types';
import { loadBuild, loadCompletedMilestones, addCompletedMilestone, addUnlockedParts } from '@/lib/storage';
import { MILESTONES } from '@/lib/game/career/Milestones';
import HUDOverlay from './HUDOverlay';
import TouchControls from './TouchControls';
import OutOfFuelModal from './OutOfFuelModal';
import MissionSummary from './MissionSummary';
import MilestoneToast from './MilestoneToast';

type ToastInfo = { id: number; title: string; subtitle: string };

const SKIPPABLE: FlightPhase[] = ['flight', 'orbit', 'reentry'];

export default function GameScreen() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);

  const [flightState, setFlightState] = useState<FlightState | null>(null);
  const [nextTarget, setNextTarget] = useState<string>('Reach 500 m');
  const [outOfFuel, setOutOfFuel] = useState(false);
  const [missionResult, setMissionResult] = useState<MissionResult | null>(null);
  const [timeScale, setTimeScale] = useState(1);
  const [toast, setToast] = useState<ToastInfo | null>(null);
  const toastId = useRef(0);

  const pushToast = useCallback((title: string, subtitle: string) => {
    toastId.current += 1;
    setToast({ id: toastId.current, title, subtitle });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;
    let game: Game | null = null;

    (async () => {
      const { Game } = await import('@/lib/game/Game');
      if (!mounted) return;

      game = new Game({
        container: containerRef.current!,
        build: loadBuild(),
        completedMilestoneIds: loadCompletedMilestones(),
        callbacks: {
          onState: (s) => setFlightState(s),
          onMilestoneComplete: (id, unlocks) => {
            const m = MILESTONES.find((x) => x.id === id);
            if (!m) return;
            addCompletedMilestone(id);
            addUnlockedParts(unlocks);
            pushToast(m.name, m.description);
            const next = game?.getNextMilestone();
            if (next) setNextTarget(next.description);
            else setNextTarget('All milestones complete!');
          },
          onPhaseChange: (_p: FlightPhase) => {},
          onOutOfFuel: () => setOutOfFuel(true),
          onMissionEnd: (r) => {
            setOutOfFuel(false);
            setMissionResult(r);
          },
        },
      });

      gameRef.current = game;
      const first = game.getNextMilestone();
      if (first) setNextTarget(first.description);
      game.start();
    })();

    return () => {
      mounted = false;
      gameRef.current?.destroy();
      gameRef.current = null;
    };
  }, [pushToast]);

  // Apply time scale to engine
  useEffect(() => {
    if (gameRef.current) gameRef.current.timeScale = timeScale;
  }, [timeScale]);

  const handleRestart = useCallback(() => {
    gameRef.current?.reset();
    setOutOfFuel(false);
    setMissionResult(null);
    setTimeScale(1);
  }, []);

  const handleWarp = useCallback(() => {
    setTimeScale((ts) => (ts >= 16 ? 1 : ts >= 8 ? 16 : ts >= 4 ? 8 : ts * 2));
  }, []);

  const handleStage = useCallback(() => {
    gameRef.current?.triggerStage();
  }, []);

  const handleSkip = useCallback(() => {
    setOutOfFuel(false);
    setTimeScale(1);
    gameRef.current?.skipToCompletion();
  }, []);

  const handleCloseFuelModal = useCallback(() => {
    setOutOfFuel(false);
    setTimeScale(8);
  }, []);

  const phase = flightState?.phase ?? 'prelaunch';
  const canSkip = SKIPPABLE.includes(phase);

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg">
      {/* 3D canvas mount */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Top + bottom vignettes for HUD contrast */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-32
                      bg-gradient-to-b from-bg/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-40
                      bg-gradient-to-t from-bg/85 to-transparent" />

      {/* HUD */}
      <HUDOverlay state={flightState} nextTarget={nextTarget} timeScale={timeScale} />

      {/* Back button (top-left, above HUD pills) */}
      <Link
        href="/"
        className="absolute z-30 top-[calc(0.75rem+env(safe-area-inset-top))] left-[calc(0.75rem+env(safe-area-inset-left))]
                   inline-flex items-center justify-center w-10 h-10 rounded-full
                   border border-white/15 bg-bg/60 backdrop-blur text-ink/80 hover:text-ink hover:border-white/30
                   active:scale-95 transition"
        aria-label="Back to menu"
      >
        ←
      </Link>

      {/* Time warp controls */}
      {timeScale > 1 && (
        <div className="absolute z-30 top-[calc(0.75rem+env(safe-area-inset-top))] right-1/2 translate-x-1/2 mt-16
                        flex items-center gap-2 panel px-3 py-2 text-xs font-bold">
          <span className="text-yellow">⏩ {timeScale}×</span>
          <button onClick={() => setTimeScale(1)} className="text-dim hover:text-ink">✕</button>
        </div>
      )}

      {/* Touch / mouse controls */}
      <TouchControls
        onAction={(action, held) => gameRef.current?.input.setAction(action, held)}
        onReset={() => gameRef.current?.input.triggerReset()}
        onWarp={handleWarp}
        onStage={handleStage}
        onSkip={handleSkip}
        timeScale={timeScale}
        canStage={flightState?.canStage ?? false}
        stageCount={flightState?.stageCount ?? 1}
        activeStage={flightState?.activeStage ?? 0}
        canSkip={canSkip}
      />

      {/* Out-of-fuel modal */}
      {outOfFuel && !missionResult && (
        <OutOfFuelModal
          state={flightState}
          onRestart={handleRestart}
          onWarp={handleCloseFuelModal}
          onSkip={handleSkip}
        />
      )}

      {/* Mission summary (end of flight) */}
      {missionResult && (
        <MissionSummary result={missionResult} onRestart={handleRestart} />
      )}

      {/* Milestone toast */}
      {toast && (
        <MilestoneToast
          key={toast.id}
          title={toast.title}
          subtitle={toast.subtitle}
          onDone={() => setToast(null)}
        />
      )}
    </div>
  );
}
