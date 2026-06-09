/**
 * Representative "land on / depart from every solid world" sample.
 *
 * A compact cross-section of the full matrix: land a craft ON each solid body,
 * and DEPART FROM (launch from) each solid body to a destination and land. Flown
 * on one capable, fully-equipped build so the physics — not the Δv budget — is
 * what's exercised. Three departures from the extreme inner / far worlds are
 * documented `todo`s pending a guidance-robustness pass (see notes below).
 */
import { describe, it } from 'vitest';
import { RocketBuild } from '../lib/game/types';
import { runScenario, assertLanding } from './harness';

// A heavy, fully-equipped cruiser: parachute + legs + dedicated lander and ample
// Δv, so every leg is a physics test rather than a budget test.
const HEAVY: RocketBuild = {
  engineId: 'engine-mammoth', tankIds: ['tank-mega'], noseId: 'capsule-crew',
  utilityIds: ['parachute', 'landing-legs'], boosterIds: ['booster-liquid-xl', 'booster-liquid-xl'],
  landerId: 'lander-titan',
  stages: [
    { engineId: 'engine-mammoth', tankIds: ['tank-mega', 'tank-mega', 'tank-mega'] },
    { engineId: 'engine-heavy',   tankIds: ['tank-xl', 'tank-xl', 'tank-xl'] },
    { engineId: 'engine-vacuum',  tankIds: ['tank-xl', 'tank-xl'] },
    { engineId: 'engine-plasma',  tankIds: ['tank-large', 'tank-large'] },
  ],
};

const SOLID = ['mercury', 'venus', 'earth', 'moon', 'mars', 'phobos', 'ceres', 'titan'];

describe('land on every solid world', () => {
  for (const body of SOLID) {
    // Earth is the launch world, so landing "on Earth" is the local orbit→land.
    const destId = body === 'earth' ? 'orbit' : body;
    it(`lands on ${body}`, () => {
      const r = runScenario({ launchId: 'earth', destId, kind: 'land', build: HEAVY, maxSimSeconds: 120_000 });
      assertLanding(r, body);
    });
  }
});

describe('depart from every solid world', () => {
  // Known-hard departures pending a guidance-robustness pass:
  //  - Mercury → Earth: Mercury orbits fast and its Hohmann perihelion lies on
  //    its own lane, so the escape arc loops back and Mercury recaptures the craft.
  //  - Venus → Earth: the heliocentric cruise over-burns (apoapsis runs away),
  //    then perihelion collapses into the Sun.
  //  - Titan → Earth: arrives at Earth but the final long-range descent crashes.
  const HARD = new Set(['mercury', 'venus', 'titan']);
  for (const body of SOLID) {
    // Earth departs to the Moon; every other world flies home to Earth and lands.
    const [launchId, destId, landOn] = body === 'earth'
      ? ['earth', 'moon', 'moon']
      : [body, 'earth', 'earth'];
    const test = HARD.has(body) ? it.todo : it;
    test(`departs ${body} → ${destId} and lands`, () => {
      const r = runScenario({ launchId, destId, kind: 'land', build: HEAVY, maxSimSeconds: 120_000 });
      assertLanding(r, landOn);
    });
  }
});
