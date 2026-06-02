import * as THREE from 'three';
import { Body, dominantBody } from '../bodies';
import { FlightPlan, Maneuver } from './FlightPlan';
import { StageStats } from '../BuildSpec';

export type SimPhase =
  | 'prelaunch' | 'flight' | 'orbit' | 'reentry' | 'landed' | 'destroyed';

const KARMAN_LINE = 100.0;        // km above surface
const DRAG_COEFF   = 0.008;
const BASE_SAFE_MS = 10;
const CHUTE_MS     = 45;
const LEGS_MS      = 10;
const LANDER_MS    = 35;

/** Everything the deterministic simulation needs to run a build + plan. */
export type SimConfig = {
  bodies: Body[];
  stages: StageStats[];
  payloadMass: number;
  /** Index into `stages` that is the separable lander, or -1 if none. */
  landerIndex: number;
  hasParachute: boolean;
  hasLegs: boolean;
  startPosition: THREE.Vector3;
};

/** Mutable physics state — pure data, no THREE meshes. */
export type SimState = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angle: number;            // deg from local up
  throttle: number;         // 0..1
  activeStage: number;
  stageFuel: number[];      // 0..100 per stage
  deployedLander: boolean;
  deployedParachute: boolean;
  elapsed: number;          // sim seconds
  phase: SimPhase;
  maxAltitude: number;      // km
  maxSpeed: number;         // km/s
  apoapsis: number;         // km (running max of current arc)
  periapsis: number;        // km
  lastImpactSpeedMs: number;
  crashed: boolean;
  everOrbit: boolean;
  landedBodyId: string | null;
  reachedBodyIds: Set<string>;
  firedNodeIds: Set<string>;
  prevRadialVel: number;
  /** Index of the stage that just separated this step (-1 if none) — drives the mesh. */
  justStagedTo: number;
  justDeployedLander: boolean;
  justIgnited: boolean;
};

export class Simulator {
  state: SimState;
  private cfg: SimConfig;
  private plan: FlightPlan;

  constructor(cfg: SimConfig, plan: FlightPlan) {
    this.cfg = cfg;
    this.plan = plan;
    this.state = this.freshState();
  }

  setPlan(plan: FlightPlan) { this.plan = plan; }
  setConfig(cfg: SimConfig) { this.cfg = cfg; }

  reset() { this.state = this.freshState(); }

  private freshState(): SimState {
    return {
      position: this.cfg.startPosition.clone(),
      velocity: new THREE.Vector3(),
      angle: this.plan.launch.heading,
      throttle: 0,
      activeStage: 0,
      stageFuel: this.cfg.stages.map(() => 100),
      deployedLander: false,
      deployedParachute: false,
      elapsed: 0,
      phase: 'prelaunch',
      maxAltitude: 0,
      maxSpeed: 0,
      apoapsis: 0,
      periapsis: 0,
      lastImpactSpeedMs: 0,
      crashed: false,
      everOrbit: false,
      landedBodyId: null,
      reachedBodyIds: new Set(),
      firedNodeIds: new Set(),
      prevRadialVel: 0,
      justStagedTo: -1,
      justDeployedLander: false,
      justIgnited: false,
    };
  }

  /** True once the flight has reached a terminal state. */
  get finished(): boolean {
    return this.state.phase === 'landed' || this.state.phase === 'destroyed';
  }

  body(): Body { return dominantBody(this.cfg.bodies, this.state.position); }

  altitude(): number {
    const b = this.body();
    return Math.max(0, this.state.position.distanceTo(b.center) - b.radius);
  }

  /** Advance one fixed step: apply launch + maneuver triggers, then integrate. */
  step(dt: number) {
    const s = this.state;
    s.justStagedTo = -1;
    s.justDeployedLander = false;
    s.justIgnited = false;
    if (s.phase === 'landed' || s.phase === 'destroyed') return;

    const body = this.body();
    const up = new THREE.Vector3().subVectors(s.position, body.center).normalize();
    const altitude = Math.max(0, s.position.distanceTo(body.center) - body.radius);
    const radialVel = up.dot(s.velocity);

    // --- Launch ignition (first armed step) ---
    if (s.phase === 'prelaunch') {
      s.throttle = THREE.MathUtils.clamp(this.plan.launch.power, 0, 1);
      s.angle = this.plan.launch.heading;
      if (s.throttle > 0.01) s.justIgnited = true;
      s.phase = 'flight';
    }

    // --- Maneuver triggers ---
    for (const node of this.plan.nodes) {
      if (s.firedNodeIds.has(node.id)) continue;
      if (this.triggerFired(node, altitude, radialVel)) {
        s.firedNodeIds.add(node.id);
        this.applyActions(node);
      }
    }

    // --- Forces ---
    const grav   = this.gravityAccel(s.position);
    const thrust = this.thrustAccel(up, body);
    const drag   = this.dragAccel(altitude, body);
    const total  = new THREE.Vector3().add(grav).add(thrust).add(drag);

    s.velocity.addScaledVector(total, dt);
    s.position.addScaledVector(s.velocity, dt);

    // --- Fuel burn ---
    this.burnFuel(dt);

    // --- Surface contact ---
    const newAlt = Math.max(0, s.position.distanceTo(body.center) - body.radius);
    if (newAlt <= 0) this.clampToSurface(body);

    // --- Bookkeeping ---
    s.elapsed += dt;
    const speed = s.velocity.length();
    s.maxSpeed = Math.max(s.maxSpeed, speed);
    s.maxAltitude = Math.max(s.maxAltitude, this.altitude());
    if (this.altitude() > body.radius * 0.02) s.reachedBodyIds.add(body.id);

    // apo/peri running estimate (reset arc extremes loosely on big climbs)
    s.apoapsis = Math.max(s.apoapsis, this.altitude());
    if (radialVel < 0) {
      const peri = Number.isFinite(s.periapsis) ? s.periapsis : this.altitude();
      s.periapsis = Math.min(peri, this.altitude());
    }

    s.prevRadialVel = up.dot(s.velocity);
    s.phase = this.determinePhase(body);
    if (s.phase === 'orbit') s.everOrbit = true;
  }

  private triggerFired(node: Maneuver, altitude: number, radialVel: number): boolean {
    const t = node.trigger;
    switch (t.type) {
      case 'at-time':
        return this.state.elapsed >= (t.value ?? 0);
      case 'at-altitude':
        return altitude >= (t.value ?? 0) && radialVel >= 0;
      case 'at-apoapsis':
        return this.state.prevRadialVel > 0 && radialVel <= 0 && altitude > 1;
      case 'at-periapsis':
        return this.state.prevRadialVel < 0 && radialVel >= 0 && altitude > 1;
      case 'on-fuel-empty':
        return (this.state.stageFuel[this.state.activeStage] ?? 0) <= 0.01;
      case 'at-soi-entry': {
        const tgt = this.cfg.bodies.find((b) => b.id === t.targetBodyId);
        if (!tgt) return false;
        return this.state.position.distanceTo(tgt.center) <= tgt.soiRadius;
      }
    }
  }

  private applyActions(node: Maneuver) {
    const s = this.state;
    const a = node.actions;
    if (a.heading !== undefined)  s.angle = THREE.MathUtils.clamp(a.heading, -90, 90);
    if (a.throttle !== undefined) s.throttle = THREE.MathUtils.clamp(a.throttle, 0, 1);
    if (a.jettisonStage) this.doStage();
    if (a.deployLander)  this.doDeployLander();
    if (a.deployParachute) s.deployedParachute = true;
  }

  private doStage(): boolean {
    const s = this.state;
    if (s.activeStage >= this.cfg.stages.length - 1) return false;
    s.activeStage += 1;
    s.justStagedTo = s.activeStage;
    return true;
  }

  private doDeployLander() {
    const s = this.state;
    if (this.cfg.landerIndex < 0 || s.deployedLander) return;
    // Drop everything below the lander stage and continue on the lander.
    s.activeStage = this.cfg.landerIndex;
    s.deployedLander = true;
    s.justDeployedLander = true;
    s.justStagedTo = this.cfg.landerIndex;
  }

  // ---- forces ----

  private gravityAccel(pos: THREE.Vector3): THREE.Vector3 {
    const acc = new THREE.Vector3();
    for (const b of this.cfg.bodies) {
      const toC = new THREE.Vector3().subVectors(b.center, pos);
      const dist = Math.max(toC.length(), b.radius + 0.001);
      acc.addScaledVector(toC.normalize(), b.GM / (dist * dist));
    }
    return acc;
  }

  private thrustAccel(up: THREE.Vector3, _body: Body): THREE.Vector3 {
    const s = this.state;
    const stage = this.cfg.stages[s.activeStage];
    if (!stage || s.throttle < 0.01 || (s.stageFuel[s.activeStage] ?? 0) <= 0 || stage.thrust <= 0) {
      return new THREE.Vector3();
    }
    const east = new THREE.Vector3(-up.z, 0, up.x);
    if (east.lengthSq() < 0.01) east.set(1, 0, 0);
    east.normalize();
    const rad = THREE.MathUtils.degToRad(s.angle);
    const dir = up.clone().multiplyScalar(Math.cos(rad)).addScaledVector(east, Math.sin(rad)).normalize();
    const accelMs = (stage.thrust * s.throttle) / Math.max(this.mass(), 0.001);
    return dir.multiplyScalar(accelMs / 1000);
  }

  private dragAccel(altitude: number, body: Body): THREE.Vector3 {
    if (body.atmosphereHeight <= 0 || altitude >= body.atmosphereHeight) return new THREE.Vector3();
    const s = this.state;
    const t = Math.max(0, 1 - altitude / body.atmosphereHeight);
    const rho = 1.225 * Math.pow(t, 3);
    const cd = 0.5;
    const cross = s.deployedParachute ? DRAG_COEFF * 14 : DRAG_COEFF;
    const speedSq = s.velocity.lengthSq();
    if (speedSq < 1e-10) return new THREE.Vector3();
    const mag = 0.5 * rho * speedSq * cd * cross;
    return s.velocity.clone().normalize().multiplyScalar(-mag);
  }

  private mass(): number {
    const s = this.state;
    let m = this.cfg.payloadMass;
    for (let i = s.activeStage; i < this.cfg.stages.length; i++) {
      const st = this.cfg.stages[i];
      m += st.dryMass + st.fuelMass * ((s.stageFuel[i] ?? 0) / 100);
    }
    return m;
  }

  private burnFuel(dt: number) {
    const s = this.state;
    const stage = this.cfg.stages[s.activeStage];
    if (!stage || s.throttle <= 0.01 || stage.burnRate <= 0) return;
    if ((s.stageFuel[s.activeStage] ?? 0) <= 0) return;
    const cap = Math.max(stage.fuelCapacity, 1);
    const burnedL = stage.burnRate * s.throttle * dt;
    const deltaPct = (burnedL / cap) * 100;
    s.stageFuel[s.activeStage] = Math.max(0, (s.stageFuel[s.activeStage] ?? 0) - deltaPct);
    if ((s.stageFuel[s.activeStage] ?? 0) <= 0 && s.activeStage >= this.cfg.stages.length - 1) {
      s.throttle = 0;
    }
  }

  private safeLandingMs(): number {
    let safe = BASE_SAFE_MS;
    if (this.state.deployedParachute || this.cfg.hasParachute) safe += CHUTE_MS;
    if (this.cfg.hasLegs)        safe += LEGS_MS;
    if (this.state.deployedLander) safe += LANDER_MS;
    return safe;
  }

  private clampToSurface(body: Body) {
    const s = this.state;
    const radial = new THREE.Vector3().subVectors(s.position, body.center).normalize();
    const vRadial = radial.dot(s.velocity);
    const impactMs = Math.max(0, -vRadial) * 1000;
    s.lastImpactSpeedMs = impactMs;

    s.position.copy(body.center).addScaledVector(radial, body.radius + 0.001);

    if (!s.crashed && s.maxAltitude >= 0.2 && impactMs > this.safeLandingMs()) {
      s.crashed = true;
      s.velocity.set(0, 0, 0);
      s.landedBodyId = body.id;
      return;
    }
    if (vRadial < 0) {
      s.velocity.addScaledVector(radial, -vRadial);
      s.velocity.multiplyScalar(0.5);
      if (s.velocity.length() * 1000 < 0.5) s.velocity.set(0, 0, 0);
    }
    if (s.maxAltitude >= 0.2) s.landedBodyId = body.id;
  }

  private determinePhase(body: Body): SimPhase {
    const s = this.state;
    if (s.crashed) return 'destroyed';
    const altitude = Math.max(0, s.position.distanceTo(body.center) - body.radius);
    const onGround = altitude < 0.01;
    const speedMs = s.velocity.length() * 1000;

    if (onGround && speedMs < 1 && s.throttle < 0.01) {
      return s.maxAltitude > 0.1 ? 'landed' : 'prelaunch';
    }
    if (altitude >= KARMAN_LINE) {
      const r = s.position.distanceTo(body.center);
      const vCirc = Math.sqrt(body.GM / r);
      const radial = new THREE.Vector3().subVectors(s.position, body.center).normalize();
      const vHoriz = s.velocity.clone().addScaledVector(radial, -radial.dot(s.velocity));
      return vHoriz.length() > vCirc * 0.85 ? 'orbit' : 'flight';
    }
    if (altitude > 0.01) {
      const radial = new THREE.Vector3().subVectors(s.position, body.center).normalize();
      if (radial.dot(s.velocity) < -0.05 && s.maxAltitude >= KARMAN_LINE * 0.5) return 'reentry';
      return 'flight';
    }
    return 'flight';
  }
}
