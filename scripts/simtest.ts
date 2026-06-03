/* Headless sanity checks for the deterministic Simulator + auto-planner.
 * Run: npx tsx scripts/simtest.ts
 */
import { Simulator } from '../lib/game/plan/Simulator';
import { autoPlan } from '../lib/game/plan/AutoPlan';
import { buildSimStages } from '../lib/game/BuildSpec';
import { buildFlightBodies, getDestination, bodyDef } from '../lib/game/bodies';
import { RocketBuild } from '../lib/game/types';
import * as THREE from 'three';

const DT = 1 / 60;
const MAX_STEPS = 4_000_000;

// A beefy 3-stage rocket with a heavy lander and parachute — enough delta-v to
// exercise transfer + capture/descent + return without fuel being the blocker.
const BIG: RocketBuild = {
  engineId: 'engine-heavy',
  tankIds: ['tank-xl', 'tank-xl'],
  noseId: 'capsule-crew',
  utilityIds: ['parachute', 'landing-legs'],
  boosterIds: ['booster-liquid', 'booster-liquid'],
  landerId: 'lander-heavy',
  stages: [
    { engineId: 'engine-heavy', tankIds: ['tank-xl', 'tank-xl', 'tank-xl'] },
    { engineId: 'engine-heavy', tankIds: ['tank-xl', 'tank-xl'] },
    { engineId: 'engine-vacuum', tankIds: ['tank-large', 'tank-large'] },
  ],
};

function run(label: string, launchId: string, destId: string, kind: any, orbitKm?: number) {
  const plan = autoPlan(launchId, destId, { kind, orbitKm });
  const dest = getDestination(destId);
  const bodies = buildFlightBodies(launchId, dest.targetId);
  const lb = bodyDef(launchId);
  const start = bodies[0].center.clone().add(new THREE.Vector3(0, bodies[0].radius + 0.001, 0));
  const sim = new Simulator(
    { ...buildSimStages(BIG), bodies, startPosition: start },
    plan,
  );
  sim.reset();

  let steps = 0;
  let everOrbit = false;
  let touchdowns = 0;
  let prevLanded = false;
  let maxAlt = 0;
  for (; steps < MAX_STEPS; steps++) {
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
  const reached = Array.from(s.reachedBodyIds).join(',');
  const finished = sim.finished;
  const simSecs = (steps * DT).toFixed(0);
  console.log(
    `${label.padEnd(26)} | finished=${finished ? 'Y' : 'N'} phase=${s.phase.padEnd(9)} ` +
    `orbit=${everOrbit ? 'Y' : 'N'} maxAlt=${maxAlt.toFixed(0)}km touchdowns=${touchdowns} ` +
    `reached=[${reached}] simT=${simSecs}s steps=${steps}`,
  );
  return { finished, everOrbit, phase: s.phase, touchdowns, maxAlt, reached };
}

console.log('— Auto-plan simulation sanity —');
run('Earth orbit @120',   'earth', 'orbit', 'orbit', 120);
run('Earth orbit @300',   'earth', 'orbit', 'orbit', 300);
run('Moon orbit',         'earth', 'moon',  'orbit', 60);
run('Moon orbit & return','earth', 'moon',  'orbit-return', 60);
run('Moon land',          'earth', 'moon',  'land');
run('Moon land & return', 'earth', 'moon',  'land-return');
run('Mars land',          'earth', 'mars',  'land');
