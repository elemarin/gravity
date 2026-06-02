import { RocketBuild, RocketStats } from './types';
import { PARTS_CATALOG, RocketPart } from './career/Parts';

const partById = (id: string): RocketPart | undefined =>
  PARTS_CATALOG.find((p) => p.id === id);

export function computeStats(build: RocketBuild): RocketStats {
  const engine = partById(build.engineId);
  const tanks  = build.tankIds.map((id) => partById(id)).filter(Boolean) as RocketPart[];
  const nose   = partById(build.noseId);
  const utils  = build.utilityIds.map((id) => partById(id)).filter(Boolean) as RocketPart[];

  const dryParts = [engine, nose, ...utils].filter(Boolean) as RocketPart[];
  const dryMass  =
    dryParts.reduce((s, p) => s + p.mass, 0) +
    tanks.reduce((s, p) => s + p.mass, 0);

  const fuelCapacity = tanks.reduce((s, p) => s + p.fuelCapacity, 0);
  const fuelMassPerL = 0.002; // tonnes per liter
  const wetMass = dryMass + fuelCapacity * fuelMassPerL;

  const thrust = engine?.thrust ?? 0;
  const burnRate = engine?.burnRate ?? 0;

  return { dryMass, wetMass, fuelCapacity, thrust, burnRate };
}

export function estimateDeltaV(stats: RocketStats): number {
  // crude approximation of total acceleration capability
  if (stats.burnRate <= 0 || stats.wetMass <= 0) return 0;
  const isp = 280; // s, average
  const g0  = 9.81;
  const massRatio = stats.wetMass / Math.max(stats.dryMass, 0.001);
  return isp * g0 * Math.log(massRatio);
}
