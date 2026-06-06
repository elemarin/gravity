import * as THREE from 'three';
import { Body, dominantBody, positionBodiesAt, bodyStateAt, destinationTargetId, bodyDef, SUN_GM, SUN_ID } from '../bodies';
import { FlightPlan, Maneuver, Attitude } from './FlightPlan';
import { StageStats } from '../BuildSpec';
import { KARMAN_LINE } from '../constants';

// ── Lambert's problem (universal-variable solution) ──────────────────────────
// Given two position vectors and a time of flight under a central body of
// gravitational parameter `mu`, find the velocity at r1 of the unique conic that
// connects them in that time. This is what makes interplanetary intercepts work:
// because every body's future position is analytic (bodyStateAt), the transfer
// autopilot picks an arrival time, asks where the target WILL be, and solves for
// the exact burn to be there at the same instant — then re-solves each step as a
// closed-loop correction. Standard Bate–Mueller–White / Vallado formulation.
function stumpffC(z: number): number {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.cosh(s) - 1) / -z; }
  return 0.5;
}
function stumpffS(z: number): number {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6;
}
/** Velocity at r1 (THREE units/s) for a prograde transfer r1→r2 in time `dt`, or null. */
function lambertV1(r1v: THREE.Vector3, r2v: THREE.Vector3, dt: number, mu: number): THREE.Vector3 | null {
  const r1 = r1v.length(), r2 = r2v.length();
  if (r1 < 1e-6 || r2 < 1e-6 || dt <= 0) return null;
  let cosdnu = r1v.dot(r2v) / (r1 * r2);
  cosdnu = Math.max(-1, Math.min(1, cosdnu));
  const crossZ = r1v.x * r2v.y - r1v.y * r2v.x;   // planar (x-y) transfer
  let dnu = Math.acos(cosdnu);
  if (crossZ < 0) dnu = 2 * Math.PI - dnu;        // prograde (counter-clockwise)
  const A = Math.sin(dnu) * Math.sqrt((r1 * r2) / (1 - cosdnu));
  if (Math.abs(A) < 1e-9) return null;

  let psi = 0, psiUp = 4 * Math.PI * Math.PI, psiLow = -4 * Math.PI * Math.PI;
  let y = r1 + r2;
  for (let i = 0; i < 80; i++) {
    const C = stumpffC(psi), S = stumpffS(psi);
    y = r1 + r2 + (A * (psi * S - 1)) / Math.sqrt(C);
    if (A > 0 && y < 0) { psiLow = psi; psi = (psiUp + psiLow) / 2; continue; }
    if (y < 0) return null;
    const chi = Math.sqrt(y / C);
    const dtCalc = (chi * chi * chi * S + A * Math.sqrt(y)) / Math.sqrt(mu);
    if (Math.abs(dtCalc - dt) < dt * 1e-5) break;
    if (dtCalc <= dt) psiLow = psi; else psiUp = psi;
    psi = (psiUp + psiLow) / 2;
  }
  const f = 1 - y / r1;
  const g = A * Math.sqrt(y / mu);
  if (Math.abs(g) < 1e-9) return null;
  // v1 = (r2 - f·r1) / g
  const v1 = r2v.clone().addScaledVector(r1v, -f).multiplyScalar(1 / g);
  if (!Number.isFinite(v1.x) || !Number.isFinite(v1.y)) return null;
  return v1;
}

export type SimPhase =
  | 'prelaunch' | 'flight' | 'orbit' | 'reentry' | 'landed' | 'destroyed';

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
  /** Heliocentric velocity inherited from the launch body at t=0 (orbital motion). */
  startVelocity?: THREE.Vector3;
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
  transferAssist: boolean;  // homing-transfer autopilot engaged (cruise to a target)
  transferTargetId: string | null; // body the transfer autopilot is homing toward
  transferClimbed: boolean; // apoapsis has reached the target's lane — stop raising, coast
  /** Sim time (s) the Lambert transfer is targeting arrival at, or null. */
  transferArriveT: number | null;
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
  /**
   * The live solar system at the current sim time. The bodies orbit, so this is
   * re-evaluated from `state.elapsed` every step. It's a private working copy
   * (cloned from the config) so multiple simulators — the live flight and the
   * forward-running preview sandboxes — never fight over one shared array.
   */
  private bodies: Body[];

  constructor(cfg: SimConfig, plan: FlightPlan) {
    this.cfg = cfg;
    this.plan = plan;
    this.bodies = this.cloneBodies();
    this.state = this.freshState();
    this.positionBodies();
  }

  setPlan(plan: FlightPlan) { this.plan = plan; }
  setConfig(cfg: SimConfig) {
    this.cfg = cfg;
    this.bodies = this.cloneBodies();
    this.positionBodies();
  }

  reset() {
    this.state = this.freshState();
    this.positionBodies();
  }

  private cloneBodies(): Body[] {
    return this.cfg.bodies.map((b) => ({
      ...b,
      center: b.center.clone(),
      velocity: b.velocity.clone(),
    }));
  }

  /** Re-evaluate every body's position + velocity at the current sim time. */
  private positionBodies() {
    positionBodiesAt(this.bodies, this.state?.elapsed ?? 0);
  }

  /** Velocity of the craft relative to a (moving) body. */
  private relVel(body: Body): THREE.Vector3 {
    return this.state.velocity.clone().sub(body.velocity);
  }

  private pinnedBody(): Body | null {
    if (!this.state.landedBodyId) return null;
    return this.bodies.find((b) => b.id === this.state.landedBodyId) ?? null;
  }

  private pinToSurface(body: Body, upHint?: THREE.Vector3) {
    const s = this.state;
    const radial = upHint?.clone() ?? new THREE.Vector3().subVectors(s.position, body.center);
    if (radial.lengthSq() < 1e-12) radial.set(0, 1, 0);
    radial.normalize();
    s.position.copy(body.center).addScaledVector(radial, body.radius + 0.001);
    s.velocity.copy(body.velocity);
  }

  private freshState(): SimState {
    return {
      position: this.cfg.startPosition.clone(),
      // Inherit the launch body's orbital motion so the craft rides along with
      // its world instead of being instantly left behind by a moving planet.
      velocity: this.cfg.startVelocity?.clone() ?? new THREE.Vector3(),
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
      transferAssist: false,
      transferTargetId: null,
      transferClimbed: false,
      transferArriveT: null,
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

  body(): Body {
    if (this.state.phase === 'landed' && this.state.landedBodyId) {
      return this.bodies.find((b) => b.id === this.state.landedBodyId) ?? dominantBody(this.bodies, this.state.position);
    }
    return dominantBody(this.bodies, this.state.position);
  }

  /** The live solar system at the current sim time (read-only view). */
  liveBodies(): Body[] { return this.bodies; }

  /** A deep copy of the mutable flight state (clones every vector/array/set). */
  private cloneState(): SimState {
    const s = this.state;
    return {
      ...s,
      position: s.position.clone(),
      velocity: s.velocity.clone(),
      stageFuel: [...s.stageFuel],
      reachedBodyIds: new Set(s.reachedBodyIds),
      firedNodeIds: new Set(s.firedNodeIds),
    };
  }

  /**
   * A detached simulator sharing this one's config + plan but carrying a
   * snapshot of the current state. Stepping the fork forward-predicts the
   * trajectory without disturbing the live flight — and keeps the trajectory
   * preview in lockstep with the real physics instead of a hand-copied subset
   * of the state that silently drifts whenever a field is added.
   */
  fork(): Simulator {
    const f = new Simulator(this.cfg, this.plan);
    f.state = this.cloneState();
    f.positionBodies();
    return f;
  }

  altitude(): number {
    const b = this.body();
    return Math.max(0, this.state.position.distanceTo(b.center) - b.radius);
  }

  /**
   * Speed relative to the body the craft is flying around — i.e. excluding the
   * world's own heliocentric orbital motion. This is the "ground/orbit" speed the
   * HUD should show: 0 when landed, orbital speed when in orbit, not the planet's
   * ~hundreds of m/s drift around the Sun.
   */
  relativeSpeed(): number {
    return this.relVel(this.body()).length();
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

    // Advance the orbiting solar system to this step's time before anything reads
    // a body position. (elapsed is bumped at the end of the step.)
    this.positionBodies();

    const body = this.pinnedBody() ?? this.body();
    const up = new THREE.Vector3().subVectors(s.position, body.center).normalize();
    const altitude = Math.max(0, s.position.distanceTo(body.center) - body.radius);
    const radialVel = up.dot(this.relVel(body));

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
      const speedMs = this.relVel(body).length() * 1000;
      // On an atmospheric world with a parachute, let aerobraking + the chute do
      // the work for FREE and only burn the engine as a safety net when the
      // descent is genuinely too fast — so a return mission keeps its fuel for the
      // trip home instead of spending the whole lander tank fighting a descent the
      // air would have slowed anyway. (Airless worlds have no drag, so there the
      // engine must do all the braking, as before.)
      const aeroAssisted = this.cfg.hasParachute && body.atmosphereHeight > 0;
      const safeMs = aeroAssisted
        ? (LAND_FLOOR_MS + altitude * LAND_RATE) * 3.5   // generous: let drag/chute brake
        : LAND_FLOOR_MS + altitude * LAND_RATE;
      s.throttle = speedMs > safeMs ? 1 : 0;

      // Stage the lander LATE: only once the upper stage has braked the bulk of
      // the arrival speed and we're low and slow, so the lander's small tank
      // just finishes the touchdown instead of fighting the whole descent.
      // BUT: on a return mission to an atmospheric world the parachute lands the
      // whole stack for free, and the craft needs its big main stage (not the
      // tiny lander tank) to climb back to orbit afterwards. So don't drop the
      // lander when a relaunch is pending and a chute is available to land on —
      // keep the fuel that the trip home depends on.
      const relaunchPending = this.plan.nodes.some(
        (n) => (n.trigger.type === 'on-manual-relaunch' || n.trigger.type === 'after-touchdown') &&
               !s.firedNodeIds.has(n.id));
      const aeroLands = this.cfg.hasParachute && body.atmosphereHeight > 0;
      const keepStageForReturn = relaunchPending && aeroLands;
      if (this.cfg.landerIndex >= 0 && !s.deployedLander && !keepStageForReturn) {
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
      const bodyVel = this.relVel(body);
      const rNow = Math.max(s.position.distanceTo(body.center), body.radius + 0.001);
      const vCirc = Math.sqrt(body.GM / rNow);
      const tangential = bodyVel.dot(east);
      const sign = tangential < 0 ? -1 : 1;
      // Target a purely tangential, circular-speed velocity (zero radial) at the
      // current radius, measured relative to the (moving) body. Holding altitude
      // here keeps the apoapsis we coasted to.
      const desiredVel = east.clone().multiplyScalar(vCirc * sign);
      const correction = desiredVel.sub(bodyVel);
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
      const tgt = this.bodies.find((b) => b.id === s.captureTargetId) ?? body;
      const rel = new THREE.Vector3().subVectors(s.position, tgt.center);
      const tgtVel = this.relVel(tgt);
      const rNow = Math.max(rel.length(), tgt.radius + 0.001);
      const tgtUp = rel.clone().normalize();
      const tgtEast = this.eastDir(tgtUp);
      const radialVel = tgtVel.dot(tgtUp);
      const tangentialVel = tgtVel.dot(tgtEast);
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
      // Don't hand a landing arrival off to de-orbit while its apoapsis still
      // reaches a sibling moon's lane — it would swing back out, get recaptured by
      // that moon, and land there instead (e.g. Moon→Earth falling back onto the
      // Moon, or a Mars arrival snagged by Phobos). Circularize below the nearest
      // moon first; worlds with no moons keep the old SOI ceiling.
      let hasSiblingMoon = false;
      for (const o of this.bodies) {
        if (o.orbit && o.orbit.parentId === tgt.id) { hasSiblingMoon = true; break; }
      }
      // A target with a moon (Earth has the Moon, Mars has Phobos) must be
      // circularized LOW — below that moon's lane — before de-orbiting, or the
      // craft swings back out to its apoapsis at the moon's lane and gets
      // recaptured by the moon, landing there instead. Moonless worlds keep the
      // lenient handoff (a bound orbit is enough; the de-orbit finishes the job),
      // so weak builds that settle high don't loop forever.
      const fullyCircular = apoR <= safeMaxR * 1.15 && nearCircular && periR >= minR;
      const captured = this.body().id === tgt.id && Number.isFinite(apoR) && periR >= minR &&
        (hasSiblingMoon ? fullyCircular : (apoR <= tgt.soiRadius || nearCircular));
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
          const correction = desiredVel.sub(tgtVel);
          if (correction.lengthSq() > 1e-10) this.aimToward(correction, tgtUp);
          s.throttle = correction.length() > Math.max(0.003, vCirc * 0.03) ? 1 : 0;
        }
      }

      if (s.throttle > 0.01 && !this.hasThrust() && this.cfg.landerIndex >= 0 && !s.deployedLander) {
        this.doDeployLander();
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
      const target = this.bodies.find((b) => b.id === s.departTargetId) ?? this.bodies[0];
      const fromBody = this.bodies.find((b) => b.id === s.departFromId);
      const stillAtDeparture = !!fromBody && fromBody.id !== target.id &&
        this.body().id === fromBody.id;
      if (stillAtDeparture) {
        // Phase 1 — escape the world we're leaving (e.g. the Moon) GENTLY: burn
        // craft-prograde to just past its escape velocity so the craft slips out
        // of its SOI at low speed relative to it, settling into a near-circular
        // orbit around the home world at that world's lane. A full-throttle escape
        // of a tiny SOI overshoots massively on a strong engine and flings the
        // craft clear past the home world's SOI entirely (it never comes home).
        // The throttle tapers as escape nears to keep the exit speed low.
        const rNow = Math.max(s.position.distanceTo(fromBody.center), fromBody.radius);
        const vEsc = Math.sqrt(2 * fromBody.GM / rNow) * 1.04;
        const vRel = this.relVel(fromBody).length();
        s.attitude = 'prograde';
        // Proportional taper to zero (no throttle floor): the gentle escape must
        // leave the SOI at barely above escape speed so the craft settles near the
        // home world's lane. A fixed floor on a strong engine adds a big Δv chunk
        // in the final step and overshoots, flinging the craft clear past home; a
        // floor-free proportional burn eases any engine — weak or mammoth — onto
        // escape speed without blowing past it.
        s.throttle = vRel >= vEsc
          ? 0
          : THREE.MathUtils.clamp((vEsc - vRel) / (vEsc * 0.06), 0, 1);
      } else {
        // Phase 2 — drop home. Lower the periapsis of the orbit AROUND THE TARGET
        // by burning retrograde *relative to the target* (not the instantaneous
        // dominant body, which can be the Sun out near a high apoapsis and would
        // send the craft the wrong way). Reentry + parachute / the landing
        // autopilot finishes the touchdown.
        const targetApsides = this.apsides(target);
        const returnPeriapsis = target.atmosphereHeight > 0 ? target.atmosphereHeight * 0.65 : target.radius * 0.08;
        if (targetApsides.peri <= returnPeriapsis) {
          s.throttle = 0;
          s.departAssist = false;
          s.departFromId = null;
          s.departTargetId = null;
        } else {
          const velRelTarget = s.velocity.clone().sub(target.velocity);
          if (velRelTarget.lengthSq() > 1e-10) this.aimToward(velRelTarget.negate(), up);
          s.attitude = 'manual';
          s.throttle = 1;
        }
      }
    }

    // --- Transfer autopilot (homing cruise to a moving target) ---
    // Replaces the old open-loop "burn at a transfer window, coast to a fixed
    // apoapsis" — which can't hit a target that is itself orbiting. Instead it
    // (1) climbs prograde out of the launch world's gravity well, then (2) homes
    // on the target's *led* position like a guided cruise, easing its closing
    // speed down as it nears so the arrival capture is cheap. The target's own
    // gravity taking over (or the at-soi-entry node) hands off to the capture /
    // descent autopilot.
    if (s.transferAssist && !s.circularizeAssist) {
      const tgt = this.bodies.find((b) => b.id === s.transferTargetId);
      if (!tgt) {
        s.transferAssist = false;
      } else if (body.id === tgt.id) {
        // The target now dominates — capture/descent takes it from here.
        s.transferAssist = false;
        s.transferTargetId = null;
      } else {
        const toTgt = new THREE.Vector3().subVectors(tgt.center, s.position);
        const dist = toTgt.length();
        const ap = this.apsides(body);
        const apoR = Number.isFinite(ap.apo) ? ap.apo + body.radius : Infinity;
        const periR = s.periapsis + body.radius;
        // Distance from the body we're climbing out of to the target — i.e. how
        // far the apoapsis must reach to get up to the target's orbital lane.
        const laneR = tgt.center.distanceTo(body.center);
        // "Moon-like" = the target orbits the (non-Sun) world we're currently at,
        // e.g. our Moon while parked at Earth. NOT a planet while in Sun-space —
        // a planet's parent IS the Sun, but that's the interplanetary case below.
        const moonLike = !!tgt.orbit && tgt.orbit.parentId === body.id && !body.star;
        if (moonLike) {
          // The target orbits the very body we're parked around (a moon). Fly a
          // phased Hohmann: WAIT in the parking orbit until the geometry is right,
          // then raise apoapsis to the moon's lane so the craft arrives at apoapsis
          // exactly when the moon is there — a gentle, single-burn rendezvous (the
          // craft is slow at apoapsis, so the relative speed is small and capture
          // is cheap). `transferClimbed` latches once the window opens so the burn
          // isn't abandoned mid-climb.
          if (!s.transferClimbed) {
            if (this.transferWindowOpen(body, tgt)) s.transferClimbed = true;
          }
          if (!s.transferClimbed) {
            s.attitude = 'prograde';
            s.throttle = 0;                 // hold the parking orbit, await window
          } else if (apoR < laneR * 0.985) {
            // Raise apoapsis to the lane, tapering throttle to zero as it nears so
            // even a very powerful engine eases up instead of blasting past into
            // an escape (the "shoots into space" failure).
            s.attitude = 'prograde';
            s.throttle = THREE.MathUtils.clamp((laneR - apoR) / (laneR * 0.12), 0, 1);
          } else {
            s.attitude = 'prograde';
            s.throttle = 0;                 // coast to apoapsis; capture grabs there
          }
        } else if (!body.star) {
          // Trans-target injection from the launch world's parking orbit. The
          // escape must leave in the RIGHT heliocentric direction or the craft
          // just ejects sunward and the launch world re-captures it ("launches
          // back toward Earth"). So we time the burn to the orbital phase where
          // the craft's prograde aligns with the desired heliocentric direction —
          // along the world's motion for an outer target, against it for an inner
          // one — then burn craft-prograde to just past escape velocity. That adds
          // the burn heliocentrically in the transfer direction, dropping the
          // craft into Sun-space already heading toward the target's lane; Lambert
          // then fine-tunes. Burning at the aligned phase is the heliocentric
          // equivalent of a Hohmann injection.
          const sun = this.bodies.find((b) => b.star);
          const helioR = sun ? s.position.distanceTo(sun.center) : laneR;
          const targetLane = tgt.orbit ? tgt.orbit.radius : laneR;
          const outward = targetLane >= helioR;
          const rNow = Math.max(s.position.distanceTo(body.center), body.radius);
          const vEsc = Math.sqrt(2 * body.GM / rNow) * 1.04;
          const vRel = this.relVel(body).length();
          const helioDir = body.velocity.clone();
          if (helioDir.lengthSq() < 1e-10) helioDir.copy(this.relVel(body));
          helioDir.normalize();
          const wantDir = outward ? helioDir : helioDir.clone().negate();
          const orbDir = this.relVel(body);
          const orbAlign = orbDir.lengthSq() > 1e-10 ? orbDir.clone().normalize().dot(wantDir) : 1;
          s.attitude = 'prograde';
          if (vRel >= vEsc) {
            s.throttle = 0;                 // escaping — coast out into Sun-space
          } else if (orbAlign > 0.55) {
            s.throttle = THREE.MathUtils.clamp((vEsc - vRel) / (vEsc * 0.12), 0.2, 1);
          } else {
            s.throttle = 0;                 // wrong phase — coast to the injection point
          }
        } else if (dist < Math.max(tgt.soiRadius * 6, tgt.radius + 160)) {
          // Rendezvous endgame. Once we're within a few SOI radii, stop chasing a
          // fixed arrival point and instead null the velocity RELATIVE TO THE
          // TARGET while easing in, so the craft slips into the SOI at low relative
          // speed — a cheap arrival the capture autopilot can brake into orbit.
          s.transferClimbed = true;
          const tgtRel = this.relVel(tgt);
          const escAtSoi = Math.sqrt(2 * tgt.GM / Math.max(tgt.soiRadius, tgt.radius + 1));
          const closeSpeed = THREE.MathUtils.clamp(dist * 0.02, 0.02, escAtSoi * 0.8);
          const desiredRel = toTgt.clone().normalize().multiplyScalar(closeSpeed);
          const correction = desiredRel.sub(tgtRel);
          if (correction.lengthSq() > 1e-10) this.aimToward(correction, up);
          const moonEndgame = !!tgt.orbit && tgt.orbit.parentId !== SUN_ID;
          const maxThrottle = moonEndgame ? 0.28 : 1;
          s.throttle = correction.length() > 0.01
            ? Math.min(maxThrottle, correction.length() * 3)
            : 0;
        } else {
          // Sun-space interplanetary cruise (the dominant body is the Sun).
          s.transferClimbed = true;
          // If the craft has only just slipped out of a non-target world's SOI it
          // is still deep in that world's neighbourhood (the SOIs are large at
          // arcade scale). Burning the Lambert intercept there is wasted — the
          // world's gravity warps it and the craft tends to dip back in. Coast
          // prograde until clear of every non-target world, THEN commit to the
          // intercept burn. This is what lets the craft keep enough Δv to actually
          // arrive at the target instead of stranding short ("ends up near Earth").
          let nearWorld = false;
          for (const o of this.bodies) {
            if (o.star || o.id === tgt.id) continue;
            if (s.position.distanceTo(o.center) < o.soiRadius * 1.6) { nearWorld = true; break; }
          }
          if (nearWorld) {
            s.attitude = 'prograde';
            s.throttle = 0;
          } else {
          // Lambert intercept guidance. Pick an arrival time once, ask where the
          // target WILL be then (its motion is analytic), and solve Lambert's
          // problem for the heliocentric velocity that puts us there at that
          // instant — burning the difference. Re-solving every step makes it a
          // closed loop that absorbs the messy ejection and the patched-conic
          // tides, and naturally handles inward (Mercury/Venus) and outward
          // (Jupiter…Neptune) transfers alike. The Sun sits at the origin, so the
          // craft's heliocentric position/velocity are just its world ones.
          const r1 = s.position.clone();
          const R = tgt.orbit ? tgt.orbit.radius : laneR;
          const pickArrival = () => {
            const a = (r1.length() + R) / 2;
            const tHohmann = Math.PI * Math.sqrt((a * a * a) / SUN_GM);
            // Aim for close to the minimum-energy (Hohmann) time of flight, only
            // mildly compressed for very distant targets. Forcing a far world like
            // Neptune to arrive far sooner than its Hohmann time demands a wildly
            // high-energy transfer whose arc dives sunward first — the craft
            // crashes into the Sun. Allowing up to ~85% above the floor keeps the
            // transfer near minimum-energy and sane while still bounding the cruise.
            s.transferArriveT = s.elapsed + THREE.MathUtils.clamp(tHohmann, 1500, 120000);
          };
          // (Re)pick the arrival on first entry, or after the window elapses on a
          // near miss so the closed loop keeps chasing a fresh intercept.
          if (s.transferArriveT === null || s.transferArriveT - s.elapsed <= 8) pickArrival();
          const tof = s.transferArriveT! - s.elapsed;
          const r2 = bodyStateAt(tgt.id, s.transferArriveT!).pos;
          const v1 = lambertV1(r1, r2, tof, SUN_GM);
          if (v1) {
            const correction = v1.sub(s.velocity);
            if (correction.lengthSq() > 1e-10) this.aimToward(correction, up);
            // Proportional throttle: burn hard to inject onto the transfer arc,
            // then ease to zero as heliocentric velocity reaches the Lambert
            // solution. A bang-bang full-throttle burn overshoots v1 every step on
            // a powerful engine — on an inward leg (a planet return, or an inner
            // transfer) that excess drives the perihelion down into the Sun and the
            // craft burns up. Easing off lets it settle ONTO the ballistic arc, so
            // re-solving returns ~the current velocity and it coasts to the SOI.
            const c = correction.length();
            s.throttle = c < 0.01 ? 0 : THREE.MathUtils.clamp(c * 5, 0, 1);
          } else {
            // Lambert degenerate: nudge prograde toward the target lane and retry.
            const desiredVel = toTgt.clone().normalize().multiplyScalar(0.3);
            const correction = desiredVel.sub(this.relVel(tgt));
            if (correction.lengthSq() > 1e-10) this.aimToward(correction, up);
            s.throttle = 1;
            s.transferArriveT = null;
          }
          }
        }
      }
    }

    // --- Non-target moon collision avoidance (during a transfer) ---
    // Escaping a world toward an interplanetary target, or cruising past one, the
    // craft's path can cross one of a world's small moons exactly when the moon is
    // there — the patched-conic then snaps to the moon and it slams into the
    // surface (the "crashes into the Moon on the way to Mars" bug). Predicting the
    // exact crossing is fiddly because the escape arc curves; instead, react: when
    // closing on a non-target moon's sphere of influence, thrust perpendicular to
    // the approach to widen the flyby until it's clear. Cheap, robust, and it only
    // engages in the rare moment a moon is actually in the way.
    if (s.transferAssist) {
      for (const m of this.bodies) {
        if (!m.orbit || m.orbit.parentId === SUN_ID) continue;
        // Skip the target itself and any moon of the target's system — arriving
        // there means flying *toward* that system, not dodging it.
        if (m.id === s.transferTargetId || m.orbit.parentId === s.transferTargetId) continue;
        const toM = new THREE.Vector3().subVectors(m.center, s.position);
        const d = toM.length();
        if (d < 1e-6 || d > m.soiRadius * 2.2) continue;
        const mHat = toM.multiplyScalar(1 / d);
        const vRel = this.relVel(m);
        if (vRel.dot(mHat) <= 0) continue;               // not closing on the moon
        // Steer along the velocity component perpendicular to the moon line —
        // pushing the flyby wider — falling back to a fixed perpendicular if the
        // approach is dead-on.
        let perp = vRel.clone().addScaledVector(mHat, -vRel.dot(mHat));
        if (perp.lengthSq() < 1e-8) perp.set(-mHat.y, mHat.x, 0);
        this.aimToward(perp.normalize(), up);
        s.throttle = 1;
        break;
      }
    }

    // --- Automatic attitude hold (prograde / retrograde) ---
    // Convert the desired thrust direction into the up/east aim angle so the
    // existing thrust + mesh code "just works". Everything stays in the x-y
    // plane, where the planets live.
    if (s.attitude !== 'manual') {
      // Prograde/retrograde are defined against motion *relative to the body we're
      // flying around*, so a retrograde brake actually kills orbital speed about a
      // moving planet instead of chasing its heliocentric motion.
      const bodyVel = this.relVel(body);
      if (bodyVel.lengthSq() > 1e-8) {
      const east = this.eastDir(up);
      const dir = (s.attitude === 'retrograde'
        ? bodyVel.clone().negate()
        : bodyVel.clone()).normalize();
      const cosA = THREE.MathUtils.clamp(dir.dot(up), -1, 1);
      const sinA = dir.dot(east);
      s.angle = THREE.MathUtils.radToDeg(Math.atan2(sinA, cosA));
      }
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
    // The chute's huge drag caps the descent at a slow (~10 m/s) terminal
    // velocity. Opening it high in a thin upper atmosphere makes the craft crawl
    // down for ages from tens of km up — the "chute opens super high, floats at
    // 5 m/s forever" problem. So only auto-open it when it is actually effective
    // and quick: down in the dense lower atmosphere, OR once the craft is out of
    // thrust (a ballistic descent that has nothing else to slow it). And never
    // open it while a powered descent is still braking with fuel — the engine
    // lands the craft far faster, and the chute would just stall that descent.
    const poweredDescentActive = s.landingAssist && this.hasThrust();
    const denseAtmosphere = altitude < body.atmosphereHeight * 0.3;
    if (
      this.cfg.hasParachute && !s.deployedParachute &&
      body.atmosphereHeight > 0 &&
      (denseAtmosphere || !this.hasThrust()) &&
      radialVel < 0 && altitude > 0.02 && returningToLand && !poweredDescentActive
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
      // Ride along with the (orbiting) body: re-pin to the surface beneath the
      // current body centre and match its velocity, so the craft stays planted on
      // the ground instead of being left behind as the world moves.
      const radialUp = new THREE.Vector3().subVectors(s.position, body.center);
      if (radialUp.lengthSq() < 1e-12) radialUp.copy(up);
      this.pinToSurface(body, radialUp);
      s.elapsed += dt;
      this.positionBodies();
      const pinned = this.pinnedBody() ?? body;
      this.pinToSurface(pinned, radialUp);
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
    const speed = this.relVel(body).length();
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
    if (s.landedBodyId !== null && s.phase !== 'landed' && this.altitude() > 0.2) {
      s.landedBodyId = null;
    }
  }

  /**
   * Apoapsis / periapsis altitude (km above surface) from the current
   * two-body orbital elements. Apoapsis is Infinity on an escape trajectory;
   * a negative periapsis means the orbit intersects the surface (will impact).
   */
  private apsides(body: Body): { apo: number; peri: number } {
    const s = this.state;
    const rel = new THREE.Vector3().subVectors(s.position, body.center);
    const relVel = this.relVel(body);
    const r = rel.length();
    const v = relVel.length();
    if (r < 1e-6) return { apo: 0, peri: 0 };
    const eps = (v * v) / 2 - body.GM / r;             // specific orbital energy
    const h = new THREE.Vector3().crossVectors(rel, relVel).length();
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
        const tgt = this.bodies.find((b) => b.id === t.targetBodyId);
        if (!tgt) return false;
        // A return-home SOI entry (the entry target is the launch world) must not
        // fire until the craft has actually REACHED the outbound destination. The
        // home world's SOI is wide enough to contain its own moon and to be
        // re-grazed by an interplanetary transfer arc, so without this the return
        // descent fires on the launch pad, or mid-outbound-cruise when the orbit
        // dips back through home — dragging the craft down before it ever gets to
        // the destination. Keying off "outbound target reached" is exact and makes
        // the legs strictly ordered: go there first, only then is coming home armed.
        const outboundTarget = destinationTargetId(this.plan.destinationId, this.plan.launchBodyId);
        const isReturnHome = t.targetBodyId === this.plan.launchBodyId;
        if (isReturnHome && outboundTarget && !this.state.reachedBodyIds.has(outboundTarget)) {
          return false;
        }
        // Launching from a moon toward its host planet, the craft STARTS inside
        // the host's SOI (the moon orbits within it), so a plain containment test
        // would fire on the pad. Require the host to actually dominate — i.e. the
        // craft has escaped the moon — before "arriving".
        const launchDef = bodyDef(this.plan.launchBodyId);
        const targetIsHostOfLaunch = launchDef.parent === t.targetBodyId;
        if (!targetIsHostOfLaunch &&
            this.state.position.distanceTo(tgt.center) <= tgt.soiRadius) return true;
        return dominantBody(this.bodies, this.state.position).id === tgt.id;
      }
      case 'after-orbit': {
        const current = this.body();
        if (current.star) return false;
        if (current.id === t.targetBodyId) return false;
        // A moon-hop transfer (target orbits a host planet that isn't the launch
        // world) must wait until that host has actually been reached — otherwise it
        // fires back at the launch-world parking orbit and tries to cross straight
        // to the moon, skipping the interplanetary leg to the host.
        if (node.actions.transfer && t.targetBodyId) {
          const td = bodyDef(t.targetBodyId);
          if (td.parent && td.parent !== SUN_ID && td.parent !== this.plan.launchBodyId &&
              !this.state.reachedBodyIds.has(td.parent)) {
            return false;
          }
        }
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
        // A bound orbit whose periapsis clears the atmosphere counts as "parked".
        // The floor is deliberately lenient: an underpowered build often settles a
        // marginal parking orbit (periapsis right at the atmosphere edge), and
        // gating it too high here would strand the whole transfer/return on the
        // pad of its parking orbit, never departing. Keyed off the atmosphere /
        // surface so it scales to any world (a tight SOI like the Moon's included).
        const periFloor = Math.max(
          this.minStableOrbitKm(current) * 0.6,
          current.atmosphereHeight > 0 ? current.atmosphereHeight * 0.55 : current.radius * 0.06,
        );
        if (node.actions.depart && !(this.state.prevRadialVel < 0 && radialVel >= 0 && altitudeNow > 1)) {
          return false;
        }
        return altitudeNow >= this.minStableOrbitKm(current) * 0.6 &&
          Number.isFinite(apsides.apo) &&
          apsides.peri >= periFloor;
      }
      case 'at-transfer-window': {
        // Fire when, from a parking orbit, the craft sits roughly opposite the
        // target so that a prograde outbound burn raises apoapsis toward it.
        // Return/departure burns aim directly home, so they fire from the near
        // side instead of burning through the body they are leaving.
        const tgt = this.bodies.find((b) => b.id === t.targetBodyId);
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
      const tgt = tgtId ? this.bodies.find((b) => b.id === tgtId) : undefined;
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
        s.landingAssist = false; s.ascentAssist = false; s.circularizeAssist = false; s.deorbitAssist = false; s.departAssist = false; s.departTargetId = null; s.transferAssist = false; s.transferTargetId = null;
      } else {
        s.landingAssist = true; s.landAfterCapture = false; s.ascentAssist = false; s.captureAssist = false; s.circularizeAssist = false; s.captureOrbitSign = 0; s.departAssist = false; s.departTargetId = null; s.transferAssist = false; s.transferTargetId = null; s.attitude = 'retrograde';
      }
    }
    if (a.ascend)  { s.ascentAssist = true; s.landingAssist = false; s.captureAssist = false; s.circularizeAssist = false; s.captureOrbitSign = 0; s.departAssist = false; s.departTargetId = null; s.transferAssist = false; s.transferTargetId = null; s.relaunchStart = s.elapsed; }
    if (a.transfer) { s.transferAssist = true; s.transferTargetId = node.trigger.targetBodyId ?? null; s.transferClimbed = false; s.transferArriveT = null; s.captureAssist = false; s.captureOrbitSign = 0; s.circularizeAssist = false; s.departAssist = false; s.departTargetId = null; s.landingAssist = false; s.ascentAssist = false; }
    if (a.capture) { s.captureAssist = true; s.captureTargetId = node.trigger.targetBodyId ?? null; s.captureOrbitSign = 0; s.circularizeAssist = false; s.departAssist = false; s.departTargetId = null; s.landingAssist = false; s.ascentAssist = false; s.transferAssist = false; s.transferTargetId = null; }
    if (a.circularize && !s.transferAssist && !s.captureAssist && !s.departAssist && !s.landingAssist && !s.ascentAssist) { s.circularizeAssist = true; s.captureAssist = false; s.captureOrbitSign = 0; s.departAssist = false; s.departTargetId = null; s.landingAssist = false; s.ascentAssist = false; s.transferAssist = false; s.transferTargetId = null; s.attitude = 'prograde'; }
    if (a.depart)  { s.departAssist = true; s.departFromId = this.body().id; s.departTargetId = node.trigger.targetBodyId ?? this.bodies[0]?.id ?? null; s.captureAssist = false; s.circularizeAssist = false; s.captureOrbitSign = 0; s.landingAssist = false; s.ascentAssist = false; s.transferAssist = false; s.transferTargetId = null; }
    // An explicit throttle command (e.g. a manual burn) takes manual control
    // back from the autopilots so the craft can leave orbit.
    if (a.throttle !== undefined && !a.descend && !a.ascend && !a.capture && !a.circularize && !a.depart && !a.transfer) {
      s.captureAssist = false; s.circularizeAssist = false; s.captureOrbitSign = 0; s.departAssist = false; s.departFromId = null; s.departTargetId = null; s.transferAssist = false; s.transferTargetId = null;
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
    // Strict patched-conic gravity (the KSP model): inside a body's SOI the
    // craft feels only that body; outside every planet/moon SOI it feels only
    // the Sun. SOI transitions, not background N-body tides, decide when another
    // world can affect the craft. This keeps local orbits stable at game scale
    // and prevents large planets from reaching across transfer space.
    const dom = dominantBody(this.bodies, pos);
    const acc = new THREE.Vector3();
    const domToC = new THREE.Vector3().subVectors(dom.center, pos);
    const domDist = Math.max(domToC.length(), dom.radius + 0.001);
    acc.add(this.bodyFrameAccel(dom));
    acc.addScaledVector(domToC.normalize(), dom.GM / (domDist * domDist));
    return acc;
  }

  /** Acceleration of an analytically orbiting body in the inertial scene frame. */
  private bodyFrameAccel(body: Body): THREE.Vector3 {
    if (!body.orbit) return new THREE.Vector3();
    const parent = this.bodies.find((b) => b.id === body.orbit!.parentId);
    if (!parent) return new THREE.Vector3();
    const rel = body.center.clone().sub(parent.center);
    return this.bodyFrameAccel(parent).addScaledVector(rel, -(body.orbit.omega * body.orbit.omega));
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

  /**
   * Phasing gate for a Hohmann transfer to a target that orbits the body we're
   * parked around (a moon). Returns true at the moment a prograde burn — which
   * raises apoapsis to the moon's lane on the far side of the orbit — will put
   * the craft at that apoapsis just as the moon arrives there, so the encounter
   * is a slow, cheap rendezvous instead of a hyperbolic flyby.
   */
  private transferWindowOpen(home: Body, tgt: Body): boolean {
    if (!tgt.orbit || tgt.orbit.parentId !== home.id) return true;
    const s = this.state;
    const cp = new THREE.Vector3().subVectors(s.position, home.center);
    const mp = new THREE.Vector3().subVectors(tgt.center, home.center);
    const rPark = cp.length();
    const R = tgt.orbit.radius;
    const a = (rPark + R) / 2;
    const tTransfer = Math.PI * Math.sqrt((a * a * a) / home.GM); // time to apoapsis
    const lead = tgt.orbit.omega * tTransfer;       // angle the moon sweeps en route
    const thetaC = Math.atan2(cp.y, cp.x);
    const thetaM = Math.atan2(mp.y, mp.x);
    // Want (thetaM − thetaC) ≡ π − lead, i.e. the moon trails the craft's eventual
    // apoapsis (thetaC + π) by exactly the angle it will cover during the transfer.
    let diff = (thetaM - thetaC) - (Math.PI - lead);
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    return Math.abs(diff) < 0.04;
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
    // The authored SOI now tracks each body's true gravitational dominance
    // radius, so a comfortably large fraction of it holds a stable orbit (well
    // inside the tidal edge). This must clear the surface + min-orbit floor for
    // small worlds whose dominance reaches only a little above the ground.
    return Math.max(minR + 1, body.soiRadius * 0.3);
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
    // Drag is against the atmosphere, which co-moves with the body — use the
    // body-relative velocity, not the heliocentric one (which carries the whole
    // world's orbital motion and would otherwise fake a constant gale).
    const rel = this.relVel(body);
    const speedSq = rel.lengthSq();
    if (speedSq < 1e-10) return new THREE.Vector3();
    const mag = 0.5 * rho * speedSq * cd * cross;
    return rel.normalize().multiplyScalar(-mag);
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
    // Impact is judged on the speed *relative to the body's surface*, not the
    // heliocentric speed (which includes the whole world's orbital motion).
    const relVel = this.relVel(body);
    const vRadial = radial.dot(relVel);
    const impactMs = Math.max(0, -vRadial) * 1000;
    s.lastImpactSpeedMs = impactMs;

    s.position.copy(body.center).addScaledVector(radial, body.radius + 0.001);

    if (!s.crashed && s.maxAltitude >= 0.2 && impactMs > this.safeLandingMs()) {
      s.crashed = true;
      s.velocity.copy(body.velocity);
      s.landedBodyId = body.id;
      return;
    }
    if (vRadial < 0) {
      // Match the body's motion on any soft touchdown (zero relative velocity).
      // Leaving relative tangential velocity causes the rocket to "slide" along
      // the surface and bounce between altitude 0 and 1 m every step while the
      // sim waits for the relative speed to fall below 1 m/s.
      this.pinToSurface(body, radial);
    }
    if (s.maxAltitude >= 0.2) s.landedBodyId = body.id;
  }

  private determinePhase(body: Body): SimPhase {
    const s = this.state;
    if (s.crashed) return 'destroyed';
    const altitude = Math.max(0, s.position.distanceTo(body.center) - body.radius);
    const onGround = altitude < 0.01;
    const relVel = this.relVel(body);
    const speedMs = relVel.length() * 1000;

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
      if (radial.dot(relVel) < -0.05 && s.maxAltitude >= KARMAN_LINE * 0.5) return 'reentry';
      return 'flight';
    }
    return 'flight';
  }
}
