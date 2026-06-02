import * as THREE from 'three';
import { Renderer } from './Renderer';
import { InputManager } from './InputManager';
import { Earth } from './entities/Earth';
import { Rocket } from './entities/Rocket';
import { GravitySystem } from './physics/GravitySystem';
import { Atmosphere } from './physics/Atmosphere';
import { MilestoneManager } from './career/Milestones';
import { TrajectoryPredictor } from './TrajectoryPredictor';
import { TrajectoryLine } from './TrajectoryLine';
import { FlightState, FlightPhase, GameCallbacks, MissionResult, RocketBuild, DEFAULT_BUILD } from './types';
import { EARTH_CENTER, EARTH_RADIUS, KARMAN_LINE, GM } from './constants';

const FIXED_DT = 1 / 60;
const DRAG_COEFF = 0.008;

// Crash model: impact speed (m/s) tolerated before the rocket is destroyed.
const BASE_SAFE_LANDING_MS = 10;
const PARACHUTE_BONUS_MS   = 45;
const LEGS_BONUS_MS        = 10;

// Fast-forward cap (~55 sim-minutes) so a skip never loops forever.
const SKIP_MAX_STEPS = 200_000;

export type GameOptions = {
  container: HTMLElement;
  build?: RocketBuild;
  completedMilestoneIds?: string[];
  callbacks?: GameCallbacks;
};

export class Game {
  renderer: Renderer;
  input: InputManager;
  private earth: Earth;
  rocket: Rocket;
  private gravity: GravitySystem;
  private atmosphere: Atmosphere;
  private milestones: MilestoneManager;
  private predictor: TrajectoryPredictor;
  private trajectory: TrajectoryLine;

  private callbacks: GameCallbacks;
  private flightState!: FlightState;
  private accumulator = 0;
  private lastTime = 0;
  private rafHandle = 0;
  private running = false;

  timeScale = 1;
  private predictTimer = 0;
  private outOfFuelFired = false;
  private maxSpeed = 0;
  private everOrbit = false;
  private crashed = false;
  private missionEnded = false;
  private lastImpactSpeedMs = 0;
  private fastForwarding = false;

  constructor(opts: GameOptions) {
    this.callbacks  = opts.callbacks ?? {};
    this.renderer   = new Renderer(opts.container);
    this.input      = new InputManager();
    this.earth      = new Earth(this.renderer.scene);
    this.gravity    = new GravitySystem();
    this.atmosphere = new Atmosphere();
    this.rocket     = new Rocket(this.renderer.scene, opts.build ?? DEFAULT_BUILD);
    this.milestones = new MilestoneManager(opts.completedMilestoneIds ?? []);
    this.predictor  = new TrajectoryPredictor(this.gravity, this.atmosphere);
    this.trajectory = new TrajectoryLine(this.renderer.scene);

    this.milestones.onComplete = (m) => {
      this.callbacks.onMilestoneComplete?.(m.id, m.unlocks);
    };

    this.flightState = this.buildFlightState('prelaunch');
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafHandle = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  setBuild(build: RocketBuild) {
    this.rocket.setBuild(build);
    this.reset();
  }

  reset() {
    this.rocket.reset();
    this.outOfFuelFired = false;
    this.maxSpeed = 0;
    this.everOrbit = false;
    this.crashed = false;
    this.missionEnded = false;
    this.lastImpactSpeedMs = 0;
    this.flightState = this.buildFlightState('prelaunch');
    this.trajectory.setVisible(false);
    this.callbacks.onPhaseChange?.('prelaunch');
    this.callbacks.onState?.(this.flightState);
  }

  /** Jettison the active stage (called from the UI or keyboard). */
  triggerStage() { this.input.triggerStage(); }

  /**
   * Fast-forward the simulation to the next end-of-flight event (touchdown or
   * crash) so the player never has to wait out a long ballistic coast.
   */
  skipToCompletion() {
    const phase = this.flightState.phase;
    if (phase === 'prelaunch' || phase === 'landed' || phase === 'destroyed') return;

    this.fastForwarding = true;
    for (let i = 0; i < SKIP_MAX_STEPS; i++) {
      this.update(FIXED_DT);
      const p = this.flightState.phase;
      if (p === 'landed' || p === 'destroyed') break;
    }
    this.fastForwarding = false;

    this.updateTrajectory(this.flightState.altitude, this.flightState.phase);
    this.callbacks.onState?.(this.flightState);
    this.renderer.render();
  }

  private loop = (time: number) => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.loop);

    let rawDt = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;
    rawDt *= this.timeScale;

    this.accumulator += rawDt;
    while (this.accumulator >= FIXED_DT) {
      this.update(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
    this.renderer.render();
  };

  private update(dt: number) {
    if (!this.fastForwarding && this.input.consumeReset()) {
      this.reset();
      return;
    }
    if (!this.fastForwarding && this.input.consumeStage()) {
      this.rocket.stage();
    }

    const throttleDelta = this.input.getThrottleDelta();
    const rotation      = this.input.getRotation();

    if (throttleDelta !== 0) this.rocket.applyThrustDelta(throttleDelta * dt);
    if (rotation !== 0)      this.rocket.rotate(rotation, dt);

    const altitude = this.gravity.getAltitude(this.rocket.position);
    const onGround = altitude < 0.001;

    if (!onGround || this.rocket.velocity.lengthSq() > 0 || this.rocket.throttle > 0) {
      const grav   = this.gravity.getAcceleration(this.rocket.position);
      const thrust = this.rocket.getThrustAcceleration();
      const drag   = this.atmosphere.getDragAcceleration(altitude, this.rocket.velocity, DRAG_COEFF);

      const totalAccel = new THREE.Vector3().add(grav).add(thrust).add(drag);
      this.rocket.velocity.addScaledVector(totalAccel, dt);
      this.rocket.position.addScaledVector(this.rocket.velocity, dt);

      const newAlt = this.gravity.getAltitude(this.rocket.position);
      if (newAlt <= 0) this.clampToSurface();
    }

    this.rocket.update(dt);
    this.earth.update(dt);

    this.maxSpeed = Math.max(this.maxSpeed, this.rocket.velocity.length());

    const newPhase = this.determinePhase(altitude);
    if (newPhase === 'orbit') this.everOrbit = true;
    const phaseChanged = newPhase !== this.flightState.phase;
    this.flightState = this.buildFlightState(newPhase);

    // Detect a truly spent rocket (no fuel and no stage left to fire).
    if (
      !this.outOfFuelFired &&
      this.rocket.isSpent &&
      (newPhase === 'flight' || newPhase === 'reentry') &&
      this.flightState.maxAltitude * 1000 > 100 // launched past 100 m
    ) {
      this.outOfFuelFired = true;
      this.callbacks.onOutOfFuel?.();
    }

    // Trajectory prediction (throttled, skipped while fast-forwarding).
    if (!this.fastForwarding) {
      this.predictTimer -= dt;
      if (this.predictTimer <= 0) {
        this.predictTimer = 0.2;
        this.updateTrajectory(altitude, newPhase);
      }
    }

    this.milestones.check(this.flightState);

    if (phaseChanged) {
      this.callbacks.onPhaseChange?.(newPhase);
      if (newPhase === 'landed')    this.endMission('landed');
      if (newPhase === 'destroyed') this.endMission('crashed');
    }

    if (!this.fastForwarding) {
      this.renderer.updateCameraOffset(altitude);
      this.renderer.followTarget(this.rocket.position, dt);
      this.callbacks.onState?.(this.flightState);
    }
  }

  private endMission(outcome: 'landed' | 'crashed') {
    if (this.missionEnded) return;
    this.missionEnded = true;

    const landingSpeed = this.lastImpactSpeedMs;
    if (outcome === 'landed') this.callbacks.onLanded?.(landingSpeed);
    else                      this.callbacks.onCrashed?.();

    this.callbacks.onMissionEnd?.(this.buildMissionResult(outcome, landingSpeed));
  }

  private buildMissionResult(outcome: 'landed' | 'crashed', landingSpeed: number): MissionResult {
    const maxAltitude = this.flightState.maxAltitude;
    const reachedSpace = maxAltitude >= KARMAN_LINE;
    const reachedOrbit = this.everOrbit;

    let score = Math.round(maxAltitude * 10);
    if (reachedSpace)        score += 500;
    if (reachedOrbit)        score += 1500;
    if (outcome === 'landed') score += 1000;

    let rating = 'D';
    if (score >= 3000)      rating = 'S';
    else if (score >= 2000) rating = 'A';
    else if (score >= 1000) rating = 'B';
    else if (score >= 300)  rating = 'C';

    return {
      outcome,
      maxAltitude,
      maxSpeed: this.maxSpeed,
      landingSpeed,
      reachedSpace,
      reachedOrbit,
      rating,
      score,
    };
  }

  private safeLandingSpeedMs(): number {
    const utils = this.rocket.build.utilityIds;
    let safe = BASE_SAFE_LANDING_MS;
    if (utils.includes('parachute'))     safe += PARACHUTE_BONUS_MS;
    if (utils.includes('landing-legs'))  safe += LEGS_BONUS_MS;
    return safe;
  }

  private updateTrajectory(altitude: number, phase: FlightPhase) {
    if (phase === 'prelaunch' || phase === 'landed' || phase === 'destroyed' || altitude < 0.2) {
      this.trajectory.setVisible(false);
      return;
    }
    const dt = altitude > 50 ? 2.0 : 0.8;
    const steps = altitude > 100 ? 800 : 500;
    const pred = this.predictor.predict(
      this.rocket.position,
      this.rocket.velocity,
      DRAG_COEFF,
      dt,
      steps,
    );
    let color = 0x00e5ff;
    if (pred.impact) color = 0xff5577;
    else if (pred.periapsis < KARMAN_LINE * 0.5) color = 0xffd54a;
    else if (pred.periapsis >= 80) color = 0x2ee59d;

    this.trajectory.update(pred.points, color);

    this.flightState.apoapsis = pred.apoapsis;
    this.flightState.periapsis = pred.impact ? 0 : pred.periapsis;
  }

  private clampToSurface() {
    const radial = new THREE.Vector3()
      .subVectors(this.rocket.position, EARTH_CENTER)
      .normalize();
    const vRadial = radial.dot(this.rocket.velocity);
    const impactMs = Math.max(0, -vRadial) * 1000;
    this.lastImpactSpeedMs = impactMs;

    const toSurface = radial.clone().multiplyScalar(EARTH_RADIUS + 0.001);
    this.rocket.position.copy(EARTH_CENTER).add(toSurface);

    // Hard impact after a real flight destroys the rocket.
    if (
      !this.missionEnded &&
      !this.crashed &&
      this.flightState.maxAltitude >= 0.2 &&
      impactMs > this.safeLandingSpeedMs()
    ) {
      this.crashed = true;
      this.rocket.velocity.set(0, 0, 0);
      return;
    }

    if (vRadial < 0) {
      this.rocket.velocity.addScaledVector(radial, -vRadial);
      this.rocket.velocity.multiplyScalar(0.5);
      if (this.rocket.velocity.length() * 1000 < 0.5) {
        this.rocket.velocity.set(0, 0, 0);
      }
    }
  }

  private determinePhase(altitude: number): FlightPhase {
    if (this.crashed) return 'destroyed';

    const onGround = altitude < 0.01;
    const inSpace  = altitude >= KARMAN_LINE;
    const speedKm  = this.rocket.velocity.length();
    const speedMs  = speedKm * 1000;

    if (onGround && speedMs < 1 && this.rocket.throttle < 0.01) {
      return (this.flightState?.maxAltitude ?? 0) > 0.1 ? 'landed' : 'prelaunch';
    }
    if (inSpace) {
      const r = this.rocket.position.distanceTo(EARTH_CENTER);
      const vCirc = Math.sqrt(GM / r);
      const radial = new THREE.Vector3().subVectors(this.rocket.position, EARTH_CENTER).normalize();
      const vHoriz = this.rocket.velocity.clone().addScaledVector(radial, -radial.dot(this.rocket.velocity));
      if (vHoriz.length() > vCirc * 0.85) return 'orbit';
      return 'flight';
    }
    if (altitude > 0.01) {
      const radial = new THREE.Vector3().subVectors(this.rocket.position, EARTH_CENTER).normalize();
      if (radial.dot(this.rocket.velocity) < -0.05 && (this.flightState?.maxAltitude ?? 0) >= KARMAN_LINE * 0.5) {
        return 'reentry';
      }
      return 'flight';
    }
    return 'flight';
  }

  private buildFlightState(phase: FlightPhase): FlightState {
    const altitude = this.gravity.getAltitude(this.rocket.position);
    const speed = this.rocket.velocity.length();
    const maxAltitude = Math.max(this.flightState?.maxAltitude ?? 0, altitude);
    return {
      position:    this.rocket.position.clone(),
      velocity:    this.rocket.velocity.clone(),
      altitude,
      speed,
      fuel:        this.rocket.fuel,
      throttle:    this.rocket.throttle,
      angle:       this.rocket.angle,
      phase,
      maxAltitude,
      maxSpeed:    Math.max(this.maxSpeed, speed),
      apoapsis:    this.flightState?.apoapsis,
      periapsis:   this.flightState?.periapsis,
      activeStage: this.rocket.activeStage,
      stageCount:  this.rocket.stageCount,
      canStage:    this.rocket.canStage,
    };
  }

  getNextMilestone() { return this.milestones.getNextTarget(); }

  destroy() {
    this.stop();
    this.input.dispose();
    this.trajectory.dispose();
    this.rocket.dispose();
    this.earth.dispose();
    this.renderer.dispose();
  }
}
