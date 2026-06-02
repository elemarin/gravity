import * as THREE from 'three';
import { EARTH_CENTER, EARTH_RADIUS } from '../constants';
import { Exhaust } from './Exhaust';
import { RocketBuild, RocketStats } from '../types';
import { computeStats } from '../BuildSpec';
import { getPart } from '../career/Parts';

export const ROCKET_START_ALTITUDE = 0.05;
const ROTATE_SPEED = 90; // deg/s

export class Rocket {
  mesh: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angle: number;
  fuel: number;
  throttle: number;

  build: RocketBuild;
  stats: RocketStats;

  private scene: THREE.Scene;
  private exhaust: Exhaust;
  private rocketHeight = 2.0;

  constructor(scene: THREE.Scene, build: RocketBuild) {
    this.scene    = scene;
    this.build    = build;
    this.stats    = computeStats(build);
    this.fuel     = 100;
    this.throttle = 0;
    this.angle    = 0;
    this.velocity = new THREE.Vector3();
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
    this.stats = computeStats(build);
    this.mesh  = this.buildMesh(build);
    this.scene.add(this.mesh);
    this.syncMesh();
  }

  private buildMesh(build: RocketBuild): THREE.Group {
    const group = new THREE.Group();
    let y = -0.55; // start at engine

    const engine = getPart(build.engineId);
    if (engine) {
      const geo = new THREE.CylinderGeometry(0.12, 0.2, 0.3, 8);
      const mat = new THREE.MeshPhongMaterial({ color: engine.color, flatShading: true });
      const m   = new THREE.Mesh(geo, mat);
      m.position.y = y;
      group.add(m);
      y += 0.25;
    }

    // Tanks (one or more stacked)
    for (const tankId of build.tankIds) {
      const tank = getPart(tankId);
      if (!tank) continue;
      const h   = 0.4 + Math.min(tank.fuelCapacity / 200, 0.8);
      const geo = new THREE.CylinderGeometry(0.14, 0.14, h, 8);
      const mat = new THREE.MeshPhongMaterial({ color: tank.color, flatShading: true });
      const m   = new THREE.Mesh(geo, mat);
      m.position.y = y + h / 2;
      group.add(m);
      y += h;
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
      y += noseH;
    }

    // Fins (always include 3 fins near the engine)
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.BoxGeometry(0.04, 0.26, 0.16);
      const mat = new THREE.MeshPhongMaterial({ color: 0xcc4400, flatShading: true });
      const fin = new THREE.Mesh(geo, mat);
      const a   = (i / 3) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 0.16, -0.42, Math.sin(a) * 0.16);
      fin.rotation.y = a;
      group.add(fin);
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
    const fuelFrac = this.fuel / 100;
    return this.stats.dryMass + fuelFrac * (this.stats.wetMass - this.stats.dryMass);
  }

  /** Returns thrust acceleration vector (km/s²) — local up rotated by angle, away from Earth center. */
  getThrustAcceleration(): THREE.Vector3 {
    if (this.throttle < 0.01 || this.fuel <= 0 || this.stats.thrust <= 0) {
      return new THREE.Vector3();
    }
    // Local "up" = away from Earth center
    const up = new THREE.Vector3().subVectors(this.position, EARTH_CENTER).normalize();
    const east = new THREE.Vector3(-up.z, 0, up.x).normalize();
    if (east.lengthSq() < 0.01) east.set(1, 0, 0);

    const rad = THREE.MathUtils.degToRad(this.angle);
    const dir = up.clone()
      .multiplyScalar(Math.cos(rad))
      .addScaledVector(east, Math.sin(rad))
      .normalize();

    // Thrust (kN) / mass (tonnes) = m/s² → /1000 to km/s²
    const accelMs = (this.stats.thrust * this.throttle) / Math.max(this.mass, 0.001);
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

  update(dt: number) {
    if (this.throttle > 0.01 && this.fuel > 0 && this.stats.burnRate > 0) {
      const burnedL = this.stats.burnRate * this.throttle * dt;
      const fuelDelta = (burnedL / Math.max(this.stats.fuelCapacity, 1)) * 100;
      this.fuel = Math.max(0, this.fuel - fuelDelta);
      if (this.fuel <= 0) this.throttle = 0;
    }
    this.syncMesh();
    const { pos, dir } = this.getNozzleInfo();
    this.exhaust.update(dt, pos, dir, this.fuel > 0 ? this.throttle : 0);
  }

  reset() {
    this.position.set(0, EARTH_CENTER.y + EARTH_RADIUS + ROCKET_START_ALTITUDE, 0);
    this.velocity.set(0, 0, 0);
    this.angle    = 0;
    this.fuel     = 100;
    this.throttle = 0;
    this.syncMesh();
  }

  private syncMesh() {
    this.mesh.position.copy(this.position);
    // Orient mesh so local +Y faces away from Earth center, then rotate by `angle` around perpendicular axis
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
