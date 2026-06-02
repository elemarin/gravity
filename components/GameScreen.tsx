'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Game } from '@/lib/game/Game';
import type { FlightState, MissionResult } from '@/lib/game/types';
import type { FlightPlan } from '@/lib/game/plan/FlightPlan';
import type { Body } from '@/lib/game/bodies';
import { getScenario, SCENARIOS } from '@/lib/game/bodies';
import {
  loadBuild, loadCompletedMilestones, addCompletedMilestone, addUnlockedParts,
  loadPlan, savePlan,
} from '@/lib/storage';
import { MILESTONES } from '@/lib/game/career/Milestones';
import {
  hapticThrust, hapticStage, hapticDeploy, hapticLanding, hapticCrash,
} from '@/lib/haptics';
import HUDOverlay from './HUDOverlay';
import PlanControls from './PlanControls';
import PlanPanel from './PlanPanel';
import SimControls from './SimControls';
import MissionSummary from './MissionSummary';
import MilestoneToast from './MilestoneToast';

type ToastInfo = { id: number; title: string; subtitle: string };
type PreviewInfo = { apoapsis: number; periapsis: number; impact: boolean };

export default function GameScreen() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const planRef = useRef<FlightPlan | null>(null);

  const [gameKey, setGameKey] = useState(0);
  const [mode, setMode] = useState<'plan' | 'sim'>('plan');
  const [plan, setPlanState] = useState<FlightPlan | null>(null);
  const [bodies, setBodies] = useState<Body[]>([]);
  const [hasLander, setHasLander] = useState(false);
  const [flightState, setFlightState] = useState<FlightState | null>(null);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [missionResult, setMissionResult] = useState<MissionResult | null>(null);
  const [nextTarget, setNextTarget] = useState<string>('Reach orbit');
  const [timeScale, setTimeScale] = useState(1);
  const [toast, setToast] = useState<ToastInfo | null>(null);
  const toastId = useRef(0);

  const setPlan = useCallback((p: FlightPlan | null) => {
    planRef.current = p;
    setPlanState(p);
  }, []);

  const pushToast = useCallback((title: string, subtitle: string) => {
    toastId.current += 1;
    setToast({ id: toastId.current, title, subtitle });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let mounted = true;

    const initialPlan = planRef.current ?? loadPlan();
    const build = loadBuild();
    setPlan(initialPlan);
    setBodies(getScenario(initialPlan.scenarioId).bodies);
    setHasLander(!!build.landerId);
    setMode('plan');

    (async () => {
      const { Game } = await import('@/lib/game/Game');
      if (!mounted || !containerRef.current) return;

      const game = new Game({
        container: containerRef.current,
        build,
        plan: initialPlan,
        completedMilestoneIds: loadCompletedMilestones(),
        callbacks: {
          onState: (s) => setFlightState(s),
          onPreview: (info) => setPreview(info),
          onModeChange: (m) => setMode(m),
          onThrustStart: () => hapticThrust(),
          onStageSeparation: () => hapticStage(),
          onLanderDeploy: () => hapticDeploy(),
          onTouchdown: (outcome) => (outcome === 'landed' ? hapticLanding() : hapticCrash()),
          onMilestoneComplete: (id, unlocks) => {
            const m = MILESTONES.find((x) => x.id === id);
            if (!m) return;
            addCompletedMilestone(id);
            addUnlockedParts(unlocks);
            pushToast(m.name, m.description);
            const next = game.getNextMilestone();
            setNextTarget(next ? next.description : 'All milestones complete!');
          },
          onMissionEnd: (r) => setMissionResult(r),
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
  }, [gameKey, pushToast, setPlan]);

  useEffect(() => {
    if (gameRef.current) gameRef.current.timeScale = timeScale;
  }, [timeScale]);

  const handlePlanChange = useCallback((next: FlightPlan) => {
    setPlan(next);
    savePlan(next);
    gameRef.current?.setPlan(next);
  }, [setPlan]);

  const handleAim = useCallback((heading: number, power: number) => {
    gameRef.current?.setLaunch(heading, power);
    const next = gameRef.current?.getPlan();
    if (next) { setPlan(next); savePlan(next); }
  }, [setPlan]);

  const handlePlay = useCallback(() => {
    setMissionResult(null);
    setTimeScale(1);
    gameRef.current?.play();
  }, []);

  const handleEdit = useCallback(() => {
    setMissionResult(null);
    setTimeScale(1);
    gameRef.current?.edit();
  }, []);

  const handleReplay = useCallback(() => {
    setMissionResult(null);
    setTimeScale(1);
    gameRef.current?.play();
  }, []);

  const handleWarp = useCallback(() => {
    setTimeScale((ts) => (ts >= 16 ? 1 : ts >= 8 ? 16 : ts >= 4 ? 8 : ts * 2));
  }, []);

  const handleSkip = useCallback(() => {
    setTimeScale(1);
    gameRef.current?.skipToCompletion();
  }, []);

  const handleScenario = useCallback((id: string) => {
    const cur = planRef.current;
    if (!cur || cur.scenarioId === id) return;
    const next = { ...cur, scenarioId: id };
    savePlan(next);
    setPlan(next);
    setBodies(getScenario(id).bodies);
    setMissionResult(null);
    setTimeScale(1);
    setGameKey((k) => k + 1); // rebuild Game with the new body set
  }, [setPlan]);

  const phase = flightState?.phase ?? 'prelaunch';
  const finished = phase === 'landed' || phase === 'destroyed';
  const canSkip = mode === 'sim' && !finished && phase !== 'prelaunch';
  const scenario = plan ? getScenario(plan.scenarioId) : null;

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-32
                      bg-gradient-to-b from-bg/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-48
                      bg-gradient-to-t from-bg/85 to-transparent" />

      {mode === 'sim' && (
        <HUDOverlay state={flightState} nextTarget={nextTarget} timeScale={timeScale} />
      )}

      {/* Back button */}
      <Link
        href="/"
        className="absolute z-40 top-[calc(0.75rem+env(safe-area-inset-top))] left-[calc(0.75rem+env(safe-area-inset-left))]
                   inline-flex items-center justify-center w-10 h-10 rounded-full
                   border border-white/15 bg-bg/60 backdrop-blur text-ink/80 hover:text-ink hover:border-white/30
                   active:scale-95 transition"
        aria-label="Back to menu"
      >←</Link>

      {/* Plan mode: scenario banner + objective */}
      {mode === 'plan' && scenario && (
        <div className="absolute z-30 top-[calc(0.75rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2
                        panel px-3 py-2 text-center max-w-[80vw] flex flex-col items-center gap-1.5">
          <div className="flex gap-1">
            {SCENARIOS.map((sc) => (
              <button
                key={sc.id}
                onClick={() => handleScenario(sc.id)}
                aria-label={`Select ${sc.name} scenario`}
                aria-current={sc.id === scenario.id ? 'true' : undefined}
                className={`text-[9px] font-black tracking-[0.15em] uppercase rounded-full px-2.5 py-1 border
                  ${sc.id === scenario.id
                    ? 'border-cyan/60 bg-cyan/15 text-cyan'
                    : 'border-white/10 bg-white/[0.03] text-dim'}`}
              >{sc.name}</button>
            ))}
          </div>
          <div className="text-[10px] text-dim truncate max-w-[70vw]">{scenario.objective}</div>
        </div>
      )}

      {/* Plan mode: aim controller + plan panel */}
      {mode === 'plan' && plan && (
        <>
          <PlanControls
            heading={plan.launch.heading}
            power={plan.launch.power}
            onCommit={handleAim}
          />
          <PlanPanel
            plan={plan}
            bodies={bodies}
            hasLander={hasLander}
            preview={preview}
            onChange={handlePlanChange}
            onPlay={handlePlay}
          />
        </>
      )}

      {/* Sim mode: controls */}
      {mode === 'sim' && (
        <SimControls
          finished={finished}
          timeScale={timeScale}
          canSkip={canSkip}
          onEdit={handleEdit}
          onReplay={handleReplay}
          onWarp={handleWarp}
          onSkip={handleSkip}
        />
      )}

      {missionResult && (
        <MissionSummary result={missionResult} onRestart={handleReplay} />
      )}

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
