'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Game } from '@/lib/game/Game';
import type { FlightState, MissionResult, RocketBuild } from '@/lib/game/types';
import type { FlightPlan } from '@/lib/game/plan/FlightPlan';
import { buildFlightBodies, getDestination, bodyDef } from '@/lib/game/bodies';
import {
  loadBuild, loadCompletedMilestones, addCompletedMilestone, addUnlockedParts,
  loadPlan, savePlan, loadBases, addBase, loadGoals, addGoal,
} from '@/lib/storage';
import { MILESTONES } from '@/lib/game/career/Milestones';
import { evaluateGoals, campaignGoal } from '@/lib/game/career/Progress';
import {
  hapticThrust, hapticStage, hapticDeploy, hapticLanding, hapticCrash,
} from '@/lib/haptics';
import HUDOverlay from './HUDOverlay';
import PlanPanel from './PlanPanel';
import SimControls from './SimControls';
import StageStack from './StageStack';
import MissionSummary from './MissionSummary';
import MilestoneToast from './MilestoneToast';
import NavDrawer from './NavDrawer';

type ToastInfo = { id: number; title: string; subtitle: string };
type PreviewInfo = { apoapsis: number; periapsis: number; impact: boolean };

// Time-warp ladder. Long interplanetary coasts need the high multipliers.
const WARP_STEPS = [1, 2, 4, 8, 16, 25, 50, 75, 100];

export default function GameScreen() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const planRef = useRef<FlightPlan | null>(null);
  const buildRef = useRef<RocketBuild | null>(null);

  const [gameKey, setGameKey] = useState(0);
  const [mode, setMode] = useState<'plan' | 'sim'>('plan');
  const [plan, setPlanState] = useState<FlightPlan | null>(null);
  const [hasLander, setHasLander] = useState(false);
  const [hasParachute, setHasParachute] = useState(false);
  const [flightState, setFlightState] = useState<FlightState | null>(null);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [missionResult, setMissionResult] = useState<MissionResult | null>(null);
  const [nextTarget, setNextTarget] = useState<string>('Reach orbit');
  const [timeScale, setTimeScale] = useState(1);
  const [toast, setToast] = useState<ToastInfo | null>(null);
  const [bases, setBases] = useState<string[]>(['earth']);
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
    buildRef.current = build;
    setPlan(initialPlan);
    setHasLander(!!build.landerId);
    setBases(loadBases());
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
          onMissionEnd: (r) => {
            setMissionResult(r);
            awardGoals(r);
          },
        },
      });

      gameRef.current = game;
      setHasParachute(game.hasParachute);
      const first = game.getNextMilestone();
      if (first) setNextTarget(first.description);
      game.start();
    })();

    return () => {
      mounted = false;
      gameRef.current?.destroy();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey, pushToast, setPlan]);

  useEffect(() => {
    if (gameRef.current) gameRef.current.timeScale = timeScale;
  }, [timeScale]);

  /** Award campaign goals (Moon landing, ISS, bases, Mars…) on mission end. */
  const awardGoals = useCallback((result: MissionResult) => {
    const build = buildRef.current;
    const p = planRef.current;
    if (!build || !p) return;
    const newly = evaluateGoals(
      { result, build, launchBodyId: p.launchBodyId },
      loadGoals(),
    );
    for (const id of newly) {
      addGoal(id);
      const g = campaignGoal(id);
      if (g?.baseUnlock) { addBase(g.baseUnlock); setBases(loadBases()); }
      if (g) pushToast(`🏆 ${g.name}`, g.baseUnlock ? 'New launch site unlocked!' : g.description);
    }
  }, [pushToast]);

  const handlePlanChange = useCallback((next: FlightPlan) => {
    const prev = planRef.current;
    setPlan(next);
    savePlan(next);
    // Changing launch site or destination rebuilds the world.
    if (prev && (prev.launchBodyId !== next.launchBodyId || prev.destinationId !== next.destinationId)) {
      setMissionResult(null);
      setTimeScale(1);
      setGameKey((k) => k + 1);
    } else {
      gameRef.current?.setPlan(next);
    }
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
    setTimeScale((ts) => {
      const i = WARP_STEPS.indexOf(ts);
      return WARP_STEPS[(i + 1) % WARP_STEPS.length];
    });
  }, []);

  const handleSkip = useCallback(() => {
    setTimeScale(1);
    gameRef.current?.skipToCompletion();
  }, []);

  const handleStage = useCallback(() => gameRef.current?.manualStage(), []);
  const handleLander = useCallback(() => gameRef.current?.manualLander(), []);

  const handleLaunchSite = useCallback((id: string) => {
    const cur = planRef.current;
    if (!cur || cur.launchBodyId === id) return;
    handlePlanChange({ ...cur, launchBodyId: id });
  }, [handlePlanChange]);

  const phase = flightState?.phase ?? 'prelaunch';
  const finished = phase === 'landed' || phase === 'destroyed' || !!missionResult;
  const canSkip = mode === 'sim' && !finished && phase !== 'prelaunch';
  const canStage = flightState?.canStage ?? false;
  const landerDeployed = flightState?.landerDeployed ?? false;

  const dest = plan ? getDestination(plan.destinationId) : null;
  const bodies = plan ? buildFlightBodies(plan.launchBodyId, dest?.targetId ?? null) : [];

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-28
                      bg-gradient-to-b from-bg/55 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-48
                      bg-gradient-to-t from-bg/65 to-transparent" />

      {mode === 'sim' && (
        <>
          <HUDOverlay state={flightState} nextTarget={nextTarget} timeScale={timeScale} />
          <StageStack state={flightState} />
        </>
      )}

      <NavDrawer title="Flight Menu" />

      {/* Launch-site chip (replaces the old scenario banner) */}
      {mode === 'plan' && plan && bases.length > 1 && (
        <div className="absolute z-30 top-[calc(0.75rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2
                        panel px-2 py-1.5 flex items-center gap-1">
          <span className="text-[9px] text-dim px-1">LAUNCH&nbsp;FROM</span>
          {bases.map((id) => (
            <button
              key={id}
              onClick={() => handleLaunchSite(id)}
              className={`text-[10px] font-black tracking-wider uppercase rounded-md px-2.5 py-1 border
                ${id === plan.launchBodyId
                  ? 'border-cyan/70 bg-cyan/20 text-cyan'
                  : 'border-white/15 bg-white/[0.06] text-dim'}`}
            >{bodyDef(id).name}</button>
          ))}
        </div>
      )}

      {/* Plan mode: plan panel (destination, launch + maneuvers) */}
      {mode === 'plan' && plan && (
        <PlanPanel
          plan={plan}
          bodies={bodies}
          hasLander={hasLander}
          preview={preview}
          onChange={handlePlanChange}
          onPlay={handlePlay}
        />
      )}

      {/* Sim mode: controls */}
      {mode === 'sim' && (
        <SimControls
          finished={finished}
          phase={phase}
          timeScale={timeScale}
          canSkip={canSkip}
          canStage={canStage}
          hasLander={hasLander}
          hasParachute={hasParachute}
          landerDeployed={landerDeployed}
          parachuteDeployed={flightState?.parachuteDeployed ?? false}
          onEdit={handleEdit}
          onReplay={handleReplay}
          onWarp={handleWarp}
          onSkip={handleSkip}
          onStage={handleStage}
          onLander={handleLander}
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
