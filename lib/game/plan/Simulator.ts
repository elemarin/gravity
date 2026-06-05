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
  /** Build carries a deployable Station Module. */
  hasStation: boolean;
  /** Mass (t) shed from the payload when the station is deployed. */
  stationMass: number;
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
  deployedStation: boolean;       // station module released
  stationBodyId: string | null;   // body the station was deployed around
  stationDeployedOnSurface: boolean; // true = base on the surface, false = orbit
  landingAssist: boolean;   // powered-descent autopilot engaged
  landAfterCapture: boolean; // after an arrival capture, auto de-orbit and land
  ascentAssist: boolean;    // powered-ascent autopilot engaged (relaunch)
  captureAssist: boolean;   // orbital-capture autopilot engaged (brake to circular)
  circularizeAssist: boolean; // ascent circularization autopilot engaged
  captureTargetId: string | null; // body the capture autopilot brakes relative to
  captureOrbitSign: -1 | 0 | 1; // direction chosen for destination orbit insertion
  deorbitAssist: boolean;   // de-orbit autopilot engaged (lower periapsis then land)
  departAssist: boolean;    // departure autopilot engaged (burn until escaping home-ward)
  departFromId: string | null; // body being escaped during a departure burn
  departTargetId: string | null; // home body targeted by a departure burn
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
  justDeployedStation: boolean;
  justIgnited: boolean;
  relaunchRequested: boolean; // player pressed the Return button
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
      deployedStation: false,
      stationBodyId: null,
      stationDeployedOnSurface: false,
      landingAssist: false,
      landAfterCapture: false,
      ascentAssist: false,
      captureAssist: false,
      circularizeAssist: false,
      captureTargetId: null,
      captureOrbitSign: 0,
      deorbitAssist: false,
      departAssist: false,
      departFromId: null,
      departTargetId: null,
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
      justDeployedStation: false,
      justIgnited: false,
      relaunchRequested: false,
    };
  }

  /** True once the flight has reached a terminal state (crash or final landing). */
  get finished(): boolean {
    if (this.state.phase === 'destroyed') return true;
    // A soft landing isn't terminal while a relaunch (return trip) is still
    // pending — the craft will lift off again and carry on.
    if (this.state.phase === 'landed') return !this.hasPendingRelaunch();
    return false;
  }

  private hasPendingRelaunch(): boolean {
    return this.plan.nodes.some(
      (n) => (n.trigger.type === 'after-touchdown' || n.trigger.type === 'on-manual-relaunch') &&
             !this.state.firedNodeIds.has(n.id),
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
    s.justDeployedStation = false;
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
      // Reached here already orbiting the body we're landing on — either a
      // de-orbit from the launch world or the hand-off after a transfer-arrival
      // capture lowered periapsis (see the `descend` action). So the dominant
      // body IS the landing body and its altitude is the right reference.
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
        const activeStageEmpty = (s.stageFuel[s.activeStage] ?? 0) <= 0.5;
        if (!onLanderStage && ((lowEnough && slowEnough) || activeStageEmpty)) {
          this.doDeployLander();
        }
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
        // Hand control back once the orbit is circular enough — OR once the
        // craft is out of fuel and already bounded above the surface. Without
        // the fuel check the autopilot would burn forever against an empty tank
        // (e.g. a small lander that just barely reached apoapsis), never
        // releasing, so the plan's departure node could never fire.
        const circular = s.periapsis >= targetApo * 0.6;
        const stuckButOrbiting = !this.hasThrust() &&
          Number.isFinite(s.apoapsis) && s.periapsis >= this.minStableOrbitKm(body);
        if (circular || stuckButOrbiting) {
          s.throttle = 0;
          s.ascentAssist = false;   // in orbit — let the plan take over
        } else {
          s.throttle = 1;
        }
      }
    }

    // --- Ascent circularization autopilot ---
    // Closes the current ascent arc into a circular orbit at whatever altitude
    // the craft has coasted to. Unlike an open-loop fixed-throttle burn, it
    // steers the velocity *correction* and only ever asks for circular speed —
    // so a powerful engine brakes itself instead of accelerating past escape.
    if (s.circularizeAssist) {
      const east = this.eastDir(up);
      const rNow = Math.max(s.position.distanceTo(body.center), body.radius + 0.001);
      const vCirc = Math.sqrt(body.GM / rNow);
      const tangential = s.velocity.dot(east);
      const sign = tangential < 0 ? -1 : 1;
      // Target a purely tangential, circular-speed velocity (zero radial) at the
      // current radius. Holding altitude here keeps the apoapsis we coasted to.
      const desiredVel = east.clone().multiplyScalar(vCirc * sign);
      const correction = desiredVel.sub(s.velocity);
      const tol = Math.max(0.004, vCirc * 0.02);
      if (correction.length() <= tol) {
        s.throttle = 0;
        s.circularizeAssist = false;
        s.attitude = 'prograde';
      } else {
        this.aimToward(correction, up);
        s.throttle = 1;
      }
    }

    // --- Orbital-capture autopilot ---
    // Inserts an arrival into a STABLE, bounded orbit around the destination.
    // A small sphere of influence (SOI) only holds a circular orbit well inside
    // it, and the arrival enters near the SOI edge on a hyperbola whose
    // periapsis lies deep inside. Braking right at the edge leaves an apoapsis
    // OUTSIDE the SOI — the craft drifts back out and falls home (the bug). So
    // we coast down toward periapsis first, then circularize there into an orbit
    // capped to a safe fraction of the SOI (the requested altitude can be higher
    // than the SOI can actually hold).
    if (s.captureAssist) {
      const tgt = this.cfg.bodies.find((b) => b.id === s.captureTargetId) ?? body;
      const rel = new THREE.Vector3().subVectors(s.position, tgt.center);
      const rNow = Math.max(rel.length(), tgt.radius + 0.001);
      const tgtUp = rel.clone().normalize();
      const tgtEast = this.eastDir(tgtUp);
      const radialVel = s.velocity.dot(tgtUp);
      const tangentialVel = s.velocity.dot(tgtEast);
      const vCirc = Math.sqrt(tgt.GM / rNow);
      if (s.captureOrbitSign === 0) {
        s.captureOrbitSign = tangentialVel < 0 ? -1 : 1;
      }
      const sign = s.captureOrbitSign;

      const minR = tgt.radius + this.minStableOrbitKm(tgt);
      const safeMaxR = this.safeMaxOrbitR(tgt);
      const targetR = tgt.radius + this.captureTargetAltKm(tgt);

      const ap = this.apsides(tgt);
      const apoR = Number.isFinite(ap.apo) ? ap.apo + tgt.radius : Infinity;
      const periR = ap.peri + tgt.radius;
      const tol = Math.max(0.004, vCirc * 0.06);
      const bounded = apoR <= safeMaxR * 1.15;
      const nearCircular = Math.abs(radialVel) <= tol &&
        Math.abs(Math.abs(tangentialVel) - vCirc) <= tol;

      // A landing arrival only needs to be BOUND around the target, not settled
      // into the tight safe band — the de-orbit autopilot then lowers periapsis
      // into the surface from whatever orbit the capture achieved. (A weaker
      // build often captures into a higher orbit than the safe band, so waiting
      // for the full circularization would loop forever.)
      // For a landing arrival, hand off to the de-orbit autopilot once the orbit
      // is bound with a safe periapsis AND it is either down in the low band (a
      // light world like the Moon — keeps the descent cheap so a return leg has
      // fuel) or has been circularized as low as the capture can get it (a heavy
      // world that settles in a high orbit and can't reach the band — deorbit
      // from there rather than loop forever).
      const captured = this.body().id === tgt.id && Number.isFinite(apoR) && periR >= minR &&
        (apoR <= tgt.soiRadius || nearCircular);
      if (s.landAfterCapture && captured) {
        s.throttle = 0;
        s.captureAssist = false;
        s.captureTargetId = null;
        s.captureOrbitSign = 0;
        s.landAfterCapture = false;
        s.deorbitAssist = true;
        s.attitude = 'retrograde';
      } else if (bounded && nearCircular && periR >= minR) {
        // Holding a bounded, near-circular, safe orbit — capture complete.
        s.throttle = 0;
        s.captureAssist = false;
        s.captureTargetId = null;
        s.captureOrbitSign = 0;
      } else {
        const descending = radialVel < -Math.max(0.002, vCirc * 0.03);
        const periapsisSafe = periR >= minR;
        const aboveBand = rNow > targetR * 1.02;
        if (descending && aboveBand && periapsisSafe && apoR > safeMaxR) {
          // Coast down toward periapsis; gravity does the work, so the eventual
          // circularization burn is cheap and settles a low, stable orbit.
          s.attitude = 'retrograde';
          s.throttle = 0;
        } else {
          // Insertion burn: aim velocity at a purely tangential circular velocity
          // (zero radial) at the current radius. The craft can only ever settle
          // INTO orbit — it brakes its own descent and sheds excess speed rather
          // than over-burning past escape.
          const desiredVel = tgtEast.clone().multiplyScalar(vCirc * sign);
          const correction = desiredVel.sub(s.velocity);
          if (correction.lengthSq() > 1e-10) this.aimToward(correction, tgtUp);
          s.throttle = correction.length() > Math.max(0.003, vCirc * 0.03) ? 1 : 0;
        }
      }
    }

    // --- Departure autopilot (the return-home burn) ---
    // Two phases:
    //  1. While another body still dominates (e.g. parked in a low Moon orbit),
    //     burn PROGRADE to raise apoapsis and climb out of its SOI. Aiming
    //     straight at the target from a low orbit would point the burn down
    //     through the body and crash — prograde always lifts the orbit instead.
    //  2. Once the target body dominates, aim homeward and burn to drop the
    //     conic into its atmosphere/surface. A plain prograde escape can point
    //     away from home and waste the entire return stage.
    if (s.departAssist) {
      const target = this.cfg.bodies.find((b) => b.id === s.departTargetId) ?? this.cfg.bodies[0];
      if (body.id !== target.id) {
        // Raise apoapsis just past the SOI, then coast out under the target's
        // pull. Burning all the way to escape velocity flings the craft into a
        // huge orbit around the target it can't then drop home from.
        s.attitude = 'prograde';
        const ap = this.apsides(body);
        const apoR = Number.isFinite(ap.apo) ? ap.apo + body.radius : Infinity;
        s.throttle = apoR < body.soiRadius ? 1 : 0;
      } else {
        const targetApsides = this.apsides(target);
        const returnPeriapsis = target.atmosphereHeight > 0 ? target.atmosphereHeight * 0.65 : target.radius * 0.08;
        if (targetApsides.peri <= returnPeriapsis) {
          s.throttle = 0;
          s.departAssist = false;
          s.departFromId = null;
          s.departTargetId = null;
        } else {
          const homeward = target.center.clone().sub(s.position);
          if (homeward.lengthSq() > 1e-10) this.aimToward(homeward, up);
          s.throttle = 1;
        }
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
    // A fitted chute opens itself when the craft is genuinely returning through
    // the atmosphere to land. The trigger must NOT fire on a transient dip
    // during a powered ascent — a low-thrust upper stage in its gravity turn
    // briefly descends while still in the air, and popping the chute there
    // forces the throttle to zero and strands the flight suborbital. So only
    // deploy once the craft has actually been to space (reached the top of the
    // atmosphere) OR can no longer thrust (a spent suborbital hop coming down).
    const returningToLand = s.maxAltitude >= body.atmosphereHeight || !this.hasThrust();
    if (
      this.cfg.hasParachute && !s.deployedParachute &&
      body.atmosphereHeight > 0 &&
      altitude < body.atmosphereHeight * 0.6 &&
      radialVel < 0 && altitude > 0.02 && returningToLand
    ) {
      this.doDeployParachute();
    }

    // --- Resting on the surface ---
    // Skip force integration when sitting still on the ground. Without this,
    // gravity pulls the craft below the surface every step, clampToSurface
    // snaps it back, and the HUD flickers between 0m and 1m altitude.
    // Triggers and autopilots have already been checked above, so a relaunch
    // (ascentAssist) or ignition (throttle > 0) lets the step proceed normally.
    if (s.landedBodyId !== null && altitude < 0.05 && s.throttle < 0.01 && !s.ascentAssist) {
      s.velocity.set(0, 0, 0);
      s.elapsed += dt;
      s.phase = this.determinePhase(body);
      if (s.phase === 'landed' && s.landedTime === null) s.landedTime = s.elapsed;
      else if (s.phase !== 'landed' && altitude > body.radius * 0.01) s.landedTime = null;
      return;
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
      case 'at-periapsis-altitude': {
        const target = t.value ?? 0;
        if (this.state.periapsis >= target) return true;
        // Circularization safety: a positive periapsis target is an insertion
        // burn cutoff. Atmospheric drag during the ascent coast can bleed the
        // apoapsis below that target, leaving the cutoff unreachable — so the
        // prograde burn would raise the orbit without bound and escape. Stop
        // once the orbit is effectively circular above the surface instead.
        if (target > 0) {
          const { apo, peri } = this.apsides(this.body());
          if (Number.isFinite(apo) && peri > 0 && apo - peri <= Math.max(5, apo * 0.05)) {
            return true;
          }
        }
        return false;
      }
      case 'on-fuel-empty':
        return (this.state.stageFuel[this.state.activeStage] ?? 0) <= 0.01;
      case 'after-touchdown':
        return this.state.landedTime !== null &&
               this.state.elapsed >= this.state.landedTime + (t.value ?? 0);
      case 'on-manual-relaunch':
        return this.state.phase === 'landed' && this.state.relaunchRequested;
      case 'at-soi-entry': {
        const tgt = this.cfg.bodies.find((b) => b.id === t.targetBodyId);
        if (!tgt) return false;
        // Arrive when inside the authored SOI OR once the target's gravity
        // actually dominates. The hand-authored SOI radii don't track each
        // body's true dominance region (a massive world like Venus dominates
        // far beyond its small SOI), so keying purely off the SOI lets the
        // craft sail past and escape. Dominance is self-scaling per body.
        if (this.state.position.distanceTo(tgt.center) <= tgt.soiRadius) return true;
        return dominantBody(this.cfg.bodies, this.state.position).id === tgt.id;
      }
      case 'after-orbit': {
        const current = this.body();
        if (current.id === t.targetBodyId) return false;
        // Wait until the arrival/relaunch autopilot has finished settling the
        // orbit. Firing the departure burn mid-capture (while still braking
        // down toward periapsis) aims the burn into the body and crashes.
        // Also block while a landing sequence is in progress — the craft
        // intends to land first, then relaunch, then depart.
        if (this.state.captureAssist || this.state.ascentAssist ||
            this.state.landAfterCapture || this.state.deorbitAssist ||
            this.state.landingAssist) return false;
        const altitudeNow = Math.max(0, this.state.position.distanceTo(current.center) - current.radius);
        const apsides = this.apsides(current);
        // Floor keyed off the orbit the SOI can actually hold, not the (often
        // higher) requested altitude — otherwise a tight SOI like the Moon's can
        // never satisfy it and the return-leg departure burn never fires.
        const periFloor = Math.max(this.minStableOrbitKm(current), this.captureTargetAltKm(current) * 0.5);
        return altitudeNow >= this.minStableOrbitKm(current) &&
          Number.isFinite(apsides.apo) &&
          apsides.peri >= periFloor;
      }
      case 'at-transfer-window': {
        // Fire when, from a parking orbit, the craft sits roughly opposite the
        // target so that a prograde outbound burn raises apoapsis toward it.
        // Return/departure burns aim directly home, so they fire from the near
        // side instead of burning through the body they are leaving.
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
        const alignment = craftDir.dot(tgtDir);
        return node.actions.depart ? alignment > 0.997 : alignment < -0.997;
      }
    }
  }

  private applyActions(node: Maneuver) {
    const s = this.state;
    const a = node.actions;
    if (a.descend) {
      const tgtId = node.trigger.targetBodyId;
      const tgt = tgtId ? this.cfg.bodies.find((b) => b.id === tgtId) : undefined;
      // Arriving (not yet captured) if the orbit relative to the target is
      // unbound or still high — capture into a low orbit first, then de-orbit
      // and land. Decided from the orbit shape, not gravitational dominance: a
      // massive target dominates far outside the altitude a powered descent
      // could ever brake from, so a direct descent there just sails past.
      const arrivalAp = tgt ? this.apsides(tgt) : null;
      const notYetCaptured = !!tgt && (!Number.isFinite(arrivalAp!.apo) ||
        arrivalAp!.apo + tgt.radius > this.safeMaxOrbitR(tgt) * 1.5);
      if (tgt && notYetCaptured) {
        // Capture into a low orbit first (braking relative to the target is
        // robust), then de-orbit and land — cheaper and more reliable than a
        // powered descent from high altitude.
        s.captureAssist = true; s.captureTargetId = tgt.id; s.captureOrbitSign = 0;
        s.landAfterCapture = true;
        s.landingAssist = false; s.ascentAssist = false; s.circularizeAssist = false; s.deorbitAssist = false; s.departAssist = false; s.departTargetId = null;
      } else {
        s.landingAssist = true; s.landAfterCapture = false; s.ascentAssist = false; s.captureAssist = false; s.circularizeAssist = false; s.captureOrbitSign = 0; s.departAssist = false; s.departTargetId = null; s.attitude = 'retrograde';
      }
    }
    if (a.ascend)  { s.ascentAssist = true; s.landingAssist = false; s.captureAssist = false; s.circularizeAssist = false; s.captureOrbitSign = 0; s.departAssist = false; s.departTargetId = null; s.relaunchStart = s.elapsed; }
    if (a.capture) { s.captureAssist = true; s.captureTargetId = node.trigger.targetBodyId ?? null; s.captureOrbitSign = 0; s.circularizeAssist = false; s.departAssist = false; s.departTargetId = null; s.landingAssist = false; s.ascentAssist = false; }
    if (a.circularize) { s.circularizeAssist = true; s.captureAssist = false; s.captureOrbitSign = 0; s.departAssist = false; s.departTargetId = null; s.landingAssist = false; s.ascentAssist = false; s.attitude = 'prograde'; }
    if (a.depart)  { s.departAssist = true; s.departFromId = this.body().id; s.departTargetId = node.trigger.targetBodyId ?? this.cfg.bodies[0]?.id ?? null; s.captureAssist = false; s.circularizeAssist = false; s.captureOrbitSign = 0; s.landingAssist = false; s.ascentAssist = false; }
    // An explicit throttle command (e.g. a manual burn) takes manual control
    // back from the autopilots so the craft can leave orbit.
    if (a.throttle !== undefined && !a.descend && !a.ascend && !a.capture && !a.circularize && !a.depart) {
      s.captureAssist = false; s.circularizeAssist = false; s.captureOrbitSign = 0; s.departAssist = false; s.departFromId = null; s.departTargetId = null;
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
    s.circularizeAssist = false;
    s.captureOrbitSign = 0;
    s.ascentAssist = false;
    s.departAssist = false;
    s.departTargetId = null;
    return true;
  }

  /** Real-time user-initiated lander deployment. */
  manualDeployLander(): boolean {
    if (this.cfg.landerIndex < 0 || this.state.deployedLander) return false;
    if (this.state.phase === 'landed' || this.state.phase === 'destroyed') return false;
    this.doDeployLander();
    return true;
  }

  /** Player-initiated relaunch (the Return button while landed on a target). */
  manualRelaunch(): boolean {
    if (this.state.phase !== 'landed') return false;
    if (!this.hasPendingRelaunch()) return false;
    this.state.relaunchRequested = true;
    return true;
  }

  /**
   * Where a station module can currently be released, or null:
   *  - 'orbit'   parked in a stable orbit clear of the surface (a space station)
   *  - 'surface' sitting on a solid surface after a soft landing (a base)
   * The orbit test is defined off the orbital elements (bound, periapsis above
   * the atmosphere/surface, well clear of the ground) so it works the same
   * around any world, big or small.
   */
  stationDeployContext(): 'orbit' | 'surface' | null {
    if (!this.cfg.hasStation || this.state.deployedStation) return null;
    if (this.state.phase === 'destroyed') return null;
    if (this.state.phase === 'landed') return 'surface';
    const body = this.body();
    const ap = this.apsides(body);
    const floor = Math.max(1, body.atmosphereHeight * 0.5);
    if (Number.isFinite(ap.apo) && ap.peri >= floor &&
        this.altitude() >= Math.max(2, body.radius * 0.1)) return 'orbit';
    return null;
  }

  canDeployStation(): boolean { return this.stationDeployContext() !== null; }

  /** Real-time user-initiated station deployment. Returns the body, or null. */
  manualDeployStation(): string | null {
    const ctx = this.stationDeployContext();
    if (!ctx) return null;
    const s = this.state;
    s.deployedStation = true;
    s.justDeployedStation = true;
    s.stationBodyId = this.body().id;
    s.stationDeployedOnSurface = ctx === 'surface';
    return s.stationBodyId;
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
    // Clear any non-manual attitude (e.g. prograde left by circularise) so the
    // attitude hold stops fighting stabilizeParachute and the rocket turns nose-up.
    if (s.attitude !== 'retrograde') s.attitude = 'manual';
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

    // Indirect (tidal) term. The bodies are static — they never accelerate
    // toward one another — so a craft orbiting a secondary (e.g. the Moon) would
    // otherwise feel the primary's FULL pull as an unbalanced, uniform force.
    // A constant force on a Keplerian orbit pumps its eccentricity without bound
    // (the "Stark" effect), so the craft's Moon orbit decays until it crashes or
    // is flung back toward Earth — the moon-orbit "shoots into space" bug.
    //
    // In reality the secondary falls toward the primary alongside the craft, so
    // only the DIFFERENCE in pull across the orbit (the tide) perturbs it. We
    // recover that by working in the freely-falling frame of the dominant body:
    // subtract the acceleration the other bodies impart to that body itself.
    // Earth orbits are unaffected (the Moon's pull on Earth is negligible), and
    // Moon orbits become physically stable.
    if (this.cfg.bodies.length > 1) {
      const central = dominantBody(this.cfg.bodies, pos);
      for (const b of this.cfg.bodies) {
        // Only correct for a MORE massive perturber (e.g. Earth's pull on the
        // Moon). The reverse — a light secondary's pull on the primary — is
        // negligible, and applying it during the interplanetary cruise would
        // nudge the finely-tuned transfer enough to miss the target's narrow
        // dominance region. Gating on mass keeps Earth cruise identical while
        // still cancelling the dominant Stark force inside the Moon's SOI.
        if (b.id === central.id || b.GM <= central.GM) continue;
        const toC = new THREE.Vector3().subVectors(b.center, central.center);
        const dist = Math.max(toC.length(), b.radius + 0.001);
        acc.addScaledVector(toC.normalize(), -b.GM / (dist * dist));
      }
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

  private aimToward(dir: THREE.Vector3, up: THREE.Vector3) {
    const aim = dir.clone();
    if (aim.lengthSq() < 1e-10) return;
    const east = this.eastDir(up);
    const unit = aim.normalize();
    const cosA = THREE.MathUtils.clamp(unit.dot(up), -1, 1);
    const sinA = unit.dot(east);
    this.state.angle = THREE.MathUtils.radToDeg(Math.atan2(sinA, cosA));
    this.state.attitude = 'manual';
  }

  private minStableOrbitKm(body: Body): number {
    if (body.atmosphereHeight > 0) return Math.max(KARMAN_LINE * 0.8, body.atmosphereHeight * 1.05);
    return Math.max(2, body.radius * 0.12);
  }

  private captureOrbitKm(body: Body): number {
    const requested = this.plan.mission?.orbitKm;
    const fallback = body.atmosphereHeight > 0
      ? Math.max(KARMAN_LINE, body.atmosphereHeight * 1.6)
      : Math.max(20, body.radius * 1.4);
    return Math.max(this.minStableOrbitKm(body), requested ?? fallback);
  }

  /**
   * Highest orbital radius (from body centre) the sphere of influence can hold
   * stably. A small SOI only keeps a near-circular orbit well inside it; braking
   * nearer the edge leaves an apoapsis the body can't retain. Capped to a safe
   * fraction of the SOI so the captured orbit stays bounded against the tidal
   * pull of the primary.
   */
  private safeMaxOrbitR(body: Body): number {
    const minR = body.radius + this.minStableOrbitKm(body);
    return Math.max(minR + 1, body.soiRadius * 0.22);
  }

  /**
   * Altitude (km) the capture autopilot can actually settle into around a body:
   * the requested orbit, clamped to the floor the body can hold and the ceiling
   * its SOI can retain. For a tight SOI (e.g. the Moon) this is far lower than a
   * naively requested altitude — and it is the same figure the return-leg
   * `after-orbit` trigger keys off, so the two never disagree.
   */
  private captureTargetAltKm(body: Body): number {
    const minR = body.radius + this.minStableOrbitKm(body);
    const targetR = THREE.MathUtils.clamp(
      body.radius + this.captureOrbitKm(body), minR, this.safeMaxOrbitR(body));
    return targetR - body.radius;
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
    // Once the station is deployed it no longer rides along.
    let m = this.cfg.payloadMass - (s.deployedStation ? this.cfg.stationMass : 0);
    for (let i = s.activeStage; i < this.cfg.stages.length; i++) {
      const st = this.cfg.stages[i];
      m += st.dryMass + st.fuelMass * ((s.stageFuel[i] ?? 0) / 100);
    }
    return Math.max(m, 0.001);
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
      // Zero all velocity on any soft touchdown. Leaving tangential velocity
      // causes the rocket to "slide" along the surface and bounce between
      // altitude 0 and 1 m every step while the sim waits for speed < 1 m/s.
      s.velocity.set(0, 0, 0);
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
