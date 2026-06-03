import * as THREE from 'three';
import { Body, dominantBody } from '../bodies';
import { FlightPlan, Maneuver, Attitude } from './FlightPlan';
import { StageStats } from '../BuildSpec';

export type SimPhase =
  | 'prelaunch' | 'flight' | 'orbit' | 'reentry' | 'landed' | 'destroyed';

const KARMAN_LINE  = 100.0;        // km above surface
const DRAG_COEFF   = 0.018;
const CHUTE_CROSS  = 320;          // cross-section for deployed chute (~10 m/s terminal)
const CHUTE_STABILIZE_RATE = 2.5;  // how quickly an open chute pulls the craft upright
const BASE_SAFE_MS = 10;
const CHUTE_MS     = 45;
const LEGS_MS      = 10;
const LANDER_MS    = 35;
// Powered-descent autopilot: allowed speed (m/s) = floor + altitude·rate.
const LAND_FLOOR_MS = 4;
const LAND_RATE     = 1.1;

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
  attitude: Attitude;       // 'manual' aim, or auto prograde/retrograde hold
  throttle: number;         // 0..1
  activeStage: number;
  stageFuel: number[];      // 0..100 per stage
  deployedLander: boolean;
  deployedParachute: boolean;
  landingAssist: boolean;   // powered-descent autopilot engaged
  ascentAssist: boolean;    // powered-ascent autopilot engaged (relaunch)
  captureAssist: boolean;   // orbital-capture autopilot engaged (brake to circular)
  captureTargetId: string | null; // body the capture autopilot brakes relative to
  deorbitAssist: boolean;   // de-orbit autopilot engaged (lower periapsis then land)
  departAssist: boolean;    // departure autopilot engaged (burn until escaping home-ward)
  departFromId: string | null; // body being escaped during a departure burn
  landedTime: number | null;   // sim seconds of first soft touchdown
  relaunchStart: number | null;// sim seconds a relaunch was commanded
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
  justDeployedParachute: boolean;
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
      attitude: 'manual',
      throttle: 0,
      activeStage: 0,
      stageFuel: this.cfg.stages.map(() => 100),
      deployedLander: false,
      deployedParachute: false,
      landingAssist: false,
      ascentAssist: false,
      captureAssist: false,
      captureTargetId: null,
      deorbitAssist: false,
      departAssist: false,
      departFromId: null,
      landedTime: null,
      relaunchStart: null,
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
      justDeployedParachute: false,
      justIgnited: false,
    };
  }

  /** True once the flight has reached a terminal state. */
  get finished(): boolean {
    if (this.state.phase === 'destroyed') return true;
    // A soft landing isn't terminal while a relaunch (return trip) is still
    // pending — the craft will lift off again and carry on.
    if (this.state.phase === 'landed') return !this.hasPendingRelaunch();
    return false;
  }

  private hasPendingRelaunch(): boolean {
    return this.plan.nodes.some(
      (n) => n.trigger.type === 'after-touchdown' && !this.state.firedNodeIds.has(n.id),
    );
  }

  /** Whether the active stage can currently produce thrust (engine + fuel). */
  private hasThrust(): boolean {
    const st = this.cfg.stages[this.state.activeStage];
    return !!st && st.thrust > 0 && (this.state.stageFuel[this.state.activeStage] ?? 0) > 0.001;
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
    s.justDeployedParachute = false;
    s.justIgnited = false;
    // Destroyed is terminal; a soft landing keeps simulating so a pending
    // relaunch (return trip) can lift the craft off again.
    if (s.phase === 'destroyed') return;

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

    // --- De-orbit autopilot (the LAND button) ---
    // Burns retrograde to drop periapsis below the surface, then hands off to the
    // powered-descent autopilot for a soft touchdown from any orbit.
    if (s.deorbitAssist) {
      s.attitude = 'retrograde';
      const lowTarget = body.atmosphereHeight > 0 ? body.atmosphereHeight * 0.2 : body.radius * 0.04;
      if (s.periapsis > lowTarget) {
        s.throttle = 1;
      } else {
        s.throttle = 0;
        s.deorbitAssist = false;
        s.landingAssist = true;
      }
    }

    // --- Powered-descent autopilot ---
    // Holds retrograde and throttles bang-bang to keep speed under a safe
    // altitude-scaled limit, producing a soft touchdown on the target world.
    if (s.landingAssist) {
      s.attitude = 'retrograde';
      const speedMs = s.velocity.length() * 1000;
      const safeMs = LAND_FLOOR_MS + altitude * LAND_RATE;
      s.throttle = speedMs > safeMs ? 1 : 0;

      // Stage the lander LATE: only once the upper stage has braked the bulk of
      // the arrival speed and we're low and slow, so the lander's small tank
      // just finishes the touchdown instead of fighting the whole descent.
      if (this.cfg.landerIndex >= 0 && !s.deployedLander) {
        const lowEnough = altitude < Math.max(2, body.radius * 0.35);
        const slowEnough = speedMs < 90;
        const onLanderStage = s.activeStage >= this.cfg.landerIndex;
        if (lowEnough && slowEnough && !onLanderStage) this.doDeployLander();
      }
    }

    // --- Powered-ascent autopilot (relaunch from a surface) ---
    // Flies an automatic gravity turn up to a low orbit around the current body,
    // then circularizes and hands control back to the plan. Used by return
    // missions after a touchdown.
    if (s.ascentAssist) {
      const targetApo = body.radius * 0.7 + Math.max(body.atmosphereHeight, body.radius * 0.5);
      const turnSpan = Math.max(1, body.radius + body.atmosphereHeight);
      if (s.apoapsis < targetApo) {
        const frac = THREE.MathUtils.clamp(altitude / turnSpan, 0, 1);
        s.attitude = 'manual';
        s.angle = THREE.MathUtils.lerp(5, 88, frac);
        s.throttle = 1;
      } else if (radialVel > 0.0008) {
        s.throttle = 0;             // coasting up to apoapsis
      } else {
        s.attitude = 'prograde';    // circularize at the top
        if (s.periapsis < targetApo * 0.6) {
          s.throttle = 1;
        } else {
          s.throttle = 0;
          s.ascentAssist = false;   // in orbit — let the plan take over
        }
      }
    }

    // --- Orbital-capture autopilot ---
    // Brakes retrograde whenever the craft is moving faster than the local
    // circular speed, settling an arrival hyperbola/ellipse into a near-circular
    // orbit around whichever body now dominates (the destination on arrival).
    if (s.captureAssist) {
      // Brake relative to the *target* body (not whichever body momentarily
      // dominates), so the burn starts on approach — at the SOI edge the target
      // may still be gravitationally out-ranked by the launch world.
      const tgt = this.cfg.bodies.find((b) => b.id === s.captureTargetId) ?? body;
      const rNow = Math.max(s.position.distanceTo(tgt.center), tgt.radius);
      const altT = rNow - tgt.radius;
      const vCirc = Math.sqrt(tgt.GM / rNow);
      const speed = s.velocity.length();
      s.attitude = 'retrograde';
      // Brake to a safe descent whenever we're low OR the approach is steep
      // (closing fast on the target's surface), so a near-radial airless arrival
      // is arrested in time instead of slamming in.
      const tgtRadialVel = s.position.clone().sub(tgt.center).normalize().dot(s.velocity);
      const safeMs = LAND_FLOOR_MS + altT * LAND_RATE;
      const closingFast = tgtRadialVel < 0 && (-tgtRadialVel * 1000) > safeMs;
      if (altT < tgt.radius * 1.5 || closingFast) {
        s.throttle = speed * 1000 > safeMs ? 1 : 0;
      } else {
        // Higher up and not plunging — shed excess speed toward a circular orbit.
        s.throttle = speed > vCirc * 1.06 ? 1 : 0;
      }
    }

    // --- Departure autopilot (the return-home burn) ---
    // Burns prograde to climb out of the body it is leaving and cuts the instant
    // a different body takes over gravity — i.e. once it has escaped back toward
    // home — so the return burn can never run away into deep space.
    if (s.departAssist) {
      s.attitude = 'prograde';
      if (s.departFromId !== null && body.id !== s.departFromId) {
        s.throttle = 0;
        s.departAssist = false;
        s.departFromId = null;
      } else {
        s.throttle = 1;
      }
    }

    // --- Automatic attitude hold (prograde / retrograde) ---
    // Convert the desired thrust direction into the up/east aim angle so the
    // existing thrust + mesh code "just works". Everything stays in the x-y
    // plane, where the planets live.
    if (s.attitude !== 'manual' && s.velocity.lengthSq() > 1e-8) {
      const east = this.eastDir(up);
      const dir = (s.attitude === 'retrograde'
        ? s.velocity.clone().negate()
        : s.velocity.clone()).normalize();
      const cosA = THREE.MathUtils.clamp(dir.dot(up), -1, 1);
      const sinA = dir.dot(east);
      s.angle = THREE.MathUtils.radToDeg(Math.atan2(sinA, cosA));
    }

    // --- Auto-deploying parachute ---
    // A fitted chute opens itself the moment the craft is falling back down
    // through the atmosphere; no manual trigger or plan node required.
    if (
      this.cfg.hasParachute && !s.deployedParachute &&
      body.atmosphereHeight > 0 &&
      altitude < body.atmosphereHeight * 0.6 &&
      radialVel < 0 && s.maxAltitude > 2 && altitude > 0.02
    ) {
      this.doDeployParachute();
    }

    // --- Forces ---
    const grav   = this.gravityAccel(s.position);
    const thrust = this.thrustAccel(up, body);
    const drag   = this.dragAccel(altitude, body);
    const total  = new THREE.Vector3().add(grav).add(thrust).add(drag);

    s.velocity.addScaledVector(total, dt);
    s.position.addScaledVector(s.velocity, dt);
    if (s.deployedParachute) this.stabilizeParachute(s, dt);

    // --- Fuel burn ---
    this.burnFuel(dt);

    // --- Automatic staging ---
    // A spent lower stage drops itself and lights the next one with no manual
    // input. The separable lander is never auto-staged — that stays deliberate.
    const lastNonLander = this.cfg.landerIndex >= 0
      ? this.cfg.landerIndex - 1
      : this.cfg.stages.length - 1;
    if ((s.stageFuel[s.activeStage] ?? 0) <= 0.001 && s.activeStage < lastNonLander) {
      this.doStage();
    }

    // --- Surface contact ---
    const newAlt = Math.max(0, s.position.distanceTo(body.center) - body.radius);
    if (newAlt <= 0) this.clampToSurface(body);

    // --- Bookkeeping ---
    s.elapsed += dt;
    const speed = s.velocity.length();
    s.maxSpeed = Math.max(s.maxSpeed, speed);
    s.maxAltitude = Math.max(s.maxAltitude, this.altitude());
    if (this.altitude() > body.radius * 0.02) s.reachedBodyIds.add(body.id);

    // True instantaneous apoapsis/periapsis from the two-body orbital elements
    // relative to the dominant body.
    const ap = this.apsides(body);
    s.apoapsis = ap.apo;
    s.periapsis = ap.peri;

    // Store THIS step's start-of-step radial velocity so the next step's
    // apoapsis/periapsis triggers can detect the sign change bracketing the
    // turning point. (Using the post-integration velocity here would equal the
    // next step's start value, so the crossing could never be detected.)
    s.prevRadialVel = radialVel;
    s.phase = this.determinePhase(body);
    if (s.phase === 'orbit') s.everOrbit = true;
    // Record the first soft touchdown so an after-touchdown relaunch can time
    // off it; clear it again once the craft is airborne and climbing.
    if (s.phase === 'landed' && s.landedTime === null) s.landedTime = s.elapsed;
    else if (s.phase !== 'landed' && altitude > body.radius * 0.01) s.landedTime = null;
  }

  /**
   * Apoapsis / periapsis altitude (km above surface) from the current
   * two-body orbital elements. Apoapsis is Infinity on an escape trajectory;
   * a negative periapsis means the orbit intersects the surface (will impact).
   */
  private apsides(body: Body): { apo: number; peri: number } {
    const s = this.state;
    const rel = new THREE.Vector3().subVectors(s.position, body.center);
    const r = rel.length();
    const v = s.velocity.length();
    if (r < 1e-6) return { apo: 0, peri: 0 };
    const eps = (v * v) / 2 - body.GM / r;             // specific orbital energy
    const h = new THREE.Vector3().crossVectors(rel, s.velocity).length();
    const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (body.GM * body.GM)));
    const rp = (h * h / body.GM) / (1 + e);            // periapsis radius
    const peri = rp - body.radius;
    if (eps >= -1e-12) return { apo: Infinity, peri };  // parabolic / hyperbolic
    const a = -body.GM / (2 * eps);
    const apo = a * (1 + e) - body.radius;
    return { apo, peri };
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
      case 'at-apoapsis-altitude':
        // Projected apoapsis has reached the target while still climbing
        // (Infinity counts — that means we're at/over escape energy).
        return radialVel >= 0 && this.state.apoapsis >= (t.value ?? 0);
      case 'at-periapsis-altitude':
        return this.state.periapsis >= (t.value ?? 0);
      case 'on-fuel-empty':
        return (this.state.stageFuel[this.state.activeStage] ?? 0) <= 0.01;
      case 'after-touchdown':
        return this.state.landedTime !== null &&
               this.state.elapsed >= this.state.landedTime + (t.value ?? 0);
      case 'at-soi-entry': {
        const tgt = this.cfg.bodies.find((b) => b.id === t.targetBodyId);
        if (!tgt) return false;
        return this.state.position.distanceTo(tgt.center) <= tgt.soiRadius;
      }
      case 'at-transfer-window': {
        // Fire when, from a parking orbit, the craft sits roughly opposite the
        // target so that a prograde burn raises apoapsis toward it.
        const tgt = this.cfg.bodies.find((b) => b.id === t.targetBodyId);
        if (!tgt) return false;
        const central = this.body();
        // Gate on altitude so we burn from orbit, scaled down for small bodies
        // (a low lunar orbit is well under the 25 km Earth threshold).
        if (altitude < Math.min(25, central.radius * 0.5)) return false;
        if (tgt.id === central.id) return false;
        const craftDir = new THREE.Vector3().subVectors(this.state.position, central.center).normalize();
        const tgtDir = new THREE.Vector3().subVectors(tgt.center, central.center).normalize();
        // Tight alignment: burning when the craft is near-exactly opposite the
        // target lands the resulting apoapsis close enough that the target's
        // gravity takes over (its dominance region is tighter than its SOI).
        return craftDir.dot(tgtDir) < -0.997;
      }
    }
  }

  private applyActions(node: Maneuver) {
    const s = this.state;
    const a = node.actions;
    if (a.descend) { s.landingAssist = true; s.ascentAssist = false; s.captureAssist = false; s.attitude = 'retrograde'; }
    if (a.ascend)  { s.ascentAssist = true; s.landingAssist = false; s.captureAssist = false; s.relaunchStart = s.elapsed; }
    if (a.capture) { s.captureAssist = true; s.captureTargetId = node.trigger.targetBodyId ?? null; s.landingAssist = false; s.ascentAssist = false; }
    if (a.depart)  { s.departAssist = true; s.departFromId = this.body().id; s.captureAssist = false; s.landingAssist = false; s.ascentAssist = false; }
    // An explicit throttle command (e.g. a manual burn) takes manual control
    // back from the autopilots so the craft can leave orbit.
    if (a.throttle !== undefined && !a.descend && !a.ascend && !a.capture && !a.depart) {
      s.captureAssist = false; s.departAssist = false;
    }
    if (a.attitude !== undefined) s.attitude = a.attitude;
    if (a.heading !== undefined) { s.angle = THREE.MathUtils.clamp(a.heading, -90, 90); s.attitude = 'manual'; }
    if (a.throttle !== undefined && !a.descend) s.throttle = THREE.MathUtils.clamp(a.throttle, 0, 1);
    if (a.jettisonStage) this.doStage();
    if (a.deployLander)  this.doDeployLander();
    if (a.deployParachute) this.doDeployParachute();
  }

  /** Real-time user-initiated stage separation. */
  manualStage(): boolean {
    if (this.state.phase === 'landed' || this.state.phase === 'destroyed') return false;
    return this.doStage();
  }

  /** Real-time user-initiated parachute deployment. */
  manualParachute(): boolean {
    if (!this.cfg.hasParachute || this.state.deployedParachute) return false;
    if (this.state.phase === 'landed' || this.state.phase === 'destroyed') return false;
    return this.doDeployParachute();
  }

  /** Real-time user-initiated de-orbit + landing (the LAND button). */
  manualDeorbit(): boolean {
    if (this.state.phase === 'landed' || this.state.phase === 'destroyed') return false;
    const s = this.state;
    s.deorbitAssist = true;
    s.captureAssist = false;
    s.ascentAssist = false;
    s.departAssist = false;
    return true;
  }

  /** Real-time user-initiated lander deployment. */
  manualDeployLander(): boolean {
    if (this.cfg.landerIndex < 0 || this.state.deployedLander) return false;
    if (this.state.phase === 'landed' || this.state.phase === 'destroyed') return false;
    this.doDeployLander();
    return true;
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

  private doDeployParachute(): boolean {
    const s = this.state;
    if (!this.cfg.hasParachute || s.deployedParachute) return false;
    s.throttle = 0;
    s.deployedParachute = true;
    s.justDeployedParachute = true;
    return true;
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

  /**
   * Horizontal "east" tangent in the x-y plane (where all bodies live). Using
   * the x-y tangent — rather than a tangent around the y-axis — keeps the whole
   * flight, including gravity turns and transfers, in a single clean plane and
   * matches the rocket's visual tilt (a rotation about z).
   */
  private eastDir(up: THREE.Vector3): THREE.Vector3 {
    const east = new THREE.Vector3(up.y, -up.x, 0);
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    return east.normalize();
  }

  private thrustAccel(up: THREE.Vector3, _body: Body): THREE.Vector3 {
    const s = this.state;
    const stage = this.cfg.stages[s.activeStage];
    if (!stage || s.throttle < 0.01 || (s.stageFuel[s.activeStage] ?? 0) <= 0 || stage.thrust <= 0) {
      return new THREE.Vector3();
    }
    const east = this.eastDir(up);
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
    const cross = s.deployedParachute ? CHUTE_CROSS : DRAG_COEFF;
    const speedSq = s.velocity.lengthSq();
    if (speedSq < 1e-10) return new THREE.Vector3();
    const mag = 0.5 * rho * speedSq * cd * cross;
    return s.velocity.clone().normalize().multiplyScalar(-mag);
  }

  private stabilizeParachute(s: SimState, dt: number) {
    const settle = 1 - Math.exp(-dt * CHUTE_STABILIZE_RATE);
    s.angle = THREE.MathUtils.lerp(s.angle, 0, settle);
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
    if (this.state.deployedParachute) safe += CHUTE_MS;
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

    // At rest on the surface with the engine idle — or unable to thrust (out of
    // fuel) — counts as landed, which keeps a failed relaunch from hanging.
    if (onGround && speedMs < 1 && (s.throttle < 0.01 || !this.hasThrust())) {
      return s.maxAltitude > 0.1 ? 'landed' : 'prelaunch';
    }

    // A real orbit: periapsis sits safely above the atmosphere (so it won't
    // decay) and we're well above the surface.
    const orbitFloor = Math.max(2, body.atmosphereHeight * 0.5);
    if (altitude >= KARMAN_LINE * 0.5 && Number.isFinite(s.apoapsis) && s.periapsis >= orbitFloor) {
      return 'orbit';
    }
    if (altitude > 0.01) {
      const radial = new THREE.Vector3().subVectors(s.position, body.center).normalize();
      if (radial.dot(s.velocity) < -0.05 && s.maxAltitude >= KARMAN_LINE * 0.5) return 'reentry';
      return 'flight';
    }
    return 'flight';
  }
}
