import * as THREE from 'three';
import { EARTH_CENTER, EARTH_RADIUS } from '../constants';
import { Exhaust } from './Exhaust';

export const ROCKET_START_ALTITUDE = 0.05; // just above surface

// Thrust in km/s² (scaled units), fuel burn rate per second
const THRUST_FORCE   = 0.045;  // km/s² per unit throttle
const FUEL_BURN_RATE = 12;     // % fuel per second at full throttle
const ROTATE_SPEED   = 90;     // degrees per second
const DRY_MASS       = 1.0;
const WET_MASS       = 4.0;    // full fuel mass

export class Rocket {
  mesh: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angle: number;         // degrees from vertical (0 = straight up)
  fuel: number;          // 0–100
  throttle: number;      // 0–1
  private exhaust: Exhaust;

  constructor(scene: THREE.Scene) {
    // Start on surface
    const surfaceY = EARTH_CENTER.y + EARTH_RADIUS + ROCKET_START_ALTITUDE;
    this.position = new THREE.Vector3(0, surfaceY, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.angle    = 0;
    this.fuel     = 100;
    this.throttle = 0;

    this.mesh  = this.buildMesh();
    scene.add(this.mesh);

    this.exhaust = new Exhaust(scene);
    this.syncMesh();
  }

  private buildMesh(): THREE.Group {
    const group = new THREE.Group();

    // Engine bell (cone at bottom)
    const engineGeo = new THREE.CylinderGeometry(0.12, 0.2, 0.3, 6);
    const engineMat = new THREE.MeshPhongMaterial({ color: 0x888899, flatShading: true });
    const engine = new THREE.Mesh(engineGeo, engineMat);
    engine.position.y = -0.55;
    group.add(engine);

    // Fuel tank body (main cylinder)
    const tankGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.8, 6);
    const tankMat = new THREE.MeshPhongMaterial({ color: 0xff7700, flatShading: true });
    const tank = new THREE.Mesh(tankGeo, tankMat);
    tank.position.y = -0.1;
    group.add(tank);

    // Upper stage / second section
    const upperGeo = new THREE.CylinderGeometry(0.10, 0.14, 0.4, 6);
    const upperMat = new THREE.MeshPhongMaterial({ color: 0xff9933, flatShading: true });
    const upper = new THREE.Mesh(upperGeo, upperMat);
    upper.position.y = 0.5;
    group.add(upper);

    // Nose cone
    const noseGeo = new THREE.ConeGeometry(0.10, 0.35, 6);
    const noseMat = new THREE.MeshPhongMaterial({ color: 0xeeeeff, flatShading: true });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.y = 0.875;
    group.add(nose);

    // Fins (4x small triangular boxes)
    for (let i = 0; i < 4; i++) {
      const finGeo = new THREE.BoxGeometry(0.04, 0.28, 0.18);
      const finMat = new THREE.MeshPhongMaterial({ color: 0xcc4400, flatShading: true });
      const fin = new THREE.Mesh(finGeo, finMat);
      const angle = (i / 4) * Math.PI * 2;
      fin.position.set(
        Math.cos(angle) * 0.18,
        -0.48,
        Math.sin(angle) * 0.18
      );
      fin.rotation.y = angle;
      group.add(fin);
    }

    return group;
  }

  get mass(): number {
    return DRY_MASS + (this.fuel / 100) * (WET_MASS - DRY_MASS);
  }

  /** Returns thrust acceleration vector in world space. */
  getThrustAcceleration(): THREE.Vector3 {
    if (this.throttle < 0.01 || this.fuel <= 0) return new THREE.Vector3();

    const angleRad = THREE.MathUtils.degToRad(this.angle);
    // Thrust direction: angled from vertical toward +x
    const dir = new THREE.Vector3(
      Math.sin(angleRad),
      Math.cos(angleRad),
      0
    );
    return dir.multiplyScalar(THRUST_FORCE * this.throttle);
  }

  /** Returns the nozzle world position and exhaust direction. */
  getNozzleInfo(): { pos: THREE.Vector3; dir: THREE.Vector3 } {
    const angleRad = THREE.MathUtils.degToRad(this.angle);
    const thrustUp = new THREE.Vector3(Math.sin(angleRad), Math.cos(angleRad), 0);
    // Nozzle is below rocket center along the thrust axis
    const pos = this.position.clone().addScaledVector(thrustUp, -0.65);
    // Exhaust exits opposite to thrust (downward)
    const dir = thrustUp.clone().negate();
    return { pos, dir };
  }

  applyThrust(throttleDelta: number) {
    this.throttle = THREE.MathUtils.clamp(this.throttle + throttleDelta, 0, 1);
  }

  rotate(direction: number, dt: number) {
    this.angle += direction * ROTATE_SPEED * dt;
    this.angle = THREE.MathUtils.clamp(this.angle, -85, 85);
  }

  update(dt: number) {
    // Burn fuel
    if (this.throttle > 0.01 && this.fuel > 0) {
      this.fuel = Math.max(0, this.fuel - FUEL_BURN_RATE * this.throttle * dt);
      if (this.fuel <= 0) this.throttle = 0;
    }

    this.syncMesh();

    // Update exhaust
    const { pos, dir } = this.getNozzleInfo();
    this.exhaust.update(dt, pos, dir, this.fuel > 0 ? this.throttle : 0);
  }

  reset() {
    const surfaceY = EARTH_CENTER.y + EARTH_RADIUS + ROCKET_START_ALTITUDE;
    this.position.set(0, surfaceY, 0);
    this.velocity.set(0, 0, 0);
    this.angle    = 0;
    this.fuel     = 100;
    this.throttle = 0;
    this.syncMesh();
  }

  private syncMesh() {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.z = -THREE.MathUtils.degToRad(this.angle);
  }

  dispose() {
    this.exhaust.dispose();
    this.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }
}
