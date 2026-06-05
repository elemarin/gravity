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

const ROCKET_VISUAL_SCALE = 0.55;
const BODY_R = 0.18;          // main stack radius before visual scale
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
  /** Payload group (nose / capsule / station module) — detaches on deploy. */
  private payloadGroup?: THREE.Group;
  private stationDeployed = false;
  /** Station modules left behind in orbit; kept for disposal on reset. */
  private deployedStations: THREE.Group[] = [];
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
    this.clearDeployedStations();
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
    this.clearDeployedStations();
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

  /**
   * Release the payload (Station Module) into orbit: detach its group into the
   * world so it stays parked where it separated while the rocket flies on.
   */
  deployStation() {
    const g = this.payloadGroup;
    if (!g || this.stationDeployed) return;
    this.stationDeployed = true;
    g.updateWorldMatrix(true, true);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    g.matrixWorld.decompose(pos, quat, scl);
    this.mesh.remove(g);
    g.position.copy(pos);
    g.quaternion.copy(quat);
    g.scale.copy(scl);
    this.scene.add(g);
    this.deployedStations.push(g);
    this.payloadGroup = undefined;
    // A bright separation puff so the deploy reads clearly.
    const up = new THREE.Vector3().subVectors(this.position, this.upCenter).normalize();
    this.fx.burst(this.position.clone().addScaledVector(up, 0.6), up, 10, 0x6cd0ff, 0.9);
  }

  private clearDeployedStations() {
    this.deployedStations.forEach((g) => { this.scene.remove(g); this.disposeGroup(g); });
    this.deployedStations = [];
    this.stationDeployed = false;
  }

  // ── Mesh construction (bottom-up from y = 0) ──────────────────────────────

  private buildMesh(build: RocketBuild): THREE.Group {
    const group = new THREE.Group();
    group.scale.setScalar(ROCKET_VISUAL_SCALE);
    this.stageMeshes = [];
    this.stageBaseY = [];

    const stages = getStages(build);
    let y = 0;

    stages.forEach((stage, si) => {
      const stageGroup = new THREE.Group();
      const start = y;
      this.stageBaseY.push(start);

      // Engine bell — silhouette varies by the engine's bell shape so each
      // engine reads distinctly on the pad.
      const engine = getPart(stage.engineId);
      const bellColor = engine?.color ?? 0x9aa3b8;
      const bellShine = shininessFor(engine?.finish, 30);
      this.addEngineBell(stageGroup, engine?.bell ?? 'standard', bellColor, engine?.accent, bellShine, y);
      y += 0.26;

      // Fuel tanks — surface pattern + accent vary by the tank's style.
      for (const tankId of stage.tankIds) {
        const tank = getPart(tankId);
        if (!tank) continue;
        const h = 0.34 + Math.min(tank.fuelCapacity / 320, 0.9);
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(BODY_R, BODY_R, h, 12),
          mat(tank.color, shininessFor(tank.finish, 18)),
        );
        body.position.y = y + h / 2;
        stageGroup.add(body);
        this.addTankBands(stageGroup, tank.style, tank.accent ?? 0xffffff, y, h);
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

    // Nose / payload — wrapped in its own group so a Station Module can detach
    // cleanly when deployed into orbit.
    this.payloadGroup = undefined;
    const nose = getPart(build.noseId);
    if (nose) {
      const payload = new THREE.Group();
      const accent = nose.accent ?? 0x2b5cff;
      if (nose.type === 'capsule') {
        const capH = nose.id === 'capsule-command' ? 0.5 : nose.id === 'probe-core' ? 0.26 : 0.4;
        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(BODY_R * 0.6, BODY_R, capH, 12),
          mat(nose.color, shininessFor(nose.finish, 30)),
        );
        cap.position.y = y + capH / 2;
        payload.add(cap);
        // Accent collar band where the capsule meets the stack.
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(BODY_R * 1.01, BODY_R * 1.01, 0.05, 12), mat(accent, 40));
        collar.position.y = y + 0.03;
        payload.add(collar);
        // Deployable solar wings on the array-bearing payloads.
        const hasWings = nose.id === 'station-module' || nose.id === 'satellite-bus' ||
          nose.id === 'capsule-command' || build.utilityIds?.includes('solar-array');
        if (hasWings) {
          for (const sgn of [-1, 1]) {
            const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.01), mat(0x2b5cff, 70));
            panel.position.set(sgn * 0.36, y + capH / 2, 0);
            payload.add(panel);
          }
        }
        // Probe core gets a dish; command pod gets a docking ring on top.
        if (nose.id === 'probe-core') {
          const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.02, 0.04, 12), mat(accent, 70));
          dish.position.set(0.28, y + capH / 2, 0); dish.rotation.z = Math.PI / 2.4;
          payload.add(dish);
        } else if (nose.id === 'capsule-command') {
          const dock = new THREE.Mesh(new THREE.CylinderGeometry(BODY_R * 0.34, BODY_R * 0.34, 0.08, 12), mat(accent, 60));
          dock.position.y = y + capH + 0.04; payload.add(dock);
        }
        y += capH;
      } else if (nose.id === 'nose-fairing') {
        // Tall, slightly bulged aerodynamic fairing.
        const cone = new THREE.Mesh(new THREE.ConeGeometry(BODY_R * 1.05, 0.62, 14), mat(nose.color, shininessFor(nose.finish, 36)));
        cone.position.y = y + 0.31; payload.add(cone);
        const seam = new THREE.Mesh(new THREE.CylinderGeometry(BODY_R * 1.02, BODY_R * 1.02, 0.04, 14), mat(accent, 40));
        seam.position.y = y + 0.02; payload.add(seam);
        y += 0.62;
      } else {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(BODY_R, 0.42, 12), mat(nose.color, shininessFor(nose.finish, 36)));
        cone.position.y = y + 0.21;
        payload.add(cone);
        y += 0.42;
      }
      group.add(payload);
      this.payloadGroup = payload;
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

  /** Build an engine bell whose silhouette matches the engine's bell shape. */
  private addEngineBell(
    group: THREE.Group, shape: string, color: number, accent: number | undefined,
    shininess: number, y: number,
  ) {
    const lipColor = accent ?? 0x20242e;
    const addLip = (topR: number, botR: number) => {
      const lip = new THREE.Mesh(
        new THREE.CylinderGeometry(topR, botR, 0.06, 10), mat(lipColor, 12),
      );
      lip.position.y = y + 0.02;
      group.add(lip);
    };
    switch (shape) {
      case 'wide': {
        const bell = new THREE.Mesh(new THREE.CylinderGeometry(BODY_R * 0.75, BODY_R * 1.12, 0.26, 12), mat(color, shininess));
        bell.position.y = y + 0.13; group.add(bell); addLip(BODY_R * 1.12, BODY_R * 0.9);
        break;
      }
      case 'long': {
        const bell = new THREE.Mesh(new THREE.CylinderGeometry(BODY_R * 0.5, BODY_R * 0.92, 0.38, 12), mat(color, shininess));
        bell.position.y = y + 0.16; group.add(bell); addLip(BODY_R * 0.92, BODY_R * 0.7);
        break;
      }
      case 'compact': {
        const bell = new THREE.Mesh(new THREE.CylinderGeometry(BODY_R * 0.6, BODY_R * 0.78, 0.16, 10), mat(color, shininess));
        bell.position.y = y + 0.09; group.add(bell); addLip(BODY_R * 0.78, BODY_R * 0.66);
        break;
      }
      case 'ring': {
        // Aerospike / plasma — a toroidal plug nozzle.
        const torus = new THREE.Mesh(new THREE.TorusGeometry(BODY_R * 0.7, BODY_R * 0.28, 8, 16), mat(color, shininess));
        torus.rotation.x = Math.PI / 2; torus.position.y = y + 0.12; group.add(torus);
        const plug = new THREE.Mesh(new THREE.ConeGeometry(BODY_R * 0.4, 0.22, 12), mat(accent ?? color, shininess));
        plug.position.y = y + 0.1; plug.rotation.x = Math.PI; group.add(plug);
        break;
      }
      case 'cluster': {
        // Mammoth — a ring of small bells around a central one.
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const small = new THREE.Mesh(new THREE.CylinderGeometry(BODY_R * 0.26, BODY_R * 0.34, 0.22, 8), mat(color, shininess));
          small.position.set(Math.cos(a) * BODY_R * 0.6, y + 0.11, Math.sin(a) * BODY_R * 0.6);
          group.add(small);
        }
        const center = new THREE.Mesh(new THREE.CylinderGeometry(BODY_R * 0.34, BODY_R * 0.44, 0.24, 10), mat(accent ?? color, shininess));
        center.position.y = y + 0.12; group.add(center);
        break;
      }
      default: {
        const bell = new THREE.Mesh(new THREE.CylinderGeometry(BODY_R * 0.7, BODY_R * 0.95, 0.28, 10), mat(color, shininess));
        bell.position.y = y + 0.14; group.add(bell); addLip(BODY_R * 0.95, BODY_R * 0.78);
      }
    }
  }

  /** Decorative rings on a tank, in number/spacing set by its surface style. */
  private addTankBands(group: THREE.Group, style: string | undefined, accent: number, y: number, h: number) {
    const ring = (yy: number, thickness: number, r = BODY_R * 1.02) => {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r, thickness, 12), mat(accent, 40));
      band.position.y = yy;
      group.add(band);
    };
    switch (style) {
      case 'ribbed': {
        const n = Math.max(2, Math.round(h / 0.3));
        for (let i = 1; i < n; i++) ring(y + (h * i) / n, 0.03);
        ring(y + 0.04, 0.04);
        break;
      }
      case 'striped': {
        // Two bold accent bands top and bottom.
        ring(y + h * 0.25, 0.07);
        ring(y + h * 0.75, 0.07);
        break;
      }
      case 'panelled':
      case 'metallic': {
        ring(y + 0.05, 0.05, BODY_R * 1.03);
        ring(y + h - 0.05, 0.05, BODY_R * 1.03);
        // A thin mid seam.
        ring(y + h / 2, 0.025, BODY_R * 1.03);
        break;
      }
      case 'checkered': {
        const n = Math.max(3, Math.round(h / 0.22));
        for (let i = 1; i < n; i++) ring(y + (h * i) / n, 0.05);
        break;
      }
      default: // 'banded' / plain — single base band like the classic look.
        ring(y + 0.04, 0.04);
    }
  }

  private addBoosters(stageGroup: THREE.Group, build: RocketBuild, startY: number, endY: number) {
    const ids = build.boosterIds ?? [];
    if (ids.length === 0) return;
    const h = Math.max(0.6, (endY - startY) * 0.92);
    const midY = startY + (endY - startY) * 0.5;
    ids.forEach((id, i) => {
      const part = getPart(id);
      const color = part?.color ?? 0xf2f2f5;
      const accent = part?.accent ?? 0xff7a3c;
      const shine = shininessFor(part?.finish, 18);
      // Spread the strap-ons evenly around the core (handles 1–4 cleanly).
      const a = (i / ids.length) * Math.PI * 2 + Math.PI / 4;
      const off = BODY_R + 0.12;
      const bg = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, h, 8), mat(color, shine));
      body.position.y = midY;
      bg.add(body);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 8), mat(accent, 24));
      cone.position.y = midY + h / 2 + 0.09;
      bg.add(cone);
      // A couple of accent bands so heavier boosters read as segmented.
      for (const f of [0.3, 0.7]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.03, 8), mat(accent, 30));
        band.position.y = midY - h / 2 + h * f;
        bg.add(band);
      }
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
    const baseOffset = new THREE.Vector3(0, activeBaseY * ROCKET_VISUAL_SCALE, 0).applyQuaternion(this.mesh.quaternion);
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
    this.clearDeployedStations();
    this.disposeMesh();
  }
}

function mat(color: number, shininess = 16): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({ color, flatShading: true, shininess });
}

/** Map a part's finish to a Phong shininess so metals read shinier than matte. */
function shininessFor(finish: string | undefined, base = 18): number {
  switch (finish) {
    case 'glossy':   return 65;
    case 'metallic': return 95;
    case 'satin':    return 32;
    case 'matte':    return 6;
    default:         return base;
  }
}
