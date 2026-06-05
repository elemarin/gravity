import * as THREE from 'three';
import { Body, SUN_ID } from '../bodies';

/**
 * Faint orbit rings for every orbiting body, drawn in the x-y plane. Planet
 * rings sit at the Sun (origin); moon rings ride along with their parent planet,
 * so they're repositioned each frame from the live body set.
 */
export class OrbitRings {
  private group = new THREE.Group();
  private rings: { mesh: THREE.LineLoop; parentId: string }[] = [];
  private material: THREE.LineBasicMaterial;

  constructor(scene: THREE.Scene, bodies: Body[]) {
    this.material = new THREE.LineBasicMaterial({
      color: 0x6f8bb5, transparent: true, opacity: 0.28, depthWrite: false, fog: false,
    });
    for (const b of bodies) {
      if (!b.orbit) continue;
      const segs = 192;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(t) * b.orbit.radius, Math.sin(t) * b.orbit.radius, 0));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mesh = new THREE.LineLoop(geo, this.material);
      this.rings.push({ mesh, parentId: b.orbit.parentId });
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  /** Re-centre each ring on its (moving) parent body. */
  update(bodies: Body[]) {
    for (const r of this.rings) {
      if (r.parentId === SUN_ID) continue; // planet rings stay at the origin
      const parent = bodies.find((b) => b.id === r.parentId);
      if (parent) r.mesh.position.copy(parent.center);
    }
  }

  dispose() {
    for (const r of this.rings) r.mesh.geometry.dispose();
    this.material.dispose();
  }
}
