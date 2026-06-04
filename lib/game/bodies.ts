import * as THREE from 'three';
import { EARTH_CENTER, EARTH_RADIUS, ATMOSPHERE_HEIGHT } from './constants';

/**
 * A celestial body the flight is calculated against. Bodies are static within
 * a flight (they do not orbit each other) which keeps the simulation
 * deterministic — the same plan always plays out identically.
 */
export type Body = {
  id: string;
  name: string;
  center: THREE.Vector3;
  radius: number;            // surface radius (THREE units ≈ km, arcade-scaled)
  GM: number;                // gravitational parameter (km³/s²)
  atmosphereHeight: number;  // units above surface where drag fades to 0 (0 = airless)
  soiRadius: number;         // sphere-of-influence radius for SOI triggers
  color: number;             // hex surface colour
  /** Sky colour seen from the ground (day). Airless worlds stay near-black. */
  skyDay: number;
  /** Relative surface gravity (Earth = 1), used for arcade tuning + UI. */
  gravityScale: number;
  /** True for gas giants (no hard surface, decorative banding). */
  gas?: boolean;
};

/** Surface gravity (m/s²) → GM, matching the calibration in constants.ts. */
function gmFromSurfaceG(surfaceG: number, radius: number): number {
  return surfaceG * 1e-3 * radius * radius;
}

type BodyDef = {
  id: string; name: string; radius: number; surfaceG: number;
  atmosphereHeight: number; soiRadius: number; color: number; skyDay: number;
  gas?: boolean;
  /**
   * Distance multiplier applied when this body is the transfer destination.
   * Higher = placed proportionally farther from the launch world, so the
   * outbound + capture burns cost more delta-v. Defaults to 1; the farther
   * a body sits in the real solar system, the higher its reach — this is the
   * knob that makes "reach further → need a bigger rocket" actually bite.
   */
  reach?: number;
  /** True for icy/rocky dwarf worlds (decorative; used for sky/landing rules). */
  dwarf?: boolean;
};

/** Arcade-scaled solar system. Radii are compressed for playability but
 *  surface gravities and atmosphere presence track the real worlds. */
const DEFS: BodyDef[] = [
  { id: 'mercury', name: 'Mercury', radius: 24.4, surfaceG: 3.70, atmosphereHeight: 0,   soiRadius: 70,  color: 0x9c9088, skyDay: 0x07070b },
  { id: 'venus',   name: 'Venus',   radius: 60.5, surfaceG: 8.87, atmosphereHeight: 180, soiRadius: 200, color: 0xd9b870, skyDay: 0xe8c878, gas: false },
  { id: 'earth',   name: 'Earth',   radius: EARTH_RADIUS, surfaceG: 9.81, atmosphereHeight: ATMOSPHERE_HEIGHT, soiRadius: 1600, color: 0x2e74e8, skyDay: 0x8ec9ff },
  { id: 'moon',    name: 'Moon',    radius: 17.4, surfaceG: 1.62, atmosphereHeight: 0,   soiRadius: 120, color: 0xc2c7d2, skyDay: 0x0a0a12 },
  { id: 'mars',    name: 'Mars',    radius: 33.9, surfaceG: 3.71, atmosphereHeight: 60,  soiRadius: 400, color: 0xd06a44, skyDay: 0xe0a07a },
  { id: 'phobos',  name: 'Phobos',  radius: 6.0,  surfaceG: 0.30, atmosphereHeight: 0,   soiRadius: 30,  color: 0x9a8f84, skyDay: 0x07070a, reach: 1.35 },
  { id: 'ceres',   name: 'Ceres',   radius: 13.5, surfaceG: 0.27, atmosphereHeight: 0,   soiRadius: 55,  color: 0x8d8a82, skyDay: 0x06060a, dwarf: true, reach: 1.55 },
  { id: 'jupiter', name: 'Jupiter', radius: 120,  surfaceG: 24.79,atmosphereHeight: 240, soiRadius: 1400,color: 0xd7b58a, skyDay: 0xc9a878, gas: true },
  { id: 'saturn',  name: 'Saturn',  radius: 105,  surfaceG: 10.44,atmosphereHeight: 220, soiRadius: 1200,color: 0xe6d6a8, skyDay: 0xd8c790, gas: true },
  { id: 'titan',   name: 'Titan',   radius: 25.8, surfaceG: 1.35, atmosphereHeight: 120, soiRadius: 110, color: 0xd2a24c, skyDay: 0xc88a3a, reach: 1.85 },
  { id: 'uranus',  name: 'Uranus',  radius: 72,   surfaceG: 8.69, atmosphereHeight: 200, soiRadius: 900, color: 0x9fe0e6, skyDay: 0x7fb8c4, gas: true, reach: 2.1 },
  { id: 'neptune', name: 'Neptune', radius: 70,   surfaceG: 11.15,atmosphereHeight: 200, soiRadius: 850, color: 0x3f63d8, skyDay: 0x2a3f9c, gas: true, reach: 2.4 },
];

function makeBody(def: BodyDef, center: THREE.Vector3): Body {
  return {
    id: def.id,
    name: def.name,
    center: center.clone(),
    radius: def.radius,
    GM: gmFromSurfaceG(def.surfaceG, def.radius),
    atmosphereHeight: def.atmosphereHeight,
    soiRadius: def.soiRadius,
    color: def.color,
    skyDay: def.skyDay,
    gravityScale: def.surfaceG / 9.81,
    gas: def.gas,
  };
}

/** Placement reach multiplier for a destination body (1 = baseline). */
function bodyReach(id: string): number {
  return SOLAR_BODIES[id]?.reach ?? 1;
}

export const SOLAR_BODIES: Record<string, BodyDef> =
  Object.fromEntries(DEFS.map((d) => [d.id, d]));

export function bodyDef(id: string): BodyDef {
  return SOLAR_BODIES[id] ?? SOLAR_BODIES.earth;
}

/** Canonical Earth body (launch surface at world origin, centre below). */
export const EARTH_BODY: Body = makeBody(SOLAR_BODIES.earth, EARTH_CENTER);

/**
 * Build the body list for a flight: the launch body is centred so its surface
 * sits at the world origin (+y is "up"), and an optional destination body is
 * placed off to the side at a reachable distance so the transfer is flyable.
 */
export function buildFlightBodies(launchId: string, destId: string | null): Body[] {
  const launchDef = bodyDef(launchId);
  const launchCenter = new THREE.Vector3(0, -launchDef.radius, 0);
  const launch = makeBody(launchDef, launchCenter);
  if (!destId || destId === launchId) return [launch];

  const destDef = bodyDef(destId);
  // Place the destination up-and-out, scaled by both radii so larger worlds
  // sit proportionally farther away but always within camera range. The
  // destination must also sit clear of its OWN sphere of influence — a big
  // body like Jupiter has an SOI wide enough to otherwise swallow the launch
  // pad, firing the arrival capture at t=0 and hijacking the ascent.
  const gap = Math.max(
    (launchDef.radius + destDef.radius) * 5 + 380,
    destDef.soiRadius * 1.3 + launchDef.radius,
  ) * bodyReach(destId);
  const destCenter = launchCenter.clone().add(new THREE.Vector3(gap * 0.82, gap * 0.57, 0));
  const dest = makeBody(destDef, destCenter);
  return [launch, dest];
}

// ── Destinations (what the plan targets) ──────────────────────────────────

export type Destination = {
  id: string;
  name: string;
  /** Target body to reach, or null for "orbit the launch body". */
  targetId: string | null;
  objective: string;
};

export const DESTINATIONS: Destination[] = [
  { id: 'orbit',   name: 'Orbit',   targetId: null,      objective: 'Reach a stable orbit above the Kármán line.' },
  { id: 'moon',    name: 'Moon',    targetId: 'moon',    objective: 'Transfer to the Moon and reach it.' },
  { id: 'mercury', name: 'Mercury', targetId: 'mercury', objective: 'Cross to scorched, airless Mercury.' },
  { id: 'venus',   name: 'Venus',   targetId: 'venus',   objective: 'Brave the thick skies of Venus.' },
  { id: 'mars',    name: 'Mars',    targetId: 'mars',    objective: 'Transfer to Mars — the red planet awaits.' },
  { id: 'phobos',  name: 'Phobos',  targetId: 'phobos',  objective: 'Rendezvous with Phobos — a tiny, low-gravity moon far out by Mars.' },
  { id: 'ceres',   name: 'Ceres',   targetId: 'ceres',   objective: 'Reach Ceres, the dwarf world in the asteroid belt.' },
  { id: 'jupiter', name: 'Jupiter', targetId: 'jupiter', objective: 'Orbit the king of planets — a gas giant, no surface to land on.' },
  { id: 'saturn',  name: 'Saturn',  targetId: 'saturn',  objective: 'Orbit the ringed giant — a gas world with no surface.' },
  { id: 'titan',   name: 'Titan',   targetId: 'titan',   objective: 'Descend through the orange haze of Titan, Saturn’s giant moon.' },
  { id: 'uranus',  name: 'Uranus',  targetId: 'uranus',  objective: 'Orbit the tilted ice giant — a long, cold cruise.' },
  { id: 'neptune', name: 'Neptune', targetId: 'neptune', objective: 'Reach Neptune at the edge of the system — the ultimate voyage.' },
];

export function getDestination(id: string): Destination {
  return DESTINATIONS.find((d) => d.id === id) ?? DESTINATIONS[0];
}

/** A solid world can be landed on; gas giants can only be orbited. */
export function isLandable(bodyId: string): boolean {
  return !bodyDef(bodyId).gas;
}

/** Returns the transfer target, or null when the destination is the launch body itself. */
export function destinationTargetId(destinationId: string, launchId: string): string | null {
  const targetId = getDestination(destinationId).targetId;
  return targetId && targetId !== launchId ? targetId : null;
}

// ── Legacy scenario shim (kept so older saves/imports still resolve) ───────

export type Scenario = {
  id: string;
  name: string;
  bodies: Body[];
  objective: string;
};

export const SCENARIOS: Scenario[] = [
  { id: 'earth-orbit',   name: 'Earth Orbit',    bodies: buildFlightBodies('earth', null),   objective: DESTINATIONS[0].objective },
  { id: 'moon-transfer', name: 'Lunar Transfer', bodies: buildFlightBodies('earth', 'moon'), objective: DESTINATIONS[1].objective },
];

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

/** Returns the body whose gravity dominates at a given world position. */
export function dominantBody(bodies: Body[], position: THREE.Vector3): Body {
  let best = bodies[0];
  let bestPull = -Infinity;
  for (const b of bodies) {
    const dist = Math.max(position.distanceTo(b.center), b.radius);
    const pull = b.GM / (dist * dist);
    if (pull > bestPull) {
      bestPull = pull;
      best = b;
    }
  }
  return best;
}

/** Backwards-compatible Moon export (used by a few legacy references). */
export const MOON_BODY: Body = makeBody(SOLAR_BODIES.moon,
  new THREE.Vector3(620, EARTH_CENTER.y + 430, 0));
