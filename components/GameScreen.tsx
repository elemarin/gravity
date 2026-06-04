'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Game } from '@/lib/game/Game';
import type { FlightState, MissionResult, RocketBuild } from '@/lib/game/types';
import { MISSION_LABELS, type FlightPlan } from '@/lib/game/plan/FlightPlan';
import { buildFlightBodies, destinationTargetId, bodyDef } from '@/lib/game/bodies';
import { autoPlan, defaultOrbitKm } from '@/lib/game/plan/AutoPlan';
import {
  loadBuild, loadCompletedMilestones, addCompletedMilestone, addUnlockedParts,
  loadPlan, savePlan, loadBases, addBase, loadGoals, addGoal,
} from '@/lib/storage';
import { MILESTONES } from '@/lib/game/career/Milestones';
import { evaluateGoals, campaignGoal } from '@/lib/game/career/Progress';
import { getPart } from '@/lib/game/career/Parts';
import { estimateBuildDeltaV } from '@/lib/game/BuildSpec';
import {
  hapticThrust, hapticStage, hapticDeploy, hapticLanding, hapticCrash,
} from '@/lib/haptics';
import {
  startFlightAudio, stopFlightAudio, updateFlightAudio,
  soundIgnite, soundStage, soundTouchdown,
} from '@/lib/audio/AudioEngine';
import HUDOverlay from './HUDOverlay';
import PlanPanel from './PlanPanel';
import SimControls from './SimControls';
import StageStack from './StageStack';
import MissionSummary from './MissionSummary';
import MilestoneToast from './MilestoneToast';
import NavDrawer from './NavDrawer';
import SoundToggle from './SoundToggle';

type ToastInfo = { id: number; title: string; subtitle: string };

/** The engine driving the current thruster sound (active stage, or lander). */
function activeEngineId(build: RocketBuild | null, state: FlightState): string | undefined {
  if (!build) return undefined;
  if (state.landerDeployed && build.landerId) return build.landerId;
  const stages = build.stages && build.stages.length > 0
    ? build.stages
    : [{ engineId: build.engineId, tankIds: build.tankIds }];
  const idx = Math.min(Math.max(0, state.activeStage), stages.length - 1);
  return stages[idx]?.engineId ?? build.engineId;
}

/** True while the active engine is actually producing thrust. */
function isFiring(state: FlightState): boolean {
  return state.throttle > 0.001 && state.fuel > 0.001 &&
    state.phase !== 'landed' && state.phase !== 'destroyed';
}
type PreviewInfo = { apoapsis: number; periapsis: number; impact: boolean };

// Time-warp ladder. Long interplanetary coasts need the high multipliers.
const WARP_STEPS = [1, 2, 4, 8, 16, 25, 50, 75, 100, 200, 300, 400, 500];

function bodyNameWithArticle(id: string): string {
  const name = bodyDef(id).name;
  return name === 'Moon' ? 'the Moon' : name;
}

function missionObjective(plan: FlightPlan | null): string {
  if (!plan) return 'Launch';
  const kind = plan.mission?.kind ?? 'orbit';
  const targetId = destinationTargetId(plan.destinationId, plan.launchBodyId);
  if (targetId) {
    const target = bodyNameWithArticle(targetId);
    if (kind === 'orbit') return `Orbit ${target}`;
    if (kind === 'land') return `Land on ${target}`;
    return `${MISSION_LABELS[kind].replace(' & ', ' and ')} from ${target}`;
  }
  const launchBody = bodyNameWithArticle(plan.launchBodyId);
  const label = MISSION_LABELS[kind].replace(' & ', ' and ');
  return kind === 'land' || kind === 'land-return'
    ? `${label} on ${launchBody}`
    : `${label} around ${launchBody}`;
}

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
  const [buildDeltaV, setBuildDeltaV] = useState(0);
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
    setBuildDeltaV(estimateBuildDeltaV(build));
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
          onState: (s) => {
            setFlightState(s);
            // Note: `gameRef.current` (not the local `game`) — this callback can
            // fire from within the Game constructor, before `game` is assigned.
            if (gameRef.current?.mode === 'sim') {
              updateFlightAudio({
                throttle: s.throttle,
                altitude: s.altitude,
                firing: isFiring(s),
                engineId: activeEngineId(buildRef.current, s),
              });
            }
          },
          onPreview: (info) => setPreview(info),
          onModeChange: (m) => setMode(m),
          onThrustStart: () => { hapticThrust(); soundIgnite(); },
          onStageSeparation: () => { hapticStage(); soundStage(); },
          onLanderDeploy: () => { hapticDeploy(); soundStage(); },
          onTouchdown: (outcome) => {
            soundTouchdown(outcome === 'landed');
            outcome === 'landed' ? hapticLanding() : hapticCrash();
          },
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
      stopFlightAudio();
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
      if (g?.partUnlocks?.length) addUnlockedParts(g.partUnlocks);
      if (g) {
        const subtitle = g.partUnlocks?.length
          ? `Unlocked: ${g.partUnlocks.map((p) => getPart(p)?.name ?? p).join(', ')}`
          : g.baseUnlock ? 'New launch site unlocked!' : g.description;
        pushToast(`🏆 ${g.name}`, subtitle);
      }
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
    // Called from a click, so this satisfies the browser's autoplay gesture rule.
    startFlightAudio();
    gameRef.current?.play();
  }, []);

  const handleEdit = useCallback(() => {
    setMissionResult(null);
    setTimeScale(1);
    stopFlightAudio();
    gameRef.current?.edit();
  }, []);

  const handleReplay = useCallback(() => {
    setMissionResult(null);
    setTimeScale(1);
    stopFlightAudio();
    gameRef.current?.edit();
  }, []);

  const handleWarp = useCallback(() => {
    setTimeScale((ts) => {
      const i = WARP_STEPS.indexOf(ts);
      return WARP_STEPS[(i + 1) % WARP_STEPS.length];
    });
  }, []);

  const handleWarpUp = useCallback(() => {
    setTimeScale((ts) => {
      const i = WARP_STEPS.indexOf(ts);
      if (i < 0) return WARP_STEPS[1];
      return WARP_STEPS[Math.min(i + 1, WARP_STEPS.length - 1)];
    });
  }, []);

  const handleWarpDown = useCallback(() => {
    setTimeScale((ts) => {
      const i = WARP_STEPS.indexOf(ts);
      if (i <= 0) return WARP_STEPS[0];
      return WARP_STEPS[i - 1];
    });
  }, []);

  const handleSkip = useCallback(() => {
    setTimeScale(1);
    gameRef.current?.skipToCompletion();
  }, []);

  const handleStage = useCallback(() => gameRef.current?.manualStage(), []);
  const handleLander = useCallback(() => gameRef.current?.manualLander(), []);
  const handleLand = useCallback(() => gameRef.current?.manualLand(), []);

  const handleLaunchSite = useCallback((id: string) => {
    const cur = planRef.current;
    if (!cur || cur.launchBodyId === id) return;
    const mission = cur.mission ?? { kind: 'orbit' as const, orbitKm: defaultOrbitKm(id) };
    const targetId = destinationTargetId(cur.destinationId, id);
    const kind = targetId
      ? mission.kind
      : (mission.kind === 'land' || mission.kind === 'land-return' ? 'land' : 'orbit');
    handlePlanChange(autoPlan(id, cur.destinationId, { ...mission, kind }));
  }, [handlePlanChange]);

  const phase = flightState?.phase ?? 'prelaunch';
  const finished = phase === 'landed' || phase === 'destroyed' || !!missionResult;
  const canSkip = mode === 'sim' && !finished && phase !== 'prelaunch';
  const canStage = flightState?.canStage ?? false;
  const landerDeployed = flightState?.landerDeployed ?? false;
  // Offer the de-orbit/land button once the craft is actually in a stable orbit.
  const canLand = mode === 'sim' && !finished && phase === 'orbit';

  const bodies = plan
    ? buildFlightBodies(plan.launchBodyId, destinationTargetId(plan.destinationId, plan.launchBodyId))
    : [];

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-28
                      bg-gradient-to-b from-bg/55 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-48
                      bg-gradient-to-t from-bg/65 to-transparent" />

      {mode === 'sim' && (
        <>
          <HUDOverlay
            state={flightState}
            nextTarget={nextTarget}
            timeScale={timeScale}
            objective={missionObjective(plan)}
          />
          <StageStack state={flightState} />
        </>
      )}

      <NavDrawer title="Flight Menu" />
      <SoundToggle />

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
          buildDeltaV={buildDeltaV}
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
          canLand={canLand}
          parachuteDeployed={flightState?.parachuteDeployed ?? false}
          onEdit={handleEdit}
          onReplay={handleReplay}
          onWarp={handleWarp}
          onWarpUp={handleWarpUp}
          onWarpDown={handleWarpDown}
          onSkip={handleSkip}
          onStage={handleStage}
          onLander={handleLander}
          onLand={handleLand}
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
