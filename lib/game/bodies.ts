import * as THREE from 'three';
import { EARTH_RADIUS, ATMOSPHERE_HEIGHT } from './constants';

/**
 * A celestial body the flight is calculated against.
 *
 * The world is a heliocentric solar system: the Sun sits fixed at the origin and
 * every planet rides a slow circular orbit in the x-y plane; moons orbit their
 * parent planet (which in turn orbits the Sun). All of this motion is *analytic*
 * — a pure function of sim time via {@link bodyStateAt} — so the simulation stays
 * deterministic and replayable: the same plan always plays out identically.
 *
 * A `Body` is a snapshot of a definition at one instant: `center` and `velocity`
 * are where the body is (and how fast it is moving) at the evaluation time. The
 * Simulator re-evaluates these every step from its own clock.
 */
export type Body = {
  id: string;
  name: string;
  center: THREE.Vector3;     // heliocentric position at the evaluation time
  velocity: THREE.Vector3;   // heliocentric velocity at the evaluation time
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
  /** True for the Sun — a luminous star at the centre of the system. */
  star?: boolean;
  /** Orbital parameters (null/undefined for the fixed central Sun). */
  orbit?: BodyOrbit;
};

/** A body's circular orbit around its parent (the Sun, or a host planet). */
export type BodyOrbit = {
  parentId: string;  // body this one orbits ('sun' for planets)
  radius: number;    // orbital radius (THREE units)
  phase: number;     // initial true anomaly (radians) at t=0
  omega: number;     // angular speed (rad/s), keyed to the parent's GM
};

/** Surface gravity (m/s²) → GM, matching the calibration in constants.ts. */
function gmFromSurfaceG(surfaceG: number, radius: number): number {
  return surfaceG * 1e-3 * radius * radius;
}

type BodyDef = {
  id: string; name: string; radius: number; surfaceG: number;
  atmosphereHeight: number; soiRadius: number; color: number; skyDay: number;
  gas?: boolean;
  star?: boolean;
  /** Heliocentric orbit radius (planets) or orbit radius around `parent` (moons). */
  orbitR?: number;
  /** Initial orbital angle (radians) at t=0. */
  phase?: number;
  /** Parent body this one orbits; omitted = orbits the Sun (or is the Sun). */
  parent?: string;
  /** True for icy/rocky dwarf worlds (decorative; used for sky/landing rules). */
  dwarf?: boolean;
};

export const SUN_ID = 'sun';

/**
 * The Sun's gravitational parameter. Strong enough that outer-planet Lambert
 * transfers fit the mission clock, while still keeping local launch/orbit play
 * governed mostly by the current body's patched conic.
 */
export const SUN_GM = 700.0;

/** Arcade-scaled heliocentric solar system. Radii are compressed for
 *  playability but surface gravities and atmosphere presence track the real
 *  worlds. Orbit radii remain game-scaled, but the lanes are wide enough that
 *  moons no longer sit nearly an inner-planet hop away and the authored SOIs do
 *  not constantly overlap transfer space. */
const DEFS: BodyDef[] = [
  { id: 'sun',     name: 'Sun',     radius: 220,  surfaceG: 0,    atmosphereHeight: 0,   soiRadius: 99999, color: 0xffcf57, skyDay: 0xffe9a8, star: true },

  { id: 'mercury', name: 'Mercury', radius: 24.4, surfaceG: 3.70, atmosphereHeight: 0,   soiRadius: 90,  color: 0x9c9088, skyDay: 0x07070b, orbitR: 1100,  phase: 0.5 },
  { id: 'venus',   name: 'Venus',   radius: 60.5, surfaceG: 8.87, atmosphereHeight: 180, soiRadius: 520, color: 0xd9b870, skyDay: 0xe8c878, orbitR: 2100,  phase: 2.6 },
  { id: 'earth',   name: 'Earth',   radius: EARTH_RADIUS, surfaceG: 9.81, atmosphereHeight: ATMOSPHERE_HEIGHT, soiRadius: 720, color: 0x2e74e8, skyDay: 0x8ec9ff, orbitR: 3400, phase: 0.0 },
  { id: 'moon',    name: 'Moon',    radius: 17.4, surfaceG: 1.62, atmosphereHeight: 0,   soiRadius: 70,  color: 0xc2c7d2, skyDay: 0x0a0a12, parent: 'earth', orbitR: 560, phase: 0.7 },
  { id: 'mars',    name: 'Mars',    radius: 33.9, surfaceG: 3.71, atmosphereHeight: 60,  soiRadius: 240, color: 0xd06a44, skyDay: 0xe0a07a, orbitR: 4700, phase: 0.9 },
  { id: 'phobos',  name: 'Phobos',  radius: 6.0,  surfaceG: 0.30, atmosphereHeight: 0,   soiRadius: 34,  color: 0x9a8f84, skyDay: 0x07070a, parent: 'mars', orbitR: 140, phase: 1.5 },
  { id: 'ceres',   name: 'Ceres',   radius: 13.5, surfaceG: 0.27, atmosphereHeight: 0,   soiRadius: 54,  color: 0x8d8a82, skyDay: 0x06060a, dwarf: true, orbitR: 6000, phase: 4.0 },
  { id: 'jupiter', name: 'Jupiter', radius: 120,  surfaceG: 24.79,atmosphereHeight: 240, soiRadius: 900, color: 0xd7b58a, skyDay: 0xc9a878, gas: true, orbitR: 8200, phase: 5.3 },
  { id: 'saturn',  name: 'Saturn',  radius: 105,  surfaceG: 10.44,atmosphereHeight: 220, soiRadius: 850, color: 0xe6d6a8, skyDay: 0xd8c790, gas: true, orbitR: 10600, phase: 2.0 },
  { id: 'titan',   name: 'Titan',   radius: 25.8, surfaceG: 1.35, atmosphereHeight: 120, soiRadius: 300, color: 0xd2a24c, skyDay: 0xc88a3a, parent: 'saturn', orbitR: 650, phase: 0.3 },
  { id: 'uranus',  name: 'Uranus',  radius: 72,   surfaceG: 8.69, atmosphereHeight: 200, soiRadius: 750, color: 0x9fe0e6, skyDay: 0x7fb8c4, gas: true, orbitR: 13000, phase: 3.4 },
  { id: 'neptune', name: 'Neptune', radius: 70,   surfaceG: 11.15,atmosphereHeight: 200, soiRadius: 750, color: 0x3f63d8, skyDay: 0x2a3f9c, gas: true, orbitR: 15400, phase: 5.9 },
];

export const SOLAR_BODIES: Record<string, BodyDef> =
  Object.fromEntries(DEFS.map((d) => [d.id, d]));

export function bodyDef(id: string): BodyDef {
  return SOLAR_BODIES[id] ?? SOLAR_BODIES.earth;
}

/** Central GM a body orbits about: the Sun for planets, the host planet for moons. */
function centralGM(parentId: string): number {
  if (parentId === SUN_ID) return SUN_GM;
  const p = bodyDef(parentId);
  return gmFromSurfaceG(p.surfaceG, p.radius);
}

/** Angular speed of a circular orbit at `radius` about a body of parameter `mu`. */
function orbitOmega(mu: number, radius: number): number {
  return radius > 0 ? Math.sqrt(mu / (radius * radius * radius)) : 0;
}

export type BodyState = { pos: THREE.Vector3; vel: THREE.Vector3 };

/**
 * Heliocentric position + velocity of a body at sim time `t` (seconds). The Sun
 * is fixed at the origin; planets ride circular orbits about it; moons ride
 * circular orbits about their (also-moving) parent. Everything stays in the x-y
 * plane, where the whole flight is computed.
 */
export function bodyStateAt(id: string, t: number): BodyState {
  const def = bodyDef(id);
  if (id === SUN_ID || def.orbitR === undefined) {
    return { pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(0, 0, 0) };
  }
  const parentId = def.parent ?? SUN_ID;
  const parent = bodyStateAt(parentId, t);
  const r = def.orbitR;
  const omega = orbitOmega(centralGM(parentId), r);
  const theta = (def.phase ?? 0) + omega * t;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const pos = parent.pos.clone().add(new THREE.Vector3(r * cos, r * sin, 0));
  const vel = parent.vel.clone().add(new THREE.Vector3(-r * omega * sin, r * omega * cos, 0));
  return { pos, vel };
}

function makeBody(def: BodyDef, state: BodyState): Body {
  const body: Body = {
    id: def.id,
    name: def.name,
    center: state.pos.clone(),
    velocity: state.vel.clone(),
    radius: def.radius,
    GM: def.star ? SUN_GM : gmFromSurfaceG(def.surfaceG, def.radius),
    atmosphereHeight: def.atmosphereHeight,
    soiRadius: def.soiRadius,
    color: def.color,
    skyDay: def.skyDay,
    gravityScale: def.surfaceG / 9.81,
    gas: def.gas,
    star: def.star,
  };
  if (def.orbitR !== undefined && def.id !== SUN_ID) {
    const parentId = def.parent ?? SUN_ID;
    body.orbit = {
      parentId,
      radius: def.orbitR,
      phase: def.phase ?? 0,
      omega: orbitOmega(centralGM(parentId), def.orbitR),
    };
  }
  return body;
}

/** Ids of every body in the system, Sun first. */
export const SYSTEM_BODY_IDS: string[] = DEFS.map((d) => d.id);

/** Build the full live solar system evaluated at sim time `t`. */
export function buildSystem(t = 0): Body[] {
  return DEFS.map((d) => makeBody(d, bodyStateAt(d.id, t)));
}

/** Reposition an existing body array in place to sim time `t` (no allocations of Body objects). */
export function positionBodiesAt(bodies: Body[], t: number): void {
  for (const b of bodies) {
    const s = bodyStateAt(b.id, t);
    b.center.copy(s.pos);
    b.velocity.copy(s.vel);
  }
}

/**
 * Build the body list for a flight. Unlike the old two-body model, every flight
 * now runs against the *entire* solar system. The list is ordered launch-body
 * first, then the transfer target (if any), then the rest — preserving the
 * `[0] = launch`, `[1] = target` contract a few callers rely on.
 */
export function buildFlightBodies(launchId: string, destId: string | null, t = 0): Body[] {
  const system = buildSystem(t);
  const order = (b: Body): number => {
    if (b.id === launchId) return 0;
    if (destId && b.id === destId) return 1;
    return 2;
  };
  return system.sort((a, b) => order(a) - order(b));
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
  { id: 'phobos',  name: 'Phobos',  targetId: 'phobos',  objective: 'Rendezvous with Phobos — a tiny, low-gravity moon of Mars.' },
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

/** A solid world can be landed on; gas giants and the Sun can only be orbited. */
export function isLandable(bodyId: string): boolean {
  const def = bodyDef(bodyId);
  return !def.gas && !def.star;
}

/** Returns the transfer target, or null when the destination is the launch body itself. */
export function destinationTargetId(destinationId: string, launchId: string): string | null {
  const targetId = getDestination(destinationId).targetId;
  return targetId && targetId !== launchId ? targetId : null;
}

/**
 * Returns the body whose sphere of influence the position sits in — the
 * "patched-conic" governing body. SOIs are sized to each body's true
 * gravitational dominance radius (see DEFS), so the craft is governed by the
 * most local body whose SOI contains it (a moon over its planet over the Sun).
 * Outside every planet/moon SOI it's interplanetary space, governed by the Sun;
 * if there is no Sun in the set, fall back to the strongest raw pull.
 */
export function dominantBody(bodies: Body[], position: THREE.Vector3): Body {
  let inSoi: Body | null = null;
  for (const b of bodies) {
    if (b.star) continue;
    if (position.distanceTo(b.center) <= b.soiRadius) {
      // Prefer the most local influence (smallest SOI) when SOIs overlap.
      if (!inSoi || b.soiRadius < inSoi.soiRadius) inSoi = b;
    }
  }
  if (inSoi) return inSoi;
  const sun = bodies.find((b) => b.star);
  if (sun) return sun;
  // No star in the set (legacy two-body lists): strongest raw pull.
  let best = bodies[0];
  let bestPull = -Infinity;
  for (const b of bodies) {
    const dist = Math.max(position.distanceTo(b.center), b.radius);
    const pull = b.GM / (dist * dist);
    if (pull > bestPull) { bestPull = pull; best = b; }
  }
  return best;
}
