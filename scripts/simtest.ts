/* Deterministic Simulator + auto-planner regression tests.
 * Run: npm run test:sim
 */
import { Simulator, SimPhase } from '../lib/game/plan/Simulator';
import { autoPlan } from '../lib/game/plan/AutoPlan';
import { MissionKind } from '../lib/game/plan/FlightPlan';
import { ROCKET_PRESETS, ROUTE_PROVER_BUILD } from '../lib/game/career/Presets';
import { buildFlightSimSetup } from '../lib/game/SimSetup';
import { RocketBuild, DEFAULT_BUILD } from '../lib/game/types';
import { PARTS_CATALOG } from '../lib/game/career/Parts';
import { MILESTONES } from '../lib/game/career/Milestones';
import { buildPartIds } from '../lib/game/BuildSpec';

const DT = 1 / 60;
const MAX_STEPS = 4_000_000;

type RunResult = {
  label: string;
  launchId: string;
  finished: boolean;
  everOrbit: boolean;
  phase: SimPhase;
  bodyId: string;
  landedBodyId: string | null;
  touchdowns: number;
  maxAlt: number;
  reached: string[];
  /** Sim seconds spent in 'orbit' phase, keyed by the body being orbited. */
  orbitSecsByBody: Record<string, number>;
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
  const orbitSecsByBody: Record<string, number> = {};
  for (; steps < maxSteps; steps++) {
    sim.step(DT);
    const s = sim.state;
    everOrbit = everOrbit || s.everOrbit;
    maxAlt = Math.max(maxAlt, sim.altitude());
    // Credit orbit time to the body actually being orbited. This is what
    // distinguishes a real lunar orbit from just grazing the Moon on a fly-by
    // that falls back to Earth (the bug this suite must catch). We test the
    // orbit body-relative — bound (finite apoapsis), periapsis clear of the
    // surface, comfortably above the surface — rather than via `phase==='orbit'`,
    // whose 50 km floor is Earth-scaled and never trips for a low Moon orbit.
    const b = sim.body();
    if (Number.isFinite(s.apoapsis) && s.periapsis > 0.5 && sim.altitude() > Math.max(2, b.radius * 0.1)) {
      orbitSecsByBody[b.id] = (orbitSecsByBody[b.id] ?? 0) + DT;
    }
    const landedNow = s.phase === 'landed';
    if (landedNow && !prevLanded) touchdowns++;
    prevLanded = landedNow;
    if (sim.finished) break;
  }

  const s = sim.state;
  const result: RunResult = {
    label,
    launchId,
    finished: sim.finished,
    everOrbit,
    phase: s.phase,
    bodyId: sim.body().id,
    landedBodyId: s.landedBodyId,
    touchdowns,
    maxAlt,
    reached: Array.from(s.reachedBodyIds),
    orbitSecsByBody,
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

/** Minimum sustained orbit time (sim seconds) that counts as "actually orbited"
 *  the body — comfortably more than one low orbital period, so a brief graze on
 *  a fly-by that escapes back home does not qualify. */
const MIN_ORBIT_SECS = 1000;

function assertOrbit(result: RunResult, bodyId: string) {
  // Orbit missions don't auto-finish — the sim runs until the step limit or
  // perturbations cause a natural reentry. We verify the craft actually held an
  // orbit AROUND THE CORRECT BODY for a meaningful span — not merely that it was
  // ever in some orbit (the Earth parking orbit counts for that) or that it
  // grazed the target on a fly-by. The Moon-orbit bug passed the old, weaker
  // check because the craft reached a brief lunar orbit and then fell back to
  // Earth; these assertions fail on exactly that behaviour.
  expect(result.label, result.everOrbit, 'expected everOrbit=true');
  expectReached(result, bodyId);
  const orbitSecs = result.orbitSecsByBody[bodyId] ?? 0;
  expect(result.label, orbitSecs >= MIN_ORBIT_SECS,
    `expected a sustained orbit around ${bodyId} (>= ${MIN_ORBIT_SECS}s), got ${orbitSecs.toFixed(0)}s`);
  // A non-return orbit mission must not end up crashed back onto the launch
  // world — the signature of the "shoots into space / falls home" regression.
  if (bodyId !== result.launchId) {
    expect(result.label, result.landedBodyId !== result.launchId,
      `expected craft to stay at ${bodyId}, but it ended up back on ${result.launchId}`);
  }
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

// ── Transfer-ascent robustness across builds ─────────────────────────────────
// The lunar transfer used to fly an open-loop apoapsis burn that, off the
// overpowered route-prover, either escaped Earth entirely (a strong build —
// "shot into space") or stalled suborbital (a weak one), so the craft never
// reached the Moon. These fly the player-facing presets to the Moon and require
// a real, sustained lunar orbit — the closed-loop circularization ascent now
// gets every capable build there.
const orbiterBuild = ROCKET_PRESETS.find((p) => p.id === 'orbiter')!.build;
const orbiterMoonOrbit = run('Orbiter Moon orbit', 'earth', 'moon', 'orbit', 60, orbiterBuild);
assertOrbit(orbiterMoonOrbit, 'moon');
expect(orbiterMoonOrbit.label, orbiterMoonOrbit.maxAlt <= 5000,
  `expected the ascent not to escape Earth, got maxAlt=${orbiterMoonOrbit.maxAlt.toFixed(0)}km`);

const interBuild = ROCKET_PRESETS.find((p) => p.id === 'interplanetary')!.build;
assertOrbit(run('Interplanetary Moon orbit', 'earth', 'moon', 'orbit', 60, interBuild), 'moon');
assertLanding(run('Interplanetary Moon land', 'earth', 'moon', 'land', undefined, interBuild), 'moon');

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

// ── Solar-system destinations ────────────────────────────────────────────────
// Every planet/moon must be reachable and hold a real orbit (gas giants are
// orbit-only — no surface). Landing is covered for the solid inner worlds the
// route-prover can set down on.
for (const dest of ['mercury', 'venus', 'mars', 'jupiter', 'saturn']) {
  assertOrbit(run(`${dest} orbit`, 'earth', dest, 'orbit'), dest);
}
assertLanding(run('Venus land', 'earth', 'venus', 'land'), 'venus');

// ── Preset rockets ───────────────────────────────────────────────────────────
// Every preset must be buildable through career progress: each part it uses is
// either unlocked by default or granted by some milestone. (Regression guard:
// engine-heavy / booster-liquid / capsule-crew were previously orphaned, which
// silently locked every advanced preset.)
const unlockable = new Set<string>(PARTS_CATALOG.filter((p) => p.unlockedByDefault).map((p) => p.id));
for (const m of MILESTONES) for (const id of m.unlocks) unlockable.add(id);
for (const preset of ROCKET_PRESETS) {
  for (const id of buildPartIds(preset.build)) {
    expect(`preset ${preset.id}`, unlockable.has(id), `part '${id}' is not unlocked by default or any milestone`);
  }
}

// The new mission-themed presets must actually fly their headline route.
const presetBuild = (id: string) => ROCKET_PRESETS.find((p) => p.id === id)!.build;
assertStableOrbit(run('Heavy Orbiter Earth orbit', 'earth', 'orbit', 'orbit', 300, presetBuild('heavy-orbiter'), ORBIT_STEPS), 'earth', ORBIT_ALT_CAP);
assertLanding(run('Lunar Express Moon return', 'earth', 'moon', 'orbit-return', undefined, presetBuild('lunar-express')), 'earth');
assertLanding(run('Mars Pioneer Mars land', 'earth', 'mars', 'land', undefined, presetBuild('mars-pioneer')), 'mars');
assertOrbit(run('Grand Voyager Saturn orbit', 'earth', 'saturn', 'orbit', undefined, presetBuild('grand-voyager')), 'saturn');

console.log('All simulation regression tests passed.');
