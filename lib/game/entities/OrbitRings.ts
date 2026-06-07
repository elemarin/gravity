import * as THREE from 'three';
import { Body, SUN_ID } from '../bodies';

/**
 * Faint orbit rings for every orbiting body, drawn in the x-y plane. Planet
 * rings sit at the Sun (origin); moon rings ride along with their parent planet,
 * so they're repositioned each frame from the live body set.
 */
export class OrbitRings {
  private group = new THREE.Group();
  private rings: { mesh: THREE.LineLoop; points?: THREE.Points; parentId: string }[] = [];
  private material: THREE.LineBasicMaterial;
  private pointsMaterial: THREE.PointsMaterial;

  constructor(scene: THREE.Scene, bodies: Body[]) {
    this.material = new THREE.LineBasicMaterial({
      color: 0x6f8bb5, transparent: true, opacity: 0.28, depthWrite: false, fog: false,
    });
    this.pointsMaterial = new THREE.PointsMaterial({
      color: 0x6f8bb5,
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      fog: false,
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
      const points = new THREE.Points(geo, this.pointsMaterial);
      this.rings.push({ mesh, points, parentId: b.orbit.parentId });
      this.group.add(mesh, points);
    }
    scene.add(this.group);
  }

  /** Re-centre each ring on its (moving) parent body. */
  update(bodies: Body[]) {
    for (const r of this.rings) {
      if (r.parentId === SUN_ID) continue; // planet rings stay at the origin
      const parent = bodies.find((b) => b.id === r.parentId);
      if (parent) {
        r.mesh.position.copy(parent.center);
        if (r.points) r.points.position.copy(parent.center);
      }
    }
  }

  dispose() {
    for (const r of this.rings) r.mesh.geometry.dispose();
    this.material.dispose();
    this.pointsMaterial.dispose();
  }
}
