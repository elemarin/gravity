'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Game } from '@/lib/game/Game';
import type { FlightState, MissionResult, RocketBuild } from '@/lib/game/types';
import { MISSION_LABELS, type FlightPlan } from '@/lib/game/plan/FlightPlan';
import { buildFlightBodies, destinationTargetId, bodyDef } from '@/lib/game/bodies';
import { autoPlan, defaultOrbitKm } from '@/lib/game/plan/AutoPlan';
import {
  loadBuild, loadCompletedMilestones, addCompletedMilestone,
  loadPlan, savePlan, loadBases, addBase, loadGoals, addGoal, loadDevMode,
  loadActiveContract, saveActiveContract, addCompletedContract, loadCompletedContracts,
  addMoney, addReputation, loadMoney, loadReputation,
} from '@/lib/storage';
import { rankForReputation } from '@/lib/game/career/Rank';
import { MILESTONES } from '@/lib/game/career/Milestones';
import { evaluateGoals, campaignGoal, stationGoalId, baseGoalId } from '@/lib/game/career/Progress';
import { Contract, evaluateContract } from '@/lib/game/career/Contracts';
import { fmtMoney } from '@/lib/game/career/Economy';
import { CONTRACT_FAILED_LINE } from '@/lib/game/career/Flavor';
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
import Dropdown from './Dropdown';

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
    return kind === 'land' ? `Land on ${target}` : `Orbit ${target}`;
  }
  const launchBody = bodyNameWithArticle(plan.launchBodyId);
  return kind === 'land'
    ? `${MISSION_LABELS[kind]} on ${launchBody}`
    : `${MISSION_LABELS[kind]} around ${launchBody}`;
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
  const [hasStation, setHasStation] = useState(false);
  const [flightState, setFlightState] = useState<FlightState | null>(null);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [missionResult, setMissionResult] = useState<MissionResult | null>(null);
  const [nextTarget, setNextTarget] = useState<string>('Reach orbit');
  const [timeScale, setTimeScale] = useState(1);
  const [toast, setToast] = useState<ToastInfo | null>(null);
  const [bases, setBases] = useState<string[]>(['earth']);
  const [buildDeltaV, setBuildDeltaV] = useState(0);
  const [devMode, setDevModeState] = useState(false);
  const [logCopied, setLogCopied] = useState(false);
  const [contract, setContract] = useState<Contract | null>(null);
  const [hasCapsule, setHasCapsule] = useState(false);
  const [hasSatelliteBus, setHasSatelliteBus] = useState(false);
  const [hasPayloadFairing, setHasPayloadFairing] = useState(false);
  const [payout, setPayout] = useState<{ title: string; amount: number; line: string } | null>(null);
  const [money, setMoney] = useState(0);
  const [rankTitle, setRankTitle] = useState('');
  const contractRef = useRef<Contract | null>(null);
  // Body a base module was surface-deployed on this flight (for base contracts).
  const surfaceDeployRef = useRef<string | null>(null);
  // How the last mission's contract settlement went — included in the debug log.
  const settlementRef = useRef<{
    skipped?: string;
    contractId?: string;
    contract?: Contract;
    context?: Record<string, unknown>;
    completed?: boolean;
    payout?: number;
  } | null>(null);
  const toastId = useRef(0);

  /** Re-read the wallet + rank after any award so the plan-mode chip is live. */
  const refreshWallet = useCallback(() => {
    setMoney(loadMoney());
    setRankTitle(rankForReputation(loadReputation()).title);
  }, []);

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
    setHasCapsule(getPart(build.noseId)?.type === 'capsule');
    setHasSatelliteBus(build.noseId === 'satellite-bus');
    setHasPayloadFairing(build.noseId === 'nose-fairing');
    setBases(loadBases());
    setDevModeState(loadDevMode());
    const activeContract = loadActiveContract();
    contractRef.current = activeContract;
    setContract(activeContract);
    refreshWallet();
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
                bodyId: s.currentBodyId,
              });
            }
          },
          onPreview: (info) => setPreview(info),
          onModeChange: (m) => setMode(m),
          onThrustStart: () => { hapticThrust(); soundIgnite(); },
          onStageSeparation: () => { hapticStage(); soundStage(); },
          onLanderDeploy: () => { hapticDeploy(); soundStage(); },
          onStationDeploy: (bodyId, onSurface) => {
            hapticDeploy(); soundStage();
            if (onSurface) surfaceDeployRef.current = bodyId;
            const id = onSurface ? baseGoalId(bodyId) : stationGoalId(bodyId);
            if (id) awardGoalById(id);
          },
          onTouchdown: (outcome) => {
            soundTouchdown(outcome === 'landed');
            outcome === 'landed' ? hapticLanding() : hapticCrash();
          },
          onMilestoneComplete: (id) => {
            const m = MILESTONES.find((x) => x.id === id);
            if (!m) return;
            addCompletedMilestone(id);
            addMoney(m.cash);
            refreshWallet();
            pushToast(`★ ${m.name}`, `+${fmtMoney(m.cash)} · ${m.description}`);
            const next = game.getNextMilestone();
            setNextTarget(next ? next.description : 'All milestones complete!');
          },
          onMissionEnd: (r) => {
            setMissionResult(r);
            awardGoals(r);
            settleContract(r);
          },
        },
      });

      gameRef.current = game;
      setHasParachute(game.hasParachute);
      setHasStation(game.hasStation);
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

  /** Grant a single campaign goal (cash + reputation + base + toast), if new. */
  const awardGoalById = useCallback((id: string) => {
    if (loadGoals().includes(id)) return;
    addGoal(id);
    const g = campaignGoal(id);
    if (!g) return;
    if (g.baseUnlock) { addBase(g.baseUnlock); setBases(loadBases()); }
    addMoney(g.cash);
    addReputation(g.reputation);
    refreshWallet();
    const subtitle = g.baseUnlock
      ? `+${fmtMoney(g.cash)} · New launch site: ${bodyDef(g.baseUnlock).name}!`
      : `+${fmtMoney(g.cash)} · +${g.reputation} reputation`;
    pushToast(`🏆 ${g.name}`, subtitle);
  }, [pushToast, refreshWallet]);

  /** Award landing/base campaign goals at mission end. */
  const awardGoals = useCallback((result: MissionResult) => {
    const build = buildRef.current;
    const p = planRef.current;
    if (!build || !p) return;
    const newly = evaluateGoals({ result, build, launchBodyId: p.launchBodyId }, loadGoals());
    newly.forEach(awardGoalById);
  }, [awardGoalById]);

  /** Settle the accepted contract against the flight's MissionResult. */
  const settleContract = useCallback((result: MissionResult) => {
    const c = contractRef.current;
    if (!c) {
      setPayout(null);
      settlementRef.current = { skipped: 'no-active-contract' };
      return;
    }
    if (loadCompletedContracts().includes(c.id)) {
      settlementRef.current = { skipped: 'already-completed', contractId: c.id };
      return;
    }
    const build = buildRef.current;
    const ctx = {
      surfaceDeployBodyId: surfaceDeployRef.current,
      hasCapsule: build ? getPart(build.noseId)?.type === 'capsule' : false,
      hasSatelliteBus: build?.noseId === 'satellite-bus',
      hasPayloadFairing: build?.noseId === 'nose-fairing',
    };
    const ev = evaluateContract(c, result, ctx);
    settlementRef.current = { contractId: c.id, contract: c, context: ctx, completed: ev.completed, payout: ev.payout };
    if (ev.completed) {
      addMoney(ev.payout);
      addReputation(c.reputation);
      addCompletedContract(c.id);
      saveActiveContract(null);
      contractRef.current = null;
      setContract(null);
      refreshWallet();
      setPayout({ title: c.title, amount: ev.payout, line: ev.line });
      const contractToast = c.payloadType === 'satellite' ? '🛰 Satellite deployed!' : '💰 Contract complete';
      pushToast(contractToast, `${c.title} · +${fmtMoney(ev.payout)}`);
    } else {
      setPayout({ title: c.title, amount: 0, line: CONTRACT_FAILED_LINE });
    }
  }, [pushToast, refreshWallet]);

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
    setPayout(null);
    surfaceDeployRef.current = null;
    settlementRef.current = null;
    setTimeScale(1);
    // Called from a click, so this satisfies the browser's autoplay gesture rule.
    startFlightAudio();
    gameRef.current?.play();
  }, []);

  const handleEdit = useCallback(() => {
    setMissionResult(null);
    setPayout(null);
    surfaceDeployRef.current = null;
    settlementRef.current = null;
    setTimeScale(1);
    stopFlightAudio();
    gameRef.current?.edit();
  }, []);

  const handleReplay = useCallback(() => {
    setMissionResult(null);
    setPayout(null);
    surfaceDeployRef.current = null;
    settlementRef.current = null;
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

  const handleFinish = useCallback(() => {
    setTimeScale(1);
    gameRef.current?.finishMission();
  }, []);

  const handleStage = useCallback(() => gameRef.current?.manualStage(), []);
  const handleLander = useCallback(() => gameRef.current?.manualLander(), []);
  const handleLand = useCallback(() => gameRef.current?.manualLand(), []);
  const handleDeployStation = useCallback(() => gameRef.current?.manualDeployStation(), []);

  const handleCopyLog = useCallback(() => {
    // The full flight log — build, plan, system, final state, result, and the
    // event timeline — assembled by the Game so a failing run can be shared and
    // reproduced from a single paste. The career layer (contract, settlement,
    // wallet) lives in this component, so it's merged in here.
    const log = gameRef.current?.buildDebugLog();
    if (!log) return;
    const reputation = loadReputation();
    const career = {
      activeContract: contractRef.current,
      settlement: settlementRef.current,
      surfaceDeployBodyId: surfaceDeployRef.current,
      money: loadMoney(),
      reputation,
      rank: rankForReputation(reputation),
      completedContractIds: loadCompletedContracts(),
    };
    navigator.clipboard.writeText(JSON.stringify({ ...log, career }, null, 2));
    setLogCopied(true);
    setTimeout(() => setLogCopied(false), 2000);
  }, []);

  const handleRelaunch = useCallback(() => gameRef.current?.manualRelaunch(), []);

  const handleLaunchSite = useCallback((id: string) => {
    const cur = planRef.current;
    if (!cur || cur.launchBodyId === id) return;
    const mission = cur.mission ?? { kind: 'orbit' as const, orbitKm: defaultOrbitKm(id) };
    handlePlanChange(autoPlan(id, cur.destinationId, mission));
  }, [handlePlanChange]);

  const phase = flightState?.phase ?? 'prelaunch';
  // The flight is over only once the summary is shown — a soft landing no
  // longer ends it; the player keeps control (deploy a base, finish manually).
  const finished = !!missionResult;
  const landed = phase === 'landed';
  // The Finish button ends the flight and shows the score at any point in sim.
  const canFinish = mode === 'sim' && !finished && phase !== 'prelaunch';
  const canStage = flightState?.canStage ?? false;
  const landerDeployed = flightState?.landerDeployed ?? false;
  // Offer the de-orbit/land button once the craft is actually in a stable orbit.
  const canLand = mode === 'sim' && !finished && phase === 'orbit';
  const stationDeployed = flightState?.stationDeployed ?? false;
  // Deploy a station (in orbit) or a base (on the surface) when a module is aboard.
  const canDeployStation = mode === 'sim' && !finished && hasStation &&
    !stationDeployed && (flightState?.canDeployStation ?? false);
  const canRelaunch = mode === 'sim' && !finished && (flightState?.canRelaunch ?? false);

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
            objective={contract
              ? `${missionObjective(plan)} · 📋 ${contract.title} (${fmtMoney(contract.reward)})`
              : missionObjective(plan)}
          />
          <StageStack state={flightState} />
        </>
      )}

      <NavDrawer title="Flight Menu" />
      <SoundToggle />

      {/* Wallet + rank — the career at a glance while planning. */}
      {mode === 'plan' && (
        <Link
          href="/career"
          className="absolute z-30 top-[calc(3.9rem+env(safe-area-inset-top))]
                     right-[calc(0.75rem+env(safe-area-inset-right))]
                     panel flex flex-col items-end gap-0.5 px-2.5 py-1.5 hover:border-cyan/45"
        >
          <span className="text-[11px] font-black tabular-nums text-green leading-none">
            {fmtMoney(money)}
          </span>
          <span className="text-[10px] font-bold text-yellow/90 leading-none">★ {rankTitle}</span>
        </Link>
      )}

      {/* Launch-site selector — a dropdown so it scales on mobile as more bases
          (every landable world) become available. */}
      {mode === 'plan' && plan && bases.length > 1 && (
        <div className="absolute z-30 top-[calc(0.75rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2
                        panel p-1 w-[min(72vw,16rem)]">
          <Dropdown
            label="LAUNCH FROM"
            value={plan.launchBodyId}
            options={bases.map((id) => ({ id, name: bodyDef(id).name }))}
            onChange={handleLaunchSite}
          />
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
          contract={contract}
          hasStation={hasStation}
          hasCapsule={hasCapsule}
          hasSatelliteBus={hasSatelliteBus}
          hasPayloadFairing={hasPayloadFairing}
          onChange={handlePlanChange}
          onPlay={handlePlay}
        />
      )}

      {/* Sim mode: controls */}
      {mode === 'sim' && (
        <SimControls
          finished={finished}
          phase={phase}
          landed={landed}
          timeScale={timeScale}
          canFinish={canFinish}
          canStage={canStage}
          hasLander={hasLander}
          hasParachute={hasParachute}
          landerDeployed={landerDeployed}
          canLand={canLand}
          canDeployStation={canDeployStation}
          stationDeployed={stationDeployed}
          parachuteDeployed={flightState?.parachuteDeployed ?? false}
          onEdit={handleEdit}
          onReplay={handleReplay}
          onWarp={handleWarp}
          onWarpUp={handleWarpUp}
          onWarpDown={handleWarpDown}
          onFinish={handleFinish}
          onStage={handleStage}
          onLander={handleLander}
          onLand={handleLand}
          onDeployStation={handleDeployStation}
          canRelaunch={canRelaunch}
          onRelaunch={handleRelaunch}
        />
      )}

      {missionResult && (
        <MissionSummary
          result={missionResult}
          payout={payout}
          onRestart={handleReplay}
          onCopyLog={devMode ? handleCopyLog : undefined}
          logCopied={logCopied}
        />
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
