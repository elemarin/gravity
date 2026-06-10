import { RocketBuild } from '../types';
import { estimateBuildDeltaV } from '../BuildSpec';
import { destinationTargetId, bodyDef, DESTINATIONS } from '../bodies';
import { MissionKind } from '../plan/FlightPlan';

/**
 * Mission Δv budgets — the career's real progression gate.
 *
 * In this scaled, static-body solar system a minimum-energy transfer reaches a
 * far world almost as cheaply as a near one (you simply coast longer), so raw
 * distance can't make "reach further → need a bigger rocket" bite on its own.
 * Instead we gate each destination behind a delta-v budget — exactly the KSP
 * "delta-v map" mental model. The builder already estimates a build's Δv; a
 * launch toward a destination is only allowed once the rocket carries the
 * budget that destination demands, so every rung up the ladder forces a bigger
 * or better rocket.
 *
 * Budgets are calibrated against the built-in presets (measured Δv):
 *   starter ≈ 4080 · orbiter ≈ 6040 · moon-lander ≈ 7460 · mars-pioneer ≈ 7660
 *   lunar-express ≈ 8680 · grand-voyager ≈ 9440
 * so the intended rocket for each mission clears its budget with margin while
 * the tier below falls short.
 */
const TARGET_DV: Record<string, number> = {
  orbit:   3700,   // a stable orbit of the launch world
  moon:    5000,
  mercury: 6200,
  venus:   6400,
  mars:    6600,
  phobos:  7000,
  ceres:   7400,
  jupiter: 7900,
  saturn:  8300,
  titan:   8700,
  uranus:  9100,
  neptune: 9700,
};

/** Extra budget for the objective on top of simply reaching the body. */
const KIND_DV: Record<MissionKind, number> = {
  'orbit': 0,
  'land':  500,
};

/** Δv (m/s) a build must carry to attempt launchBody → destination with kind. */
export function requiredDeltaV(launchBodyId: string, destinationId: string, kind: MissionKind): number {
  const targetId = destinationTargetId(destinationId, launchBodyId);
  const key = targetId ?? 'orbit';
  const base = TARGET_DV[key] ?? TARGET_DV.orbit;
  // Launching from a lighter world than Earth costs less ascent Δv.
  const g = bodyDef(launchBodyId).surfaceG / 9.81;
  const launchFactor = launchBodyId === 'earth' ? 1 : Math.min(1, 0.45 + 0.55 * g);
  return Math.round(base * launchFactor + (KIND_DV[kind] ?? 0));
}

/** The farthest destination (by budget) a build can reach to orbit, or null. */
export function farthestReachable(build: RocketBuild, launchBodyId = 'earth'): string | null {
  const have = estimateBuildDeltaV(build);
  let best: { id: string; dv: number } | null = null;
  for (const d of DESTINATIONS) {
    const dv = requiredDeltaV(launchBodyId, d.id, 'orbit');
    if (have >= dv && (!best || dv > best.dv)) best = { id: d.id, dv };
  }
  return best?.id ?? null;
}
