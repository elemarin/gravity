/**
 * Shared scenario harness for the flight regression suite.
 *
 * Every test drives the *real* game pipeline — the auto-planner, the build →
 * sim-stage flattening, and the deterministic Simulator at the live flight
 * timestep — so a passing test means the actual game mechanic works, not a
 * simplified stand-in. The harness adds rich per-run metrics and early
 * termination so the large origin×destination matrix stays runnable.
 */
import { Simulator, SimPhase } from '../lib/game/plan/Simulator';
import { autoPlan } from '../lib/game/plan/AutoPlan';
import { MissionKind } from '../lib/game/plan/FlightPlan';
import { buildFlightSimSetup } from '../lib/game/SimSetup';
import { RocketBuild } from '../lib/game/types';
import {
  SYSTEM_BODY_IDS, bodyDef, isLandable, destinationTargetId,
} from '../lib/game/bodies';
import { estimateBuildDeltaV } from '../lib/game/BuildSpec';
import { requiredDeltaV } from '../lib/game/career/Requirements';
import { ROCKET_PRESETS } from '../lib/game/career/Presets';

/** Live flight timestep — the canonical, deterministic game step. */
export const DT = 1 / 60;

/**
 * Minimum sustained orbit time (sim seconds) that counts as "actually orbited"
 * the body — comfortably more than one low orbital period, so a brief graze on
 * a fly-by that escapes again does not qualify.
 */
export const MIN_ORBIT_SECS = 1000;

// ── Body taxonomy ────────────────────────────────────────────────────────────

/** Every body the system simulates (Sun first), excluding the Sun itself. */
export const PLANET_AND_MOON_IDS = SYSTEM_BODY_IDS.filter((id) => id !== 'sun');

/** Worlds a craft can launch from / land on — solid surfaces only. */
export const SOLID_BODY_IDS = PLANET_AND_MOON_IDS.filter((id) => isLandable(id));

/** The destination ids reachable from a launch body (every other body). */
export function destinationsFrom(launchId: string): string[] {
  // 'orbit' means "orbit the launch world itself"; every other body is a transfer.
  return ['orbit', ...PLANET_AND_MOON_IDS.filter((id) => id !== launchId)];
}

/** The mission kinds valid for a destination, mirroring the plan-panel rules. */
export function kindsFor(launchId: string, destId: string): MissionKind[] {
  const targetId = destinationTargetId(destId, launchId);
  const landTarget = targetId ?? launchId;
  const canLand = isLandable(landTarget);
  if (targetId) {
    return canLand
      ? ['orbit', 'orbit-return', 'land', 'land-return']
      : ['orbit', 'orbit-return'];
  }
  // Orbiting the launch world itself: orbit, or land back on it.
  return canLand ? ['orbit', 'land'] : ['orbit'];
}

// ── Build selection ──────────────────────────────────────────────────────────

const PRESET_BUILDS: { id: string; build: RocketBuild; dv: number }[] = ROCKET_PRESETS
  .map((p) => ({ id: p.id, build: p.build, dv: estimateBuildDeltaV(p.build) }))
  .sort((a, b) => a.dv - b.dv);

const MOST_CAPABLE = PRESET_BUILDS.reduce((a, b) => (b.dv > a.dv ? b : a));

/** Any mission that ends on a surface needs landing hardware to touch down. */
function missionLands(kind: MissionKind): boolean {
  return kind === 'land' || kind === 'land-return' || kind === 'orbit-return';
}

/** True when a build carries gear that lets it survive a touchdown. */
function canLand(build: RocketBuild): boolean {
  const utils = build.utilityIds ?? [];
  return !!build.landerId || utils.includes('landing-legs') || utils.includes('parachute');
}

/**
 * The rocket to fly a scenario with. The matrix tests the FLIGHT MECHANIC —
 * does a transfer reach and capture, does a landing set down, does a return come
 * home — not whether the leanest budget-clearing rocket can do it (that is the
 * career Δv gate, covered separately in career.test). So we fly the most capable
 * build in the catalogue: it carries a lander, legs and a chute, and the most
 * Δv, so a cell that still fails is a genuine guidance/physics bug rather than a
 * fuel-starved budget edge case.
 *
 * `feasible: false` means even this rocket lacks the Δv the career gate demands —
 * the scenario is content-infeasible (no rocket can be built for it), not a
 * physics failure, so the matrix skips it.
 */
export function pickBuild(
  _launchId: string, _destId: string, _kind: MissionKind,
): { build: RocketBuild; id: string; feasible: boolean } {
  const need = requiredDeltaV(_launchId, _destId, _kind);
  const lands = missionLands(_kind);
  // The most capable build carries landing gear, so the gear requirement is
  // always satisfied; this guard documents the intent.
  const ok = MOST_CAPABLE.dv >= need && (!lands || canLand(MOST_CAPABLE.build));
  return { build: MOST_CAPABLE.build, id: MOST_CAPABLE.id, feasible: ok };
}

// ── Scenario runner ──────────────────────────────────────────────────────────

export type Scenario = {
  launchId: string;
  destId: string;
  kind: MissionKind;
  orbitKm?: number;
  build?: RocketBuild;
  /** Override the per-run sim-second budget (failures run to this cap). */
  maxSimSeconds?: number;
};

export type RunResult = {
  label: string;
  launchId: string;
  destId: string;
  kind: MissionKind;
  targetId: string | null;
  buildId: string;
  finished: boolean;
  everOrbit: boolean;
  phase: SimPhase;
  bodyId: string;
  landedBodyId: string | null;
  touchdowns: number;
  maxAlt: number;
  reached: string[];
  /** Sim seconds spent in a real orbit, keyed by the body being orbited. */
  orbitSecsByBody: Record<string, number>;
  /** Sustained-orbit success was observed around this body (early-exit cause). */
  sustainedOrbitBody: string | null;
  plannedOrbitKm: number | undefined;
  steps: number;
  simSeconds: number;
};

/** A generous, bounded sim-second budget for a scenario (only hit on failure). */
function budgetSeconds(s: Scenario): number {
  if (s.maxSimSeconds) return s.maxSimSeconds;
  const targetId = destinationTargetId(s.destId, s.launchId);
  const isReturn = s.kind === 'orbit-return' || s.kind === 'land-return';
  let secs = 30_000;                 // ascent + local orbit margin
  if (targetId) secs += 70_000;      // one interplanetary/lunar cruise + capture
  if (isReturn) secs += 80_000;      // the trip home
  return secs;
}

export function label(s: Scenario): string {
  return `${bodyDef(s.launchId).name}→${s.destId} ${s.kind}`;
}

export function runScenario(s: Scenario): RunResult {
  const picked = s.build ? { build: s.build, id: 'custom' } : pickBuild(s.launchId, s.destId, s.kind);
  const plan = autoPlan(s.launchId, s.destId, { kind: s.kind, orbitKm: s.orbitKm });
  const setup = buildFlightSimSetup(picked.build, plan);
  const sim = new Simulator(setup.config, plan);
  sim.reset();

  const targetId = destinationTargetId(s.destId, s.launchId);
  const orbitBodyId = targetId ?? s.launchId;
  const maxSteps = Math.ceil(budgetSeconds(s) / DT);

  let steps = 0;
  let everOrbit = false;
  let touchdowns = 0;
  let prevLanded = false;
  let maxAlt = 0;
  let sustainedOrbitBody: string | null = null;
  const orbitSecsByBody: Record<string, number> = {};

  for (; steps < maxSteps; steps++) {
    sim.step(DT);
    const st = sim.state;
    everOrbit = everOrbit || st.everOrbit;
    maxAlt = Math.max(maxAlt, sim.altitude());

    // Credit orbit time to the body actually being orbited — a bound orbit
    // whose periapsis clears the surface and that sits comfortably above it.
    // Body-relative rather than via phase==='orbit' (whose Kármán floor is
    // Earth-scaled and never trips for a low orbit of a small world).
    const b = sim.body();
    if (Number.isFinite(st.apoapsis) && st.periapsis > 0.5 &&
        sim.altitude() > Math.max(2, b.radius * 0.1)) {
      orbitSecsByBody[b.id] = (orbitSecsByBody[b.id] ?? 0) + DT;
      if (b.id === orbitBodyId && orbitSecsByBody[b.id] >= MIN_ORBIT_SECS) {
        sustainedOrbitBody = b.id;
      }
    }

    const landedNow = st.phase === 'landed';
    if (landedNow && !prevLanded) touchdowns++;
    prevLanded = landedNow;

    // Mirror the player pressing "Return" once landed on the way out.
    if (landedNow && plan.nodes.some(
      (n) => n.trigger.type === 'on-manual-relaunch' && !st.firedNodeIds.has(n.id))) {
      sim.manualRelaunch();
    }

    // Early termination: a non-return orbit mission never auto-finishes, so
    // stop as soon as we've held a real orbit around the intended body.
    if ((s.kind === 'orbit') && !targetId && sustainedOrbitBody) break;
    if (s.kind === 'orbit' && sustainedOrbitBody && st.reachedBodyIds.has(orbitBodyId)) break;
    if (sim.finished) break;
  }

  const st = sim.state;
  return {
    label: label(s),
    launchId: s.launchId,
    destId: s.destId,
    kind: s.kind,
    targetId,
    buildId: picked.id,
    finished: sim.finished,
    everOrbit,
    phase: st.phase,
    bodyId: sim.body().id,
    landedBodyId: st.landedBodyId,
    touchdowns,
    maxAlt,
    reached: Array.from(st.reachedBodyIds),
    orbitSecsByBody,
    sustainedOrbitBody,
    plannedOrbitKm: plan.mission?.orbitKm,
    steps,
    simSeconds: steps * DT,
  };
}

// ── Assertions ───────────────────────────────────────────────────────────────

function fail(r: RunResult, detail: string): never {
  throw new Error(
    `${r.label} [${r.buildId}]: ${detail}\n` +
    `   finished=${r.finished} phase=${r.phase} body=${r.bodyId} ` +
    `landed=${r.landedBodyId ?? '-'} orbit=${r.everOrbit} ` +
    `reached=[${r.reached.join(',')}] maxAlt=${r.maxAlt.toFixed(0)}km ` +
    `orbitSecs=${JSON.stringify(
      Object.fromEntries(Object.entries(r.orbitSecsByBody).map(([k, v]) => [k, Math.round(v)])))} ` +
    `simT=${r.simSeconds.toFixed(0)}s`,
  );
}

export function assertReached(r: RunResult, bodyId: string) {
  if (!r.reached.includes(bodyId)) fail(r, `expected to reach ${bodyId}`);
}

/** Held a sustained, body-relative orbit around the given body. */
export function assertOrbit(r: RunResult, bodyId: string) {
  if (!r.everOrbit) fail(r, 'expected to reach orbit');
  assertReached(r, bodyId);
  const secs = r.orbitSecsByBody[bodyId] ?? 0;
  if (secs < MIN_ORBIT_SECS) {
    fail(r, `expected a sustained orbit around ${bodyId} (>= ${MIN_ORBIT_SECS}s), got ${secs.toFixed(0)}s`);
  }
  // A non-return orbit mission must not crash back onto the launch world.
  if (bodyId !== r.launchId && r.landedBodyId === r.launchId) {
    fail(r, `expected to stay at ${bodyId}, but fell back to ${r.launchId}`);
  }
}

/** Orbited the body AND never ran away on an escape trajectory. */
export function assertStableOrbit(r: RunResult, bodyId: string, maxAltKm: number) {
  assertOrbit(r, bodyId);
  if (r.phase === 'destroyed') fail(r, 'expected craft not destroyed');
  if (r.maxAlt > maxAltKm) fail(r, `expected a stable orbit (maxAlt <= ${maxAltKm}km), got ${r.maxAlt.toFixed(0)}km`);
}

/** Came to rest, intact, on the given body. */
export function assertLanding(r: RunResult, bodyId: string) {
  if (!r.finished) fail(r, 'expected the mission to finish');
  if (r.phase !== 'landed') fail(r, `expected phase=landed, got ${r.phase}`);
  if (r.landedBodyId !== bodyId) fail(r, `expected to land on ${bodyId}, got ${r.landedBodyId ?? '-'}`);
  if (r.touchdowns < 1) fail(r, 'expected at least one touchdown');
  assertReached(r, bodyId);
}
