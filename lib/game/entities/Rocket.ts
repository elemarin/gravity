import * as THREE from 'three';
import { EARTH_CENTER, EARTH_RADIUS } from '../constants';
import { SIM_START_ALTITUDE } from '../SimSetup';
import { Flame, FxBursts } from './Flame';
import { RocketBuild } from '../types';
import { getStages } from '../BuildSpec';
import { getPart } from '../career/Parts';
import type { SimState } from '../plan/Simulator';

// Origin sits at the very base of the engine bell, so the rocket rests flush
// on the launch pad (no part dips below y = 0).
export const ROCKET_START_ALTITUDE = SIM_START_ALTITUDE;

const BODY_R = 0.18;          // main stack radius
const stagePalette = 0x2a3550;

/**
 * Visual rocket. All physics live in the deterministic {@link Simulator};
 * this entity renders the stack from the bottom up and follows the sim state
 * via {@link applyState} (position, aim, staging, flame).
 */
export class Rocket {
  mesh: THREE.Group;
  position: THREE.Vector3;
  angle = 0;
  throttle = 0;

  build: RocketBuild;

  /** Per-stage mesh groups, bottom-first; a lander (if any) is the last group. */
  private stageMeshes: THREE.Group[] = [];
  /** Local y-coordinate of each stage's engine base, bottom-first. */
  private stageBaseY: number[] = [];
  /** How many lower stages have already been dropped from the mesh. */
  private meshActiveStage = 0;

  private scene: THREE.Scene;
  private flame: Flame;
  private fx: FxBursts;
  private upCenter = EARTH_CENTER.clone();
  private parachute?: THREE.Group;
  private droppedStages: { group: THREE.Group; velocity: THREE.Vector3; spin: THREE.Vector3; age: number }[] = [];

  constructor(scene: THREE.Scene, build: RocketBuild) {
    this.scene = scene;
    this.build = build;
    this.position = new THREE.Vector3(0, EARTH_CENTER.y + EARTH_RADIUS + ROCKET_START_ALTITUDE, 0);
    this.mesh = this.buildMesh(build);
    scene.add(this.mesh);
    this.flame = new Flame(scene);
    this.fx = new FxBursts(scene);
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
    this.clearDroppedStages();
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
        this.detachStage(dropped, s.velocity, upCenter);
        this.mesh.remove(dropped);
      }
      this.meshActiveStage += 1;
    }

    this.syncMesh();
    if (this.parachute) this.parachute.visible = s.deployedParachute;
    this.updateDroppedStages(dt, upCenter);
    this.fx.update(dt);

    const fuel = s.stageFuel[s.activeStage] ?? 0;
    const { pos, dir } = this.getNozzleInfo();
    const engineId = this.build.stages?.[s.activeStage]?.engineId ?? 'engine-basic';
    this.flame.update(dt, pos, dir, fuel > 0 ? s.throttle : 0, engineId);
  }

  /** Local height of the full stack (units), used to auto-frame the pad view. */
  getHeight(): number {
    const box = new THREE.Box3().setFromObject(this.mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const h = Math.max(size.x, size.y, size.z);
    return Number.isFinite(h) && h > 0 ? h : 3;
  }

  emitStageBurst() {
    const up = new THREE.Vector3().subVectors(this.position, this.upCenter).normalize();
    this.fx.burst(this.position.clone().addScaledVector(up, 0.1), up.clone().negate(), 8, 0xffaa44, 1.0);
  }

  emitParachuteBurst() {
    const up = new THREE.Vector3().subVectors(this.position, this.upCenter).normalize();
    this.fx.burst(this.position.clone().addScaledVector(up, 1.0), up, 6, 0x9effd0, 0.7);
  }

  // ── Mesh construction (bottom-up from y = 0) ──────────────────────────────

  private buildMesh(build: RocketBuild): THREE.Group {
    const group = new THREE.Group();
    this.stageMeshes = [];
    this.stageBaseY = [];

    const stages = getStages(build);
    let y = 0;

    stages.forEach((stage, si) => {
      const stageGroup = new THREE.Group();
      const start = y;
      this.stageBaseY.push(start);

      // Engine bell
      const engine = getPart(stage.engineId);
      const bellColor = engine?.color ?? 0x9aa3b8;
      const bell = new THREE.Mesh(
        new THREE.CylinderGeometry(BODY_R * 0.7, BODY_R * 0.95, 0.28, 10),
        mat(bellColor, 30),
      );
      bell.position.y = y + 0.14;
      stageGroup.add(bell);
      // Nozzle lip
      const lip = new THREE.Mesh(
        new THREE.CylinderGeometry(BODY_R * 0.95, BODY_R * 0.78, 0.06, 10),
        mat(0x20242e, 10),
      );
      lip.position.y = y + 0.02;
      stageGroup.add(lip);
      y += 0.26;

      // Fuel tanks
      for (const tankId of stage.tankIds) {
        const tank = getPart(tankId);
        if (!tank) continue;
        const h = 0.34 + Math.min(tank.fuelCapacity / 320, 0.9);
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(BODY_R, BODY_R, h, 12),
          mat(tank.color, 18),
        );
        body.position.y = y + h / 2;
        stageGroup.add(body);
        // Band rings for a paneled look
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(BODY_R * 1.02, BODY_R * 1.02, 0.04, 12),
          mat(0xffffff, 40),
        );
        band.position.y = y + 0.04;
        stageGroup.add(band);
        y += h;
      }

      // Fins on the first stage
      if (si === 0) {
        for (let i = 0; i < 4; i++) {
          const fin = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.3, 0.2),
            mat(0xff7a3c, 20),
          );
          const a = (i / 4) * Math.PI * 2;
          fin.position.set(Math.cos(a) * (BODY_R + 0.04), start + 0.22, Math.sin(a) * (BODY_R + 0.04));
          fin.rotation.y = a;
          stageGroup.add(fin);
        }
      }

      // Interstage decoupler ring
      if (si < stages.length - 1 || build.landerId) {
        const ring = new THREE.Mesh(
          new THREE.CylinderGeometry(BODY_R * 0.96, BODY_R * 0.96, 0.06, 12),
          mat(stagePalette, 8),
        );
        ring.position.y = y + 0.03;
        stageGroup.add(ring);
        y += 0.06;
      }

      group.add(stageGroup);
      this.stageMeshes.push(stageGroup);

      // Strap-on boosters ride alongside the first stage and drop with it.
      if (si === 0) this.addBoosters(stageGroup, build, start, y);
    });

    // Lander forms an extra separable top "stage"
    if (build.landerId) {
      const lander = getPart(build.landerId);
      if (lander) {
        const landerGroup = new THREE.Group();
        this.stageBaseY.push(y);
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(BODY_R * 0.95, BODY_R * 0.8, 0.34, 8),
          mat(lander.color, 24),
        );
        body.position.y = y + 0.17;
        landerGroup.add(body);
        for (let i = 0; i < 3; i++) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 0.03), mat(0xb8bcc8, 12));
          const a = (i / 3) * Math.PI * 2;
          leg.position.set(Math.cos(a) * 0.16, y + 0.04, Math.sin(a) * 0.16);
          leg.rotation.z = Math.cos(a) * 0.4;
          leg.rotation.x = Math.sin(a) * 0.4;
          landerGroup.add(leg);
        }
        y += 0.36;
        group.add(landerGroup);
        this.stageMeshes.push(landerGroup);
      }
    }

    // Nose / payload
    const nose = getPart(build.noseId);
    if (nose) {
      if (nose.type === 'capsule') {
        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(BODY_R * 0.6, BODY_R, 0.4, 12),
          mat(nose.color, 30),
        );
        cap.position.y = y + 0.2;
        group.add(cap);
        if (nose.id === 'station-module' || nose.id === 'satellite-bus') {
          // Solar panels
          for (const sgn of [-1, 1]) {
            const panel = new THREE.Mesh(
              new THREE.BoxGeometry(0.5, 0.18, 0.01),
              mat(0x2b5cff, 60),
            );
            panel.position.set(sgn * 0.36, y + 0.2, 0);
            group.add(panel);
          }
        }
        y += 0.4;
      } else {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(BODY_R, 0.42, 12), mat(nose.color, 36));
        cone.position.y = y + 0.21;
        group.add(cone);
        y += 0.42;
      }
    }

    if (build.utilityIds?.includes('parachute')) {
      this.parachute = this.buildParachute(y + 0.5);
      this.parachute.visible = false;
      group.add(this.parachute);
    } else {
      this.parachute = undefined;
    }

    return group;
  }

  private addBoosters(stageGroup: THREE.Group, build: RocketBuild, startY: number, endY: number) {
    const ids = build.boosterIds ?? [];
    if (ids.length === 0) return;
    const h = Math.max(0.6, (endY - startY) * 0.92);
    const midY = startY + (endY - startY) * 0.5;
    ids.forEach((id, i) => {
      const part = getPart(id);
      const color = part?.color ?? 0xf2f2f5;
      const a = (i / ids.length) * Math.PI * 2 + Math.PI / 4;
      const off = BODY_R + 0.12;
      const bg = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, h, 8), mat(color, 18));
      body.position.y = midY;
      bg.add(body);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 8), mat(0xff7a3c, 24));
      cone.position.y = midY + h / 2 + 0.09;
      bg.add(cone);
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.1, 8), mat(0x20242e, 10));
      noz.position.y = midY - h / 2 - 0.05;
      bg.add(noz);
      bg.position.set(Math.cos(a) * off, 0, Math.sin(a) * off);
      stageGroup.add(bg);
    });
  }

  private buildParachute(y: number): THREE.Group {
    const chute = new THREE.Group();
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.58, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhongMaterial({
        color: 0xff8f4a, transparent: true, opacity: 0.85, flatShading: true, side: THREE.DoubleSide,
      }),
    );
    canopy.scale.y = 0.5;
    canopy.position.y = y;
    chute.add(canopy);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.5 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const pts = [
        new THREE.Vector3(Math.cos(a) * 0.48, y - 0.05, Math.sin(a) * 0.48),
        new THREE.Vector3(0, y - 0.7, 0),
      ];
      chute.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat.clone()));
    }
    return chute;
  }

  private getNozzleInfo(): { pos: THREE.Vector3; dir: THREE.Vector3 } {
    const up = new THREE.Vector3().subVectors(this.position, this.upCenter).normalize();
    // x-y plane tangent — matches the Simulator's thrust frame.
    const east = new THREE.Vector3(up.y, -up.x, 0);
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    east.normalize();
    const rad = THREE.MathUtils.degToRad(this.angle);
    const thrustUp = up.clone().multiplyScalar(Math.cos(rad)).addScaledVector(east, Math.sin(rad)).normalize();
    // Nozzle sits just below the base; exhaust streams opposite the thrust.
    const pos = this.position.clone().addScaledVector(thrustUp, 0.04);
    return { pos, dir: thrustUp.clone().negate() };
  }

  private syncMesh() {
    const up = new THREE.Vector3().subVectors(this.position, this.upCenter).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const tilt = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1), -THREE.MathUtils.degToRad(this.angle),
    );
    this.mesh.quaternion.copy(q).multiply(tilt);
    const activeBaseY = this.stageBaseY[this.meshActiveStage] ?? 0;
    const baseOffset = new THREE.Vector3(0, activeBaseY, 0).applyQuaternion(this.mesh.quaternion);
    this.mesh.position.copy(this.position).sub(baseOffset);
  }

  private detachStage(stage: THREE.Group, velocity: THREE.Vector3, upCenter: THREE.Vector3) {
    stage.updateWorldMatrix(true, true);
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    stage.matrixWorld.decompose(worldPos, worldQuat, worldScale);
    stage.position.copy(worldPos);
    stage.quaternion.copy(worldQuat);
    stage.scale.copy(worldScale);
    this.scene.add(stage);

    const up = new THREE.Vector3().subVectors(worldPos, upCenter).normalize();
    const side = new THREE.Vector3(-up.z, 0, up.x).normalize();
    const drift = side.multiplyScalar((Math.random() - 0.5) * 1.8).addScaledVector(up, -0.45);
    this.droppedStages.push({
      group: stage,
      velocity: velocity.clone().add(drift),
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
      age: 0,
    });
    this.emitStageBurst();
  }

  private updateDroppedStages(dt: number, upCenter: THREE.Vector3) {
    for (let i = this.droppedStages.length - 1; i >= 0; i--) {
      const d = this.droppedStages[i];
      d.age += dt;
      const toCenter = new THREE.Vector3().subVectors(upCenter, d.group.position).normalize();
      d.velocity.addScaledVector(toCenter, 0.35 * dt);
      d.group.position.addScaledVector(d.velocity, dt);
      d.group.rotation.x += d.spin.x * dt;
      d.group.rotation.y += d.spin.y * dt;
      d.group.rotation.z += d.spin.z * dt;
      if (d.age > 12) {
        this.scene.remove(d.group);
        this.disposeGroup(d.group);
        this.droppedStages.splice(i, 1);
      }
    }
  }

  private clearDroppedStages() {
    this.droppedStages.forEach((d) => {
      this.scene.remove(d.group);
      this.disposeGroup(d.group);
    });
    this.droppedStages = [];
  }

  private disposeGroup(group: THREE.Group) {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }

  private disposeMesh() { this.disposeGroup(this.mesh); }

  dispose() {
    this.flame.dispose();
    this.fx.dispose();
    this.clearDroppedStages();
    this.disposeMesh();
  }
}

function mat(color: number, shininess = 16): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({ color, flatShading: true, shininess });
}
