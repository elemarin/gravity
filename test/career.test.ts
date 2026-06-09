/**
 * Career-layer regressions: the Δv progression gate, preset/part unlock
 * reachability, campaign-goal wiring, and the in-flight station / base deploy
 * mechanic. These guard the rules that decide what a player can build and fly.
 */
import { describe, it, expect } from 'vitest';
import { Simulator } from '../lib/game/plan/Simulator';
import { autoPlan } from '../lib/game/plan/AutoPlan';
import { buildFlightSimSetup } from '../lib/game/SimSetup';
import { isLandable } from '../lib/game/bodies';
import {
  evaluateGoals, stationGoalId, baseGoalId, CAMPAIGN_GOALS,
} from '../lib/game/career/Progress';
import { RocketBuild, DEFAULT_BUILD, MissionResult } from '../lib/game/types';
import { PARTS_CATALOG } from '../lib/game/career/Parts';
import { MILESTONES } from '../lib/game/career/Milestones';
import { requiredDeltaV } from '../lib/game/career/Requirements';
import { buildPartIds, estimateBuildDeltaV } from '../lib/game/BuildSpec';
import { ROCKET_PRESETS, ROUTE_PROVER_BUILD } from '../lib/game/career/Presets';
import { DT } from './harness';

const presetBuild = (id: string) => ROCKET_PRESETS.find((p) => p.id === id)!.build;

describe('Δv progression gate', () => {
  it('budget climbs monotonically along the destination ladder', () => {
    const ladder = ['orbit', 'moon', 'mercury', 'venus', 'mars', 'phobos',
      'ceres', 'jupiter', 'saturn', 'titan', 'uranus', 'neptune'];
    let prev = 0;
    for (const dest of ladder) {
      const dv = requiredDeltaV('earth', dest, 'orbit');
      expect(dv, `budget for ${dest} should be >= previous`).toBeGreaterThanOrEqual(prev);
      prev = dv;
    }
  });

  it('each rocket tier clears its headline mission while the tier below falls short', () => {
    const dvOf = (id: string) => Math.round(estimateBuildDeltaV(presetBuild(id)));
    const meets = (id: string, dest: string, kind: any) => dvOf(id) >= requiredDeltaV('earth', dest, kind);
    const starterDv = Math.round(estimateBuildDeltaV(DEFAULT_BUILD));

    expect(starterDv, 'starter clears Earth orbit').toBeGreaterThanOrEqual(requiredDeltaV('earth', 'orbit', 'orbit'));
    expect(starterDv, 'starter cannot reach the Moon').toBeLessThan(requiredDeltaV('earth', 'moon', 'orbit'));
    expect(meets('orbiter', 'moon', 'orbit'), 'orbiter clears the Moon').toBe(true);
    expect(meets('orbiter', 'neptune', 'orbit'), 'orbiter cannot reach Neptune').toBe(false);
    expect(meets('mars-pioneer', 'mars', 'land'), 'mars-pioneer lands on Mars').toBe(true);
    expect(meets('grand-voyager', 'saturn', 'orbit'), 'grand-voyager clears Saturn').toBe(true);
    expect(meets('outer-cruiser', 'neptune', 'orbit'), 'outer-cruiser clears Neptune').toBe(true);
  });
});

describe('part & preset reachability', () => {
  const unlockable = new Set<string>(PARTS_CATALOG.filter((p) => p.unlockedByDefault).map((p) => p.id));
  for (const m of MILESTONES) for (const id of m.unlocks) unlockable.add(id);
  for (const g of CAMPAIGN_GOALS) for (const id of g.partUnlocks ?? []) unlockable.add(id);

  it('every preset is buildable through career progress', () => {
    for (const preset of ROCKET_PRESETS) {
      for (const id of buildPartIds(preset.build)) {
        expect(unlockable.has(id), `preset '${preset.id}' needs unreachable part '${id}'`).toBe(true);
      }
    }
  });

  it('every catalogue part is unlockable (no orphans)', () => {
    for (const p of PARTS_CATALOG) {
      expect(unlockable.has(p.id), `part '${p.id}' is never unlocked`).toBe(true);
    }
  });
});

describe('campaign goals', () => {
  it('landing and base goals only target landable worlds', () => {
    for (const g of CAMPAIGN_GOALS) {
      if (g.kind === 'landing' || g.kind === 'base') {
        expect(isLandable(g.body), `goal '${g.id}' targets non-landable '${g.body}'`).toBe(true);
      }
    }
  });

  it('station / base id helpers resolve correctly', () => {
    expect(stationGoalId('earth')).toBe('station-earth');
    expect(stationGoalId('neptune')).toBe('station-neptune');
    expect(stationGoalId('nowhere')).toBeUndefined();
    expect(baseGoalId('mars')).toBe('base-mars');
    expect(baseGoalId('venus')).toBe('base-venus');
    expect(baseGoalId('jupiter')).toBeUndefined(); // gas giant — no surface, no base
  });

  it('mission-end evaluation awards landings but never stations/bases', () => {
    const fakeLanded: MissionResult = {
      outcome: 'landed', maxAltitude: 200, maxSpeed: 0.8, landingSpeed: 0,
      reachedSpace: true, reachedOrbit: true, rating: 'A', score: 0,
      reachedBodies: ['earth', 'moon'], landedBody: 'moon', transferCompleted: false,
      stationDeployed: false, stationBodyId: null,
    };
    const goals = evaluateGoals({ result: fakeLanded, build: DEFAULT_BUILD, launchBodyId: 'earth' }, []);
    expect(goals).toContain('land-moon');
    expect(goals.some((id) => id.startsWith('station-') || id.startsWith('base-'))).toBe(false);
  });
});

describe('in-flight deploy mechanics', () => {
  it('deploys a station into a stable Earth orbit', () => {
    const stationRocket: RocketBuild = { ...presetBuild('moon-lander'), noseId: 'station-module' };
    const plan = autoPlan('earth', 'orbit', { kind: 'orbit', orbitKm: 300 });
    const setup = buildFlightSimSetup(stationRocket, plan);
    expect(setup.config.hasStation, 'build carries a station').toBe(true);
    const sim = new Simulator(setup.config, plan);
    sim.reset();

    let deployedAround: string | null = null;
    let everInZone = false;
    for (let i = 0; i < 200_000 && !deployedAround; i++) {
      sim.step(DT);
      if (sim.canDeployStation()) {
        everInZone = true;
        deployedAround = sim.manualDeployStation();
      }
    }
    expect(everInZone, 'reached a valid deploy zone').toBe(true);
    expect(deployedAround).toBe('earth');
    expect(sim.state.deployedStation && stationGoalId(deployedAround!)).toBe('station-earth');
    expect(sim.manualDeployStation(), 'station deploys only once').toBeNull();
  });

  it('deploys a base on the Moon surface after landing', () => {
    const baseRocket: RocketBuild = { ...ROUTE_PROVER_BUILD, noseId: 'station-module' };
    const plan = autoPlan('earth', 'moon', { kind: 'land' });
    const setup = buildFlightSimSetup(baseRocket, plan);
    const sim = new Simulator(setup.config, plan);
    sim.reset();
    for (let i = 0; i < 4_000_000 && sim.state.phase !== 'landed'; i++) sim.step(DT);
    expect(sim.state.phase === 'landed' && sim.state.landedBodyId).toBe('moon');
    expect(sim.stationDeployContext()).toBe('surface');
    const deployed = sim.manualDeployStation();
    expect(deployed === 'moon' && sim.state.stationDeployedOnSurface).toBe(true);
    expect(baseGoalId(deployed!)).toBe('base-moon');
  });
});
