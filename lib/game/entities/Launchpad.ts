import * as THREE from 'three';

/**
 * Visual launch pad — a concrete platform + support structure sitting at
 * the launch site. Purely decorative; no physics interaction.
 */
export class Launchpad {
  readonly mesh: THREE.Group;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, surfaceCenter: THREE.Vector3, bodyCenter: THREE.Vector3) {
    this.scene = scene;
    this.mesh = new THREE.Group();

    const up = new THREE.Vector3().subVectors(surfaceCenter, bodyCenter).normalize();

    // ── Concrete platform ──────────────────────────────────────────────────
    const platformGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.06, 16);
    const concreteMat = new THREE.MeshPhongMaterial({ color: 0x5a6070, flatShading: true });
    const platform = new THREE.Mesh(platformGeo, concreteMat);
    platform.position.y = 0.03; // sits flush with local y=0
    this.mesh.add(platform);

    // ── Center hole (exhaust channel) ─────────────────────────────────────
    const channelGeo = new THREE.CylinderGeometry(0.10, 0.12, 0.08, 12);
    const darkMat = new THREE.MeshPhongMaterial({ color: 0x1a1e25, flatShading: true });
    const channel = new THREE.Mesh(channelGeo, darkMat);
    channel.position.y = 0.0;
    this.mesh.add(channel);

    // ── Support legs (4x) ─────────────────────────────────────────────────
    const legMat = new THREE.MeshPhongMaterial({ color: 0x3a4455, flatShading: true });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const legGeo = new THREE.BoxGeometry(0.07, 0.5, 0.07);
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(Math.cos(a) * 0.42, -0.22, Math.sin(a) * 0.42);
      this.mesh.add(leg);

      // Diagonal brace
      const braceGeo = new THREE.BoxGeometry(0.04, 0.28, 0.04);
      const brace = new THREE.Mesh(braceGeo, legMat);
      brace.position.set(Math.cos(a) * 0.28, -0.04, Math.sin(a) * 0.28);
      brace.rotation.z = -Math.cos(a) * 0.5;
      brace.rotation.x = -Math.sin(a) * 0.5;
      this.mesh.add(brace);
    }

    // ── Launch tower arm (single side arm) ────────────────────────────────
    const towerMat = new THREE.MeshPhongMaterial({ color: 0x2d3a47, flatShading: true });

    // Vertical tower post
    const postGeo = new THREE.BoxGeometry(0.06, 1.2, 0.06);
    const post = new THREE.Mesh(postGeo, towerMat);
    post.position.set(0.62, 0.57, 0);
    this.mesh.add(post);

    // Horizontal arm
    const armGeo = new THREE.BoxGeometry(0.32, 0.05, 0.05);
    const arm = new THREE.Mesh(armGeo, towerMat);
    arm.position.set(0.46, 1.1, 0);
    this.mesh.add(arm);

    // ── Floodlights (small white boxes) ──────────────────────────────────
    const lightMat = new THREE.MeshPhongMaterial({ color: 0xeeeebb, flatShading: true, emissive: 0x555533 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const lightGeo = new THREE.BoxGeometry(0.06, 0.04, 0.04);
      const light = new THREE.Mesh(lightGeo, lightMat);
      light.position.set(Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5);
      this.mesh.add(light);
    }

    // ── Orient to surface normal ──────────────────────────────────────────
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    this.mesh.quaternion.copy(q);
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
