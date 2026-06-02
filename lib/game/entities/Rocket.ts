import * as THREE from 'three';
import { EARTH_CENTER, EARTH_RADIUS } from '../constants';
import { Exhaust } from './Exhaust';
import { RocketBuild, RocketStats } from '../types';
import { computeStats, getStages, computeStageStats, payloadDryMass, StageStats } from '../BuildSpec';
import { getPart } from '../career/Parts';

export const ROCKET_START_ALTITUDE = 0.05;
const ROTATE_SPEED = 90; // deg/s

export class Rocket {
  mesh: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angle: number;
  throttle: number;

  build: RocketBuild;
  stats: RocketStats;

  /** Per-stage stats, ordered bottom-first (index 0 fires first). */
  private stageStats: StageStats[] = [];
  /** Per-stage fuel as a 0-100 percentage of that stage's capacity. */
  private stageFuel: number[] = [];
  /** Index of the stage currently firing. */
  activeStage = 0;
  private payloadMass = 0;
  private stageMeshes: THREE.Group[] = [];

  private scene: THREE.Scene;
  private exhaust: Exhaust;
  private rocketHeight = 2.0;

  constructor(scene: THREE.Scene, build: RocketBuild) {
    this.scene    = scene;
    this.build    = build;
    this.stats    = computeStats(build);
    this.throttle = 0;
    this.angle    = 0;
    this.velocity = new THREE.Vector3();
    this.position = new THREE.Vector3(0, EARTH_CENTER.y + EARTH_RADIUS + ROCKET_START_ALTITUDE, 0);

    this.initStages(build);
    this.mesh = this.buildMesh(build);
    scene.add(this.mesh);

    this.exhaust = new Exhaust(scene);
    this.syncMesh();
  }

  private initStages(build: RocketBuild) {
    this.stageStats = getStages(build).map(computeStageStats);
    this.stageFuel  = this.stageStats.map(() => 100);
    this.payloadMass = payloadDryMass(build);
    this.activeStage = 0;
  }

  setBuild(build: RocketBuild) {
    this.scene.remove(this.mesh);
    this.disposeMesh();
    this.build = build;
    this.stats = computeStats(build);
    this.initStages(build);
    this.mesh  = this.buildMesh(build);
    this.scene.add(this.mesh);
    this.syncMesh();
  }

  /** Active stage fuel as a 0-100 percentage (drives the fuel HUD). */
  get fuel(): number {
    return this.stageFuel[this.activeStage] ?? 0;
  }

  get stageCount(): number { return this.stageStats.length; }

  /** True when there is a lower/spent stage to jettison (an upper stage exists). */
  get canStage(): boolean {
    return this.activeStage < this.stageStats.length - 1;
  }

  /** True when the rocket can no longer produce thrust and cannot stage. */
  get isSpent(): boolean {
    return !this.canStage && this.fuel <= 0.01;
  }

  /** Total fuel mass (tonnes) still aboard across all remaining stages. */
  private get remainingFuelMass(): number {
    let m = 0;
    for (let i = this.activeStage; i < this.stageStats.length; i++) {
      m += this.stageStats[i].fuelMass * (this.stageFuel[i] / 100);
    }
    return m;
  }

  private buildMesh(build: RocketBuild): THREE.Group {
    const group = new THREE.Group();
    this.stageMeshes = [];
    let y = -0.55; // start at first engine

    const stages = getStages(build);
    stages.forEach((stage, si) => {
      const stageGroup = new THREE.Group();

      const engine = getPart(stage.engineId);
      if (engine) {
        const geo = new THREE.CylinderGeometry(0.12, 0.2, 0.3, 8);
        const mat = new THREE.MeshPhongMaterial({ color: engine.color, flatShading: true });
        const m   = new THREE.Mesh(geo, mat);
        m.position.y = y;
        stageGroup.add(m);
        y += 0.25;
      }

      for (const tankId of stage.tankIds) {
        const tank = getPart(tankId);
        if (!tank) continue;
        const h   = 0.4 + Math.min(tank.fuelCapacity / 200, 0.8);
        const geo = new THREE.CylinderGeometry(0.14, 0.14, h, 8);
        const mat = new THREE.MeshPhongMaterial({ color: tank.color, flatShading: true });
        const m   = new THREE.Mesh(geo, mat);
        m.position.y = y + h / 2;
        stageGroup.add(m);
        y += h;
      }

      // Fins on the very first (bottom) stage only.
      if (si === 0) {
        for (let i = 0; i < 3; i++) {
          const geo = new THREE.BoxGeometry(0.04, 0.26, 0.16);
          const mat = new THREE.MeshPhongMaterial({ color: 0xcc4400, flatShading: true });
          const fin = new THREE.Mesh(geo, mat);
          const a   = (i / 3) * Math.PI * 2;
          fin.position.set(Math.cos(a) * 0.16, -0.42, Math.sin(a) * 0.16);
          fin.rotation.y = a;
          stageGroup.add(fin);
        }
      }

      // Thin interstage marker between stacked stages.
      if (si < stages.length - 1) {
        const geo = new THREE.CylinderGeometry(0.145, 0.145, 0.05, 8);
        const mat = new THREE.MeshPhongMaterial({ color: 0x222230, flatShading: true });
        const m   = new THREE.Mesh(geo, mat);
        m.position.y = y + 0.025;
        stageGroup.add(m);
        y += 0.05;
      }

      group.add(stageGroup);
      this.stageMeshes.push(stageGroup);
    });

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
      y += noseH;
    }

    this.rocketHeight = Math.max(1.0, y + 0.55);
    return group;
  }

  private disposeMesh() {
    this.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }

  get mass(): number {
    let dry = this.payloadMass;
    for (let i = this.activeStage; i < this.stageStats.length; i++) {
      dry += this.stageStats[i].dryMass;
    }
    return dry + this.remainingFuelMass;
  }

  private get activeThrust(): number {
    return this.stageStats[this.activeStage]?.thrust ?? 0;
  }

  private get activeBurnRate(): number {
    return this.stageStats[this.activeStage]?.burnRate ?? 0;
  }

  /** Returns thrust acceleration vector (km/s²) — local up rotated by angle, away from Earth center. */
  getThrustAcceleration(): THREE.Vector3 {
    if (this.throttle < 0.01 || this.fuel <= 0 || this.activeThrust <= 0) {
      return new THREE.Vector3();
    }
    const up = new THREE.Vector3().subVectors(this.position, EARTH_CENTER).normalize();
    const east = new THREE.Vector3(-up.z, 0, up.x).normalize();
    if (east.lengthSq() < 0.01) east.set(1, 0, 0);

    const rad = THREE.MathUtils.degToRad(this.angle);
    const dir = up.clone()
      .multiplyScalar(Math.cos(rad))
      .addScaledVector(east, Math.sin(rad))
      .normalize();

    const accelMs = (this.activeThrust * this.throttle) / Math.max(this.mass, 0.001);
    const accelKm = accelMs / 1000;
    return dir.multiplyScalar(accelKm);
  }

  getNozzleInfo(): { pos: THREE.Vector3; dir: THREE.Vector3 } {
    const up = new THREE.Vector3().subVectors(this.position, EARTH_CENTER).normalize();
    const east = new THREE.Vector3(-up.z, 0, up.x).normalize();
    if (east.lengthSq() < 0.01) east.set(1, 0, 0);
    const rad = THREE.MathUtils.degToRad(this.angle);
    const thrustUp = up.clone()
      .multiplyScalar(Math.cos(rad))
      .addScaledVector(east, Math.sin(rad))
      .normalize();
    const pos = this.position.clone().addScaledVector(thrustUp, -0.55);
    return { pos, dir: thrustUp.clone().negate() };
  }

  applyThrustDelta(delta: number) {
    this.throttle = THREE.MathUtils.clamp(this.throttle + delta, 0, 1);
  }

  rotate(direction: number, dt: number) {
    this.angle += direction * ROTATE_SPEED * dt;
    this.angle = THREE.MathUtils.clamp(this.angle, -90, 90);
  }

  /** Jettison the active (spent) stage and ignite the next one. Returns true if a stage separated. */
  stage(): boolean {
    if (!this.canStage) return false;
    const dropped = this.stageMeshes[this.activeStage];
    if (dropped) {
      this.mesh.remove(dropped);
      dropped.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    }
    this.activeStage += 1;
    return true;
  }

  update(dt: number) {
    if (this.throttle > 0.01 && this.fuel > 0 && this.activeBurnRate > 0) {
      const cap = Math.max(this.stageStats[this.activeStage]?.fuelCapacity ?? 1, 1);
      const burnedL = this.activeBurnRate * this.throttle * dt;
      const fuelDelta = (burnedL / cap) * 100;
      this.stageFuel[this.activeStage] = Math.max(0, this.fuel - fuelDelta);
      if (this.fuel <= 0 && !this.canStage) this.throttle = 0;
    }
    this.syncMesh();
    const { pos, dir } = this.getNozzleInfo();
    this.exhaust.update(dt, pos, dir, this.fuel > 0 ? this.throttle : 0);
  }

  reset() {
    this.position.set(0, EARTH_CENTER.y + EARTH_RADIUS + ROCKET_START_ALTITUDE, 0);
    this.velocity.set(0, 0, 0);
    this.angle    = 0;
    this.throttle = 0;
    // Rebuild the stack so previously-jettisoned stages return.
    this.scene.remove(this.mesh);
    this.disposeMesh();
    this.initStages(this.build);
    this.mesh = this.buildMesh(this.build);
    this.scene.add(this.mesh);
    this.syncMesh();
  }

  private syncMesh() {
    this.mesh.position.copy(this.position);
    const up = new THREE.Vector3().subVectors(this.position, EARTH_CENTER).normalize();
    const q  = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const tilt = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      -THREE.MathUtils.degToRad(this.angle)
    );
    this.mesh.quaternion.copy(q).multiply(tilt);
  }

  dispose() {
    this.exhaust.dispose();
    this.disposeMesh();
  }
}
