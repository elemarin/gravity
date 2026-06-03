import * as THREE from 'three';
import { Body } from './bodies';

export type OrbitPath = {
  /** Closed ellipse polyline (first ≈ last) ready for the trajectory line. */
  points: THREE.Vector3[];
  apoAlt: number;  // km above surface
  periAlt: number; // km above surface
};

const SEGMENTS = 240;

/**
 * Analytic two-body orbit around `body` from an instantaneous state. Returns the
 * *complete* ellipse (where the craft has been and is going) so a stable orbit
 * draws as a full closed loop instead of a forward-integrated arc that only
 * covers part of the period. Returns null when the conic isn't a clean,
 * surface-clearing ellipse (ascent, suborbital, escape) — callers fall back to
 * integrating the path in those cases.
 */
export function orbitEllipse(body: Body, pos: THREE.Vector3, vel: THREE.Vector3): OrbitPath | null {
  const mu = body.GM;
  const rel = pos.clone().sub(body.center);
  const r = rel.length();
  if (r < 1e-6) return null;

  const v2 = vel.lengthSq();
  const eps = v2 / 2 - mu / r;           // specific orbital energy
  if (eps >= -1e-9) return null;          // parabolic / hyperbolic → not closed

  const hVec = new THREE.Vector3().crossVectors(rel, vel);
  const h = hVec.length();
  if (h < 1e-9) return null;              // degenerate radial trajectory

  // Eccentricity vector points toward periapsis: e = (v×h)/µ − r̂.
  const eVec = vel.clone().cross(hVec).multiplyScalar(1 / mu).sub(rel.clone().multiplyScalar(1 / r));
  const e = eVec.length();
  if (e >= 0.9999) return null;           // too eccentric to read as a loop

  const a = -mu / (2 * eps);
  const rp = a * (1 - e);                 // periapsis radius
  const ra = a * (1 + e);                 // apoapsis radius
  if (rp <= body.radius) return null;     // orbit dips into the surface → impact arc

  // Orbital-plane basis: P toward periapsis, Q 90° ahead along motion.
  const hHat = hVec.normalize();
  const pHat = e > 1e-6 ? eVec.normalize() : rel.clone().normalize();
  const qHat = new THREE.Vector3().crossVectors(hHat, pHat).normalize();

  const p = a * (1 - e * e);              // semi-latus rectum
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const theta = (i / SEGMENTS) * Math.PI * 2;
    const rr = p / (1 + e * Math.cos(theta));
    points.push(
      body.center.clone()
        .addScaledVector(pHat, rr * Math.cos(theta))
        .addScaledVector(qHat, rr * Math.sin(theta)),
    );
  }

  return { points, apoAlt: ra - body.radius, periAlt: rp - body.radius };
}
