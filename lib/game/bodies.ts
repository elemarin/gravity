import * as THREE from 'three';
import { EARTH_CENTER, EARTH_RADIUS, GM, ATMOSPHERE_HEIGHT } from './constants';

/**
 * A celestial body the flight plan is calculated against. Bodies are static
 * (they do not orbit each other) which keeps the whole simulation
 * deterministic — the same plan always plays out identically.
 */
export type Body = {
  id: string;
  name: string;
  center: THREE.Vector3;
  radius: number;            // surface radius (THREE units ≈ km)
  GM: number;                // gravitational parameter (km³/s²)
  atmosphereHeight: number;  // units above surface where drag fades to 0 (0 = airless)
  soiRadius: number;         // sphere-of-influence radius for SOI triggers
  color: number;             // hex surface colour
};

/** Surface gravity (m/s²) → GM, matching the calibration in constants.ts. */
function gmFromSurfaceG(surfaceG: number, radius: number): number {
  return surfaceG * 1e-3 * radius * radius;
}

export const EARTH_BODY: Body = {
  id: 'earth',
  name: 'Earth',
  center: EARTH_CENTER.clone(),
  radius: EARTH_RADIUS,
  GM,
  atmosphereHeight: ATMOSPHERE_HEIGHT,
  soiRadius: 1600,
  color: 0x2a5cff,
};

/** A small airless Moon placed off to one side so reaching it needs a transfer. */
export const MOON_BODY: Body = {
  id: 'moon',
  name: 'Moon',
  center: new THREE.Vector3(620, EARTH_CENTER.y + 430, 0),
  radius: 17.4,
  GM: gmFromSurfaceG(1.62, 17.4),
  atmosphereHeight: 0,
  soiRadius: 120,
  color: 0xbfc4d0,
};

export type Scenario = {
  id: string;
  name: string;
  bodies: Body[];
  objective: string;
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'earth-orbit',
    name: 'Earth Orbit',
    bodies: [EARTH_BODY],
    objective: 'Reach a stable orbit above the Kármán line.',
  },
  {
    id: 'moon-transfer',
    name: 'Lunar Transfer',
    bodies: [EARTH_BODY, MOON_BODY],
    objective: 'Plan a transfer and reach the Moon.',
  },
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
