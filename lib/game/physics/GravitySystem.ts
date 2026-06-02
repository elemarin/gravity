import * as THREE from 'three';
import { EARTH_CENTER, EARTH_RADIUS, GM } from '../constants';

export class GravitySystem {
  /** Returns acceleration vector (units/s²) toward Earth center for a given world position. */
  getAcceleration(position: THREE.Vector3): THREE.Vector3 {
    const toCenter = new THREE.Vector3().subVectors(EARTH_CENTER, position);
    const distSq = toCenter.lengthSq();
    const dist = Math.sqrt(distSq);

    // Clamp minimum distance to Earth radius to avoid singularity
    const effectiveDist = Math.max(dist, EARTH_RADIUS);
    const effectiveDistSq = effectiveDist * effectiveDist;

    const magnitude = GM / effectiveDistSq;
    return toCenter.normalize().multiplyScalar(magnitude);
  }

  /** Returns altitude above Earth surface (km / THREE units). */
  getAltitude(position: THREE.Vector3): number {
    const dist = position.distanceTo(EARTH_CENTER);
    return Math.max(0, dist - EARTH_RADIUS);
  }
}
