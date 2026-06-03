import * as THREE from 'three';

// Ring buffer of past rocket positions, drawn as a faint line so the player
// can see where they've actually flown. Separate from the forward-predicted
// trajectory line, which is constantly recomputed from the current state.
const MAX_POINTS = 4000;
// Drop intermediate samples that are visually identical to the previous one
// (keeps the buffer dense around maneuvers and sparse on long coasts).
const MIN_SEGMENT_KM = 0.4;

export class TrailLine {
  line: THREE.Line;
  private positions: Float32Array;
  private geometry: THREE.BufferGeometry;
  private material: THREE.LineBasicMaterial;
  private count = 0;
  private head = 0;
  private last = new THREE.Vector3();
  private hasLast = false;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(MAX_POINTS * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
    });

    this.line = new THREE.Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);
  }

  reset() {
    this.count = 0;
    this.head = 0;
    this.hasLast = false;
    this.geometry.setDrawRange(0, 0);
    this.line.visible = false;
  }

  setVisible(v: boolean) {
    this.line.visible = v && this.count > 1;
  }

  /**
   * Append the current rocket position. The buffer is a ring; once full,
   * the oldest samples are overwritten. Drawing order is reconstructed each
   * call by rotating the head to the front of the GPU buffer.
   */
  push(pos: THREE.Vector3) {
    if (this.hasLast && pos.distanceToSquared(this.last) < MIN_SEGMENT_KM * MIN_SEGMENT_KM) {
      return;
    }
    this.last.copy(pos);
    this.hasLast = true;

    if (this.count < MAX_POINTS) {
      const i = this.count * 3;
      this.positions[i] = pos.x;
      this.positions[i + 1] = pos.y;
      this.positions[i + 2] = pos.z;
      this.count += 1;
      this.geometry.setDrawRange(0, this.count);
      this.geometry.attributes.position.needsUpdate = true;
      this.line.visible = this.count > 1;
      return;
    }

    // Buffer full: shift the array forward by one slot and append to the end.
    // The drawn line stays in chronological order, oldest sample first.
    this.positions.copyWithin(0, 3, MAX_POINTS * 3);
    const tail = (MAX_POINTS - 1) * 3;
    this.positions[tail] = pos.x;
    this.positions[tail + 1] = pos.y;
    this.positions[tail + 2] = pos.z;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.setDrawRange(0, MAX_POINTS);
    this.line.visible = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
