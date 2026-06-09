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
  private material: THREE.LineDashedMaterial;

  constructor(scene: THREE.Scene, bodies: Body[]) {
    // A soft dashed lane reads as an orbit guide without the harsh dotted ring
    // the old solid-line + points overlay produced.
    this.material = new THREE.LineDashedMaterial({
      color: 0x7ea6d8,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      fog: false,
      dashSize: 14,
      gapSize: 10,
    });
    for (const b of bodies) {
      if (!b.orbit) continue;
      const segs = 256;
      const pts: THREE.Vector3[] = [];
      // Close the loop explicitly so the dash pattern wraps cleanly.
      for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(t) * b.orbit.radius, Math.sin(t) * b.orbit.radius, 0));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mesh = new THREE.LineLoop(geo, this.material);
      mesh.computeLineDistances();
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
