import * as THREE from 'three';
import { Body } from './bodies';

export type OrbitPath = {
  /** Conic polyline ready for the trajectory line. */
  points: THREE.Vector3[];
  apoAlt: number;  // km above surface (Infinity for escape)
  periAlt: number; // km above surface (negative = sub-surface)
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

  // Velocity RELATIVE to the (moving) body — the orbit is a two-body conic in the
  // body's frame, so the body's own heliocentric motion must be removed first.
  // Without this, a low Earth orbit inherits Earth's huge solar velocity and the
  // drawn conic balloons into a wrong, ever-shifting arc.
  const relVel = vel.clone().sub(body.velocity);
  const v2 = relVel.lengthSq();
  const eps = v2 / 2 - mu / r;           // specific orbital energy
  if (eps >= -1e-9) return null;          // parabolic / hyperbolic → not closed

  const hVec = new THREE.Vector3().crossVectors(rel, relVel);
  const h = hVec.length();
  if (h < 1e-9) return null;              // degenerate radial trajectory

  // Eccentricity vector points toward periapsis: e = (v×h)/µ − r̂.
  const eVec = relVel.clone().cross(hVec).multiplyScalar(1 / mu).sub(rel.clone().multiplyScalar(1 / r));
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

/**
 * Like {@link orbitEllipse} but handles ALL conic sections — highly eccentric
 * ellipses, surface-dipping orbits, and hyperbolic/parabolic escape arcs — so
 * the trajectory line always shows the instantaneous Keplerian orbit rather
 * than a forward-integrated spiral during burns. Returns null only for truly
 * degenerate cases (radial free-fall with no angular momentum).
 */
export function orbitConic(body: Body, pos: THREE.Vector3, vel: THREE.Vector3): OrbitPath | null {
  const mu = body.GM;
  const rel = pos.clone().sub(body.center);
  const r = rel.length();
  if (r < 1e-6) return null;

  // Velocity relative to the (moving) body — see note in orbitEllipse. This is
  // what makes a settled orbit draw as a fixed, KSP-style closed ellipse instead
  // of a wandering arc, since the relative state describes the same conic all the
  // way around the orbit.
  const relVel = vel.clone().sub(body.velocity);
  const v2 = relVel.lengthSq();
  const eps = v2 / 2 - mu / r;

  const hVec = new THREE.Vector3().crossVectors(rel, relVel);
  const h = hVec.length();
  if (h < 1e-9) return null;

  const eVec = relVel.clone().cross(hVec).multiplyScalar(1 / mu).sub(rel.clone().multiplyScalar(1 / r));
  const e = eVec.length();

  const hHat = hVec.clone().normalize();
  const pHat = e > 1e-6 ? eVec.clone().normalize() : rel.clone().normalize();
  const qHat = new THREE.Vector3().crossVectors(hHat, pHat).normalize();
  const p = (h * h) / mu; // semi-latus rectum (valid for all conics)

  if (eps < -1e-9 && e < 1) {
    // ── Elliptical orbit ──
    const a = -mu / (2 * eps);
    const rp = a * (1 - e);
    const ra = a * (1 + e);
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

  // ── Hyperbolic / parabolic escape arc ──
  const rp = p / (1 + e);
  // Cap the drawn arc at a useful distance: the body's SOI or 3× current radius.
  const maxR = Math.max(r * 3, body.soiRadius > 0 ? body.soiRadius * 1.5 : r * 5);
  // Asymptotic angle for hyperbola: θ_max = arccos(-1/e); for parabola: π.
  const asymptote = e > 1.0001 ? Math.acos(Math.max(-1, -1 / e)) : Math.PI;
  // Further cap the angle so r never exceeds maxR.
  let thetaCap = asymptote * 0.97;
  if (e > 1e-6) {
    const cosAtMax = (p / maxR - 1) / e;
    if (cosAtMax >= -1 && cosAtMax <= 1) {
      thetaCap = Math.min(thetaCap, Math.acos(cosAtMax));
    }
  }

  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const theta = -thetaCap + (2 * thetaCap * i) / SEGMENTS;
    const denom = 1 + e * Math.cos(theta);
    if (denom <= 0.01) continue;
    const rr = p / denom;
    points.push(
      body.center.clone()
        .addScaledVector(pHat, rr * Math.cos(theta))
        .addScaledVector(qHat, rr * Math.sin(theta)),
    );
  }

  if (points.length < 4) return null;
  return { points, apoAlt: Infinity, periAlt: rp - body.radius };
}
