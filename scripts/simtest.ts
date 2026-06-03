/* Deterministic Simulator + auto-planner regression tests.
 * Run: npm run test:sim
 */
import { Simulator, SimPhase } from '../lib/game/plan/Simulator';
import { autoPlan } from '../lib/game/plan/AutoPlan';
import { MissionKind } from '../lib/game/plan/FlightPlan';
import { ROCKET_PRESETS, ROUTE_PROVER_BUILD } from '../lib/game/career/Presets';
import { buildFlightSimSetup } from '../lib/game/SimSetup';
import { RocketBuild, DEFAULT_BUILD } from '../lib/game/types';

const DT = 1 / 60;
const MAX_STEPS = 4_000_000;

type RunResult = {
  label: string;
  finished: boolean;
  everOrbit: boolean;
  phase: SimPhase;
  bodyId: string;
  landedBodyId: string | null;
  touchdowns: number;
  maxAlt: number;
  reached: string[];
  plannedOrbitKm: number | undefined;
  steps: number;
};

const ROUTE_PROVER = ROUTE_PROVER_BUILD;

function expect(label: string, condition: boolean, details: string) {
  if (!condition) throw new Error(`${label}: ${details}`);
}

function expectReached(result: RunResult, bodyId: string) {
  expect(result.label, result.reached.includes(bodyId), `expected reached=[${result.reached.join(',')}] to include ${bodyId}`);
}

function run(
  label: string,
  launchId: string,
  destId: string,
  kind: MissionKind,
  orbitKm?: number,
  build: RocketBuild = ROUTE_PROVER,
  maxSteps: number = MAX_STEPS,
): RunResult {
  const plan = autoPlan(launchId, destId, { kind, orbitKm });
  const setup = buildFlightSimSetup(build, plan);
  const sim = new Simulator(setup.config, plan);
  sim.reset();

  let steps = 0;
  let everOrbit = false;
  let touchdowns = 0;
  let prevLanded = false;
  let maxAlt = 0;
  for (; steps < maxSteps; steps++) {
    sim.step(DT);
    const s = sim.state;
    everOrbit = everOrbit || s.everOrbit;
    maxAlt = Math.max(maxAlt, sim.altitude());
    const landedNow = s.phase === 'landed';
    if (landedNow && !prevLanded) touchdowns++;
    prevLanded = landedNow;
    if (sim.finished) break;
  }

  const s = sim.state;
  const result: RunResult = {
    label,
    finished: sim.finished,
    everOrbit,
    phase: s.phase,
    bodyId: sim.body().id,
    landedBodyId: s.landedBodyId,
    touchdowns,
    maxAlt,
    reached: Array.from(s.reachedBodyIds),
    plannedOrbitKm: plan.mission?.orbitKm,
    steps,
  };

  const simSecs = (steps * DT).toFixed(0);
  console.log(
    `${label.padEnd(28)} | finished=${result.finished ? 'Y' : 'N'} phase=${result.phase.padEnd(9)} ` +
    `body=${result.bodyId.padEnd(5)} orbit=${result.everOrbit ? 'Y' : 'N'} ` +
    `maxAlt=${result.maxAlt.toFixed(0)}km touchdowns=${result.touchdowns} ` +
    `landed=${result.landedBodyId ?? '-'} reached=[${result.reached.join(',')}] simT=${simSecs}s`,
  );
  return result;
}

function assertFinished(result: RunResult) {
  expect(result.label, result.finished, `expected mission to finish within ${MAX_STEPS} steps`);
}

function assertOrbit(result: RunResult, bodyId: string) {
  // Orbit missions don't auto-finish — the sim runs until the step limit or
  // perturbations cause a natural reentry. We verify the craft reached a
  // stable orbit around the correct body at some point during the run.
  expect(result.label, result.everOrbit, 'expected everOrbit=true');
  expectReached(result, bodyId);
}

/**
 * A direct orbit mission must settle into a stable orbit around the launch
 * world WITHOUT "shooting into space" — i.e. the craft must never run away on
 * an escape trajectory. A regression here is exactly the bug where a capable
 * engine over-burned the ascent circularization and flew off past escape
 * velocity. The altitude cap is far above any legitimate parking orbit but far
 * below the tens of thousands of km an escaping craft reaches.
 */
function assertStableOrbit(result: RunResult, bodyId: string, maxAltKm: number) {
  assertOrbit(result, bodyId);
  expect(result.label, result.phase !== 'destroyed', `expected craft not destroyed, got ${result.phase}`);
  expect(result.label, result.maxAlt <= maxAltKm,
    `expected stable orbit (maxAlt <= ${maxAltKm}km, did not escape), got ${result.maxAlt.toFixed(0)}km`);
}

function assertLanding(result: RunResult, bodyId: string) {
  assertFinished(result);
  expect(result.label, result.phase === 'landed', `expected phase=landed, got ${result.phase}`);
  expect(result.label, result.landedBodyId === bodyId, `expected landedBody=${bodyId}, got ${result.landedBodyId ?? '-'}`);
  expect(result.label, result.touchdowns >= 1, 'expected at least one touchdown');
  expectReached(result, bodyId);
}

console.log('-- Auto-plan simulation regressions --');

const ORBIT_STEPS = 200_000;

const lowEarth = run('Earth orbit requested 60', 'earth', 'orbit', 'orbit', 60, ROUTE_PROVER, ORBIT_STEPS);
assertOrbit(lowEarth, 'earth');
expect(lowEarth.label, (lowEarth.plannedOrbitKm ?? 0) >= 100, `expected low Earth orbit to clamp >= 100km, got ${lowEarth.plannedOrbitKm}`);

assertOrbit(run('Earth orbit @300', 'earth', 'orbit', 'orbit', 300, ROUTE_PROVER, ORBIT_STEPS), 'earth');

// ── Normal-build direct orbits (regression: must not "shoot into space") ─────
// These mirror what a player actually flies — the starter rocket and the
// orbiter preset — across a range of requested altitudes. Before the fix, a
// capable engine over-burned the circularization and escaped Earth entirely
// while `npm test` (which only flew the overpowered ROUTE_PROVER build) stayed
// green. The 2000km cap is comfortably above any real parking orbit and far
// below the >18,000km an escaping craft climbs to.
const ORBIT_ALT_CAP = 2000;
const ORBITER_BUILD = ROCKET_PRESETS.find((p) => p.id === 'orbiter')?.build ?? ROUTE_PROVER;
for (const orbitKm of [200, 300, 400]) {
  assertStableOrbit(
    run(`Orbiter Earth orbit @${orbitKm}`, 'earth', 'orbit', 'orbit', orbitKm, ORBITER_BUILD, ORBIT_STEPS),
    'earth', ORBIT_ALT_CAP,
  );
}
assertStableOrbit(
  run('Starter Earth orbit @300', 'earth', 'orbit', 'orbit', 300, DEFAULT_BUILD, ORBIT_STEPS),
  'earth', ORBIT_ALT_CAP,
);
assertStableOrbit(
  run('Moon Lander Earth orbit @400', 'earth', 'orbit', 'orbit', 400, ROCKET_PRESETS.find((p) => p.id === 'moon-lander')!.build, ORBIT_STEPS),
  'earth', ORBIT_ALT_CAP,
);

const moonOrbit = run('Moon orbit', 'earth', 'moon', 'orbit', 60);
assertOrbit(moonOrbit, 'moon');
expectReached(moonOrbit, 'earth');

const moonOrbitReturn = run('Moon orbit & return', 'earth', 'moon', 'orbit-return', 60);
assertLanding(moonOrbitReturn, 'earth');
expectReached(moonOrbitReturn, 'moon');

const moonLand = run('Moon land', 'earth', 'moon', 'land');
assertLanding(moonLand, 'moon');
expectReached(moonLand, 'earth');

const moonLanderPreset = ROCKET_PRESETS.find((p) => p.id === 'moon-lander');
expect('Moon Lander preset exists', !!moonLanderPreset, 'expected moon-lander preset to exist');
const moonPresetLand = run('Moon Lander preset land', 'earth', 'moon', 'land', undefined, moonLanderPreset!.build);
assertLanding(moonPresetLand, 'moon');
expectReached(moonPresetLand, 'earth');

const moonLandReturn = run('Moon land & return', 'earth', 'moon', 'land-return');
assertLanding(moonLandReturn, 'earth');
expectReached(moonLandReturn, 'moon');

const marsLand = run('Mars land', 'earth', 'mars', 'land');
assertLanding(marsLand, 'mars');
expectReached(marsLand, 'earth');

console.log('All simulation regression tests passed.');
