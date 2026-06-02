import * as THREE from 'three';
import { GravitySystem } from './physics/GravitySystem';
import { Atmosphere } from './physics/Atmosphere';
import { EARTH_CENTER, EARTH_RADIUS } from './constants';

export type Prediction = {
  points: THREE.Vector3[];
  impact: boolean;  // true if path intersects ground
  apoapsis: number; // max altitude reached (km)
  periapsis: number; // min altitude reached (km, can be negative if impact)
};

/**
 * Predicts the rocket's future trajectory by forward-integrating gravity + drag (no thrust).
 */
export class TrajectoryPredictor {
  constructor(
    private gravity: GravitySystem,
    private atmosphere: Atmosphere,
  ) {}

  predict(
    startPos: THREE.Vector3,
    startVel: THREE.Vector3,
    dragCoeff: number,
    dt = 1.0,
    steps = 800,
  ): Prediction {
    const pos = startPos.clone();
    const vel = startVel.clone();
    const points: THREE.Vector3[] = [pos.clone()];

    let apoapsis = this.gravity.getAltitude(pos);
    let periapsis = apoapsis;
    let impact = false;

    for (let i = 0; i < steps; i++) {
      const alt = this.gravity.getAltitude(pos);
      apoapsis  = Math.max(apoapsis, alt);
      periapsis = Math.min(periapsis, alt);

      if (alt <= 0) { impact = true; break; }

      const grav = this.gravity.getAcceleration(pos);
      const drag = this.atmosphere.getDragAcceleration(alt, vel, dragCoeff);

      // Semi-implicit Euler
      vel.add(grav.multiplyScalar(dt)).add(drag.multiplyScalar(dt));
      pos.addScaledVector(vel, dt);

      // Sample every other step for performance
      if (i % 2 === 0) points.push(pos.clone());
    }

    return { points, impact, apoapsis, periapsis };
  }
}
