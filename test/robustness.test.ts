/**
 * Ascent / circularization robustness across builds.
 *
 * The matrix flies the cheapest preset that clears each budget; these tests
 * instead pin specific builds — including the weak starter and an over-powered
 * stack — to the same direct-orbit and lunar-transfer routes, guarding the
 * "shoots into space" regression where a capable engine over-burns the
 * circularization and escapes instead of settling into a parking orbit.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_BUILD } from '../lib/game/types';
import { ROCKET_PRESETS } from '../lib/game/career/Presets';
import { runScenario, assertStableOrbit, assertOrbit } from './harness';

const presetBuild = (id: string) => ROCKET_PRESETS.find((p) => p.id === id)!.build;

// Far above any real parking orbit, far below the >18,000 km an escaping craft climbs to.
const ORBIT_ALT_CAP = 2000;

describe('direct Earth orbit does not escape', () => {
  for (const orbitKm of [200, 300, 400]) {
    it(`orbiter @${orbitKm}km settles into a stable orbit`, () => {
      const r = runScenario({ launchId: 'earth', destId: 'orbit', kind: 'orbit', orbitKm, build: presetBuild('orbiter') });
      assertStableOrbit(r, 'earth', ORBIT_ALT_CAP);
    });
  }

  it('the starter rocket settles into a stable orbit @300km', () => {
    const r = runScenario({ launchId: 'earth', destId: 'orbit', kind: 'orbit', orbitKm: 300, build: DEFAULT_BUILD });
    assertStableOrbit(r, 'earth', ORBIT_ALT_CAP);
  });

  it('the heavy moon-lander stack does not over-burn to escape @400km', () => {
    const r = runScenario({ launchId: 'earth', destId: 'orbit', kind: 'orbit', orbitKm: 400, build: presetBuild('moon-lander') });
    assertStableOrbit(r, 'earth', ORBIT_ALT_CAP);
  });
});

describe('lunar transfer ascent across builds', () => {
  it('the orbiter reaches a sustained Moon orbit without escaping Earth on ascent', () => {
    const r = runScenario({ launchId: 'earth', destId: 'moon', kind: 'orbit', orbitKm: 60, build: presetBuild('orbiter') });
    assertOrbit(r, 'moon');
    expect(r.maxAlt, 'ascent must not fling the craft past Earth escape').toBeLessThanOrEqual(5000);
  });
});
