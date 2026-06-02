import * as THREE from 'three';

const MAX_POINTS = 500;

export class TrajectoryLine {
  line: THREE.Line;
  private positions: Float32Array;
  private geometry: THREE.BufferGeometry;
  private material: THREE.LineBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(MAX_POINTS * 3);
    this.geometry  = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.6,
    });

    this.line = new THREE.Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);
  }

  update(points: THREE.Vector3[], color = 0x00e5ff) {
    const n = Math.min(points.length, MAX_POINTS);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      this.positions[i * 3]     = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
    }
    this.geometry.setDrawRange(0, n);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.material.color.setHex(color);
    this.line.visible = n > 1;
  }

  setVisible(v: boolean) { this.line.visible = v; }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
