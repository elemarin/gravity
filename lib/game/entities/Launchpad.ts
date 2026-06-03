import * as THREE from 'three';

/**
 * Visual launch pad. The deck top sits flush at the local surface (y = 0) so
 * the rocket — whose own origin is its engine base — rests neatly on it.
 */
export class Launchpad {
  readonly mesh: THREE.Group;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, surfaceCenter: THREE.Vector3, bodyCenter: THREE.Vector3) {
    this.scene = scene;
    this.mesh = new THREE.Group();

    const up = new THREE.Vector3().subVectors(surfaceCenter, bodyCenter).normalize();
    const m = (c: number, s = 16, emissive = 0x000000) =>
      new THREE.MeshPhongMaterial({ color: c, flatShading: true, shininess: s, emissive });

    // ── Concrete deck (top flush with y = 0) ──────────────────────────────
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.14, 6), m(0x8b93a6));
    deck.position.y = -0.07;
    this.mesh.add(deck);

    // Flame trench
    const trench = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.16, 12), m(0x14171f));
    trench.position.y = -0.05;
    this.mesh.add(trench);

    // Support legs
    const legMat = m(0x5a6478);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), legMat);
      leg.position.set(Math.cos(a) * 0.5, -0.32, Math.sin(a) * 0.5);
      this.mesh.add(leg);
    }

    // ── Launch tower ──────────────────────────────────────────────────────
    const towerMat = m(0x47536a);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.3, 0.07), towerMat);
    post.position.set(0.66, 0.65, 0);
    this.mesh.add(post);
    for (let i = 0; i < 3; i++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.04), towerMat);
      rung.position.set(0.5, 0.3 + i * 0.4, 0);
      this.mesh.add(rung);
    }

    // Floodlights — bright accents
    const lightMat = m(0xfff4c2, 30, 0x6a6020);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.05), lightMat);
      light.position.set(Math.cos(a) * 0.56, 0.02, Math.sin(a) * 0.56);
      this.mesh.add(light);
    }

    // Orient to the surface normal
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    this.mesh.position.copy(surfaceCenter);
    scene.add(this.mesh);
  }

  dispose() {
    this.mesh.traverse((obj: THREE.Object3D) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.scene.remove(this.mesh);
  }
}
