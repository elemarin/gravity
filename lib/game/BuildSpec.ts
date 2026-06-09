import { RocketBuild, RocketStats, StageSpec } from './types';
import { PARTS_CATALOG, RocketPart } from './career/Parts';

const FUEL_MASS_PER_L = 0.008; // tonnes per liter
/** Average specific impulse used for delta-v estimates (arcade tuning). */
export const ISP = 320;

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

/** Every part id referenced by a build — used to check unlock requirements. */
export function buildPartIds(build: RocketBuild): string[] {
  const ids = new Set<string>();
  getStages(build).forEach((s) => {
    ids.add(s.engineId);
    s.tankIds.forEach((t) => ids.add(t));
  });
  (build.boosterIds ?? []).forEach((id) => ids.add(id));
  ids.add(build.noseId);
  (build.utilityIds ?? []).forEach((id) => ids.add(id));
  if (build.landerId) ids.add(build.landerId);
  return Array.from(ids);
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

/** Combined contribution of all strap-on boosters (folded into stage 0). */
export function boosterStats(build: RocketBuild): StageStats {
  const boosters = (build.boosterIds ?? [])
    .map((id) => partById(id)).filter(Boolean) as RocketPart[];
  const dryMass = boosters.reduce((s, p) => s + p.mass, 0);
  const fuelCapacity = boosters.reduce((s, p) => s + p.fuelCapacity, 0);
  return {
    dryMass,
    fuelMass:     fuelCapacity * FUEL_MASS_PER_L,
    fuelCapacity,
    thrust:       boosters.reduce((s, p) => s + p.thrust, 0),
    burnRate:     boosters.reduce((s, p) => s + p.burnRate, 0),
  };
}

/** Merge two stage stats (used to strap boosters onto the launch stage). */
function mergeStages(a: StageStats, b: StageStats): StageStats {
  return {
    dryMass:      a.dryMass + b.dryMass,
    fuelMass:     a.fuelMass + b.fuelMass,
    fuelCapacity: a.fuelCapacity + b.fuelCapacity,
    thrust:       a.thrust + b.thrust,
    burnRate:     a.burnRate + b.burnRate,
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
  const boost = boosterStats(build);
  if (stages[0]) stages[0] = mergeStages(stages[0], boost);
  const payload = payloadDryMass(build);

  const dryMass = payload + stages.reduce((s, st) => s + st.dryMass, 0);
  const fuelCapacity = stages.reduce((s, st) => s + st.fuelCapacity, 0);
  const wetMass = dryMass + stages.reduce((s, st) => s + st.fuelMass, 0);

  // Active (first) stage — including boosters — drives the launch thrust.
  const first = stages[0];

  return {
    dryMass,
    wetMass,
    fuelCapacity,
    thrust:   first?.thrust ?? 0,
    burnRate: first?.burnRate ?? 0,
  };
}

/**
 * Multi-stage delta-v: each stage burns while carrying the (full) stages above
 * it as dead payload, so staging yields more total delta-v than one big tank.
 */
export function estimateBuildDeltaV(build: RocketBuild): number {
  const stages = getStages(build).map(computeStageStats);
  const boost = boosterStats(build);
  if (stages[0]) stages[0] = mergeStages(stages[0], boost);
  const payload = payloadDryMass(build);
  const isp = ISP;
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

/** Stage stats for the separable lander, derived from its part. */
export function landerStageStats(build: RocketBuild): StageStats | null {
  if (!build.landerId) return null;
  const part = partById(build.landerId);
  if (!part) return null;
  return {
    dryMass:      part.mass,
    fuelMass:     part.fuelCapacity * FUEL_MASS_PER_L,
    fuelCapacity: part.fuelCapacity,
    thrust:       part.thrust,
    burnRate:     part.burnRate,
  };
}

export type SimStages = {
  stages: StageStats[];
  /** Index of the lander stage in `stages`, or -1 when there is no lander. */
  landerIndex: number;
  /** Dry mass carried as non-stage payload (nose/capsule + utilities). */
  payloadMass: number;
  hasParachute: boolean;
  hasLegs: boolean;
  /** True when the build carries a deployable Station Module. */
  hasStation: boolean;
  /** Mass (t) of the station module, shed from the payload once deployed. */
  stationMass: number;
};

/** The station module the build carries (as payload or utility), if any. */
export function stationPart(build: RocketBuild): RocketPart | undefined {
  if (build.noseId === 'station-module') return partById('station-module');
  if ((build.utilityIds ?? []).includes('station-module')) return partById('station-module');
  return undefined;
}

/**
 * Flattens a build into the ordered stage list the deterministic Simulator
 * runs. A lander, when present, becomes an extra top stage that the
 * `deployLander` action separates onto.
 */
export function buildSimStages(build: RocketBuild): SimStages {
  const stages = getStages(build).map(computeStageStats);
  const boost = boosterStats(build);
  if (stages[0] && boost.thrust > 0) stages[0] = mergeStages(stages[0], boost);
  const lander = landerStageStats(build);
  let landerIndex = -1;
  if (lander) {
    landerIndex = stages.length;
    stages.push(lander);
  }
  const station = stationPart(build);
  return {
    stages,
    landerIndex,
    payloadMass: payloadDryMass(build),
    hasParachute: build.utilityIds.includes('parachute'),
    hasLegs:      build.utilityIds.includes('landing-legs'),
    hasStation:   !!station,
    stationMass:  station?.mass ?? 0,
  };
}
