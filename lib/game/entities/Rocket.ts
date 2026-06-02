import * as THREE from 'three';
import { EARTH_CENTER, EARTH_RADIUS } from '../constants';
import { Exhaust } from './Exhaust';
import { RocketBuild } from '../types';
import { getStages } from '../BuildSpec';
import { getPart } from '../career/Parts';
import type { SimState } from '../plan/Simulator';

export const ROCKET_START_ALTITUDE = 0.05;

/**
 * Visual rocket. In Gravity 2.0 all physics live in the deterministic
 * {@link Simulator}; this entity only renders the stack and follows the
 * sim state via {@link applyState} (position, aim, staging, exhaust).
 */
export class Rocket {
  mesh: THREE.Group;
  position: THREE.Vector3;
  angle = 0;
  throttle = 0;

  build: RocketBuild;

  /** Per-stage mesh groups, bottom-first; a lander (if any) is the last group. */
  private stageMeshes: THREE.Group[] = [];
  /** How many lower stages have already been dropped from the mesh. */
  private meshActiveStage = 0;

  private scene: THREE.Scene;
  private exhaust: Exhaust;
  private upCenter = EARTH_CENTER.clone();

  constructor(scene: THREE.Scene, build: RocketBuild) {
    this.scene = scene;
    this.build = build;
    this.position = new THREE.Vector3(0, EARTH_CENTER.y + EARTH_RADIUS + ROCKET_START_ALTITUDE, 0);
    this.mesh = this.buildMesh(build);
    scene.add(this.mesh);
    this.exhaust = new Exhaust(scene);
    this.syncMesh();
  }

  setBuild(build: RocketBuild) {
    this.scene.remove(this.mesh);
    this.disposeMesh();
    this.build = build;
    this.meshActiveStage = 0;
    this.mesh = this.buildMesh(build);
    this.scene.add(this.mesh);
    this.syncMesh();
  }

  /** Reset the stack so previously-dropped stages return. */
  reset(startPosition: THREE.Vector3) {
    this.position.copy(startPosition);
    this.angle = 0;
    this.throttle = 0;
    this.scene.remove(this.mesh);
    this.disposeMesh();
    this.meshActiveStage = 0;
    this.mesh = this.buildMesh(this.build);
    this.scene.add(this.mesh);
    this.syncMesh();
  }

  /** Drive the visual rocket from the deterministic simulation state. */
  applyState(s: SimState, upCenter: THREE.Vector3, dt: number) {
    this.upCenter.copy(upCenter);
    this.position.copy(s.position);
    this.angle = s.angle;
    this.throttle = s.throttle;

    while (this.meshActiveStage < s.activeStage) {
      const dropped = this.stageMeshes[this.meshActiveStage];
      if (dropped) {
        this.mesh.remove(dropped);
        this.disposeGroup(dropped);
      }
      this.meshActiveStage += 1;
    }

    this.syncMesh();
    const fuel = s.stageFuel[s.activeStage] ?? 0;
    const { pos, dir } = this.getNozzleInfo();
    this.exhaust.update(dt, pos, dir, fuel > 0 ? s.throttle : 0);
  }

  private buildMesh(build: RocketBuild): THREE.Group {
    const group = new THREE.Group();
    this.stageMeshes = [];
    let y = -0.55;

    const stages = getStages(build);
    stages.forEach((stage, si) => {
      const stageGroup = new THREE.Group();

      const engine = getPart(stage.engineId);
      if (engine) {
        const geo = new THREE.CylinderGeometry(0.12, 0.2, 0.3, 8);
        const mat = new THREE.MeshPhongMaterial({ color: engine.color, flatShading: true });
        const m = new THREE.Mesh(geo, mat);
        m.position.y = y;
        stageGroup.add(m);
        y += 0.25;
      }

      for (const tankId of stage.tankIds) {
        const tank = getPart(tankId);
        if (!tank) continue;
        const h = 0.4 + Math.min(tank.fuelCapacity / 200, 0.8);
        const geo = new THREE.CylinderGeometry(0.14, 0.14, h, 8);
        const mat = new THREE.MeshPhongMaterial({ color: tank.color, flatShading: true });
        const m = new THREE.Mesh(geo, mat);
        m.position.y = y + h / 2;
        stageGroup.add(m);
        y += h;
      }

      if (si === 0) {
        for (let i = 0; i < 3; i++) {
          const geo = new THREE.BoxGeometry(0.04, 0.26, 0.16);
          const mat = new THREE.MeshPhongMaterial({ color: 0xcc4400, flatShading: true });
          const fin = new THREE.Mesh(geo, mat);
          const a = (i / 3) * Math.PI * 2;
          fin.position.set(Math.cos(a) * 0.16, -0.42, Math.sin(a) * 0.16);
          fin.rotation.y = a;
          stageGroup.add(fin);
        }
      }

      if (si < stages.length - 1 || build.landerId) {
        const geo = new THREE.CylinderGeometry(0.145, 0.145, 0.05, 8);
        const mat = new THREE.MeshPhongMaterial({ color: 0x222230, flatShading: true });
        const m = new THREE.Mesh(geo, mat);
        m.position.y = y + 0.025;
        stageGroup.add(m);
        y += 0.05;
      }

      group.add(stageGroup);
      this.stageMeshes.push(stageGroup);
    });

    // Lander forms an extra separable top "stage".
    if (build.landerId) {
      const lander = getPart(build.landerId);
      if (lander) {
        const landerGroup = new THREE.Group();
        const bodyGeo = new THREE.CylinderGeometry(0.16, 0.13, 0.32, 8);
        const bodyMat = new THREE.MeshPhongMaterial({ color: lander.color, flatShading: true });
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        bodyMesh.position.y = y + 0.16;
        landerGroup.add(bodyMesh);
        for (let i = 0; i < 3; i++) {
          const legGeo = new THREE.BoxGeometry(0.03, 0.22, 0.03);
          const legMat = new THREE.MeshPhongMaterial({ color: 0x999999, flatShading: true });
          const leg = new THREE.Mesh(legGeo, legMat);
          const a = (i / 3) * Math.PI * 2;
          leg.position.set(Math.cos(a) * 0.15, y + 0.02, Math.sin(a) * 0.15);
          leg.rotation.z = Math.cos(a) * 0.4;
          leg.rotation.x = Math.sin(a) * 0.4;
          landerGroup.add(leg);
        }
        y += 0.34;
        group.add(landerGroup);
        this.stageMeshes.push(landerGroup);
      }
    }

    const nose = getPart(build.noseId);
    if (nose) {
      const noseH = nose.type === 'capsule' ? 0.4 : 0.35;
      const noseGeo = nose.type === 'capsule'
        ? new THREE.CylinderGeometry(0.10, 0.14, noseH, 8)
        : new THREE.ConeGeometry(0.12, noseH, 8);
      const noseMat = new THREE.MeshPhongMaterial({ color: nose.color, flatShading: true });
      const m = new THREE.Mesh(noseGeo, noseMat);
      m.position.y = y + noseH / 2;
      group.add(m);
    }

    return group;
  }

  private getNozzleInfo(): { pos: THREE.Vector3; dir: THREE.Vector3 } {
    const up = new THREE.Vector3().subVectors(this.position, this.upCenter).normalize();
    const east = new THREE.Vector3(-up.z, 0, up.x);
    if (east.lengthSq() < 0.01) east.set(1, 0, 0);
    east.normalize();
    const rad = THREE.MathUtils.degToRad(this.angle);
    const thrustUp = up.clone().multiplyScalar(Math.cos(rad)).addScaledVector(east, Math.sin(rad)).normalize();
    const pos = this.position.clone().addScaledVector(thrustUp, -0.55);
    return { pos, dir: thrustUp.clone().negate() };
  }

  private syncMesh() {
    this.mesh.position.copy(this.position);
    const up = new THREE.Vector3().subVectors(this.position, this.upCenter).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const tilt = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      -THREE.MathUtils.degToRad(this.angle),
    );
    this.mesh.quaternion.copy(q).multiply(tilt);
  }

  private disposeGroup(group: THREE.Group) {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }

  private disposeMesh() {
    this.disposeGroup(this.mesh);
  }

  dispose() {
    this.exhaust.dispose();
    this.disposeMesh();
  }
}
