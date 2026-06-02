import * as THREE from 'three';
import { ATMOSPHERE_HEIGHT } from '../constants';

export class Atmosphere {
  /**
   * Returns drag deceleration vector (units/s²) for a body at the given altitude
   * moving with the given velocity vector.
   * Drag model: F = -0.5 * rho * v² * Cd * vHat
   * rho falls from 1.225 kg/m³ at sea level to 0 at ATMOSPHERE_HEIGHT.
   */
  getDragAcceleration(
    altitude: number,
    velocity: THREE.Vector3,
    crossSection: number = 0.01  // effective cross-section in km² (scaled)
  ): THREE.Vector3 {
    if (altitude >= ATMOSPHERE_HEIGHT) return new THREE.Vector3();

    const t = Math.max(0, 1 - altitude / ATMOSPHERE_HEIGHT);
    // Exponential-ish density falloff
    const rho = 1.225 * Math.pow(t, 3);
    const Cd = 0.5;

    const speedSq = velocity.lengthSq();
    if (speedSq < 1e-10) return new THREE.Vector3();

    const dragMag = 0.5 * rho * speedSq * Cd * crossSection;
    return velocity.clone().normalize().multiplyScalar(-dragMag);
  }
}
