import { RocketBuild, RocketStats, StageSpec } from './types';
import { PARTS_CATALOG, RocketPart } from './career/Parts';

const FUEL_MASS_PER_L = 0.002; // tonnes per liter

const partById = (id: string): RocketPart | undefined =>
  PARTS_CATALOG.find((p) => p.id === id);

/**
 * Returns the rocket's stages ordered bottom-first. Falls back to a single
 * stage derived from the legacy engineId/tankIds fields for older saves.
 */
export function getStages(build: RocketBuild): StageSpec[] {
  if (build.stages && build.stages.length > 0) return build.stages;
  return [{ engineId: build.engineId, tankIds: build.tankIds }];
}

export type StageStats = {
  dryMass:      number;
  fuelMass:     number;
  fuelCapacity: number;
  thrust:       number;
  burnRate:     number;
};

export function computeStageStats(stage: StageSpec): StageStats {
  const engine = partById(stage.engineId);
  const tanks  = stage.tankIds.map((id) => partById(id)).filter(Boolean) as RocketPart[];

  const dryMass =
    (engine?.mass ?? 0) + tanks.reduce((s, p) => s + p.mass, 0);
  const fuelCapacity = tanks.reduce((s, p) => s + p.fuelCapacity, 0);

  return {
    dryMass,
    fuelMass:     fuelCapacity * FUEL_MASS_PER_L,
    fuelCapacity,
    thrust:       engine?.thrust ?? 0,
    burnRate:     engine?.burnRate ?? 0,
  };
}

/** Dry mass of the non-stage payload (nose/capsule + utilities). */
export function payloadDryMass(build: RocketBuild): number {
  const nose  = partById(build.noseId);
  const utils = build.utilityIds.map((id) => partById(id)).filter(Boolean) as RocketPart[];
  return (nose?.mass ?? 0) + utils.reduce((s, p) => s + p.mass, 0);
}

export function computeStats(build: RocketBuild): RocketStats {
  const stages = getStages(build).map(computeStageStats);
  const payload = payloadDryMass(build);

  const dryMass = payload + stages.reduce((s, st) => s + st.dryMass, 0);
  const fuelCapacity = stages.reduce((s, st) => s + st.fuelCapacity, 0);
  const wetMass = dryMass + stages.reduce((s, st) => s + st.fuelMass, 0);

  // Active (first) stage drives the launch thrust figures.
  const first = stages[0];

  return {
    dryMass,
    wetMass,
    fuelCapacity,
    thrust:   first?.thrust ?? 0,
    burnRate: first?.burnRate ?? 0,
  };
}

export function estimateDeltaV(stats: RocketStats): number {
  // crude approximation of total acceleration capability
  if (stats.burnRate <= 0 || stats.wetMass <= 0) return 0;
  const isp = 280; // s, average
  const g0  = 9.81;
  const massRatio = stats.wetMass / Math.max(stats.dryMass, 0.001);
  return isp * g0 * Math.log(massRatio);
}

/**
 * Multi-stage delta-v: each stage burns while carrying the (full) stages above
 * it as dead payload, so staging yields more total delta-v than one big tank.
 */
export function estimateBuildDeltaV(build: RocketBuild): number {
  const stages = getStages(build).map(computeStageStats);
  const payload = payloadDryMass(build);
  const isp = 280;
  const g0  = 9.81;

  let total = 0;
  for (let i = 0; i < stages.length; i++) {
    const above = payload + stages
      .slice(i + 1)
      .reduce((s, st) => s + st.dryMass + st.fuelMass, 0);
    const st = stages[i];
    if (st.burnRate <= 0 || st.fuelMass <= 0) continue;
    const m0 = above + st.dryMass + st.fuelMass;
    const m1 = above + st.dryMass;
    if (m1 <= 0) continue;
    total += isp * g0 * Math.log(m0 / m1);
  }
  return total;
}
