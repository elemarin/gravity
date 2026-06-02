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
import { FlightState, FlightPhase, GameCallbacks, RocketBuild, DEFAULT_BUILD } from './types';
import { EARTH_CENTER, EARTH_RADIUS, KARMAN_LINE, GM } from './constants';

const FIXED_DT = 1 / 60;
const DRAG_COEFF = 0.008;

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
    this.flightState = this.buildFlightState('prelaunch');
    this.callbacks.onPhaseChange?.('prelaunch');
    this.callbacks.onState?.(this.flightState);
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
    if (this.input.consumeReset()) {
      this.reset();
      return;
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

    const newPhase = this.determinePhase(altitude);
    const phaseChanged = newPhase !== this.flightState.phase;
    this.flightState = this.buildFlightState(newPhase);

    // Detect out-of-fuel
    if (
      !this.outOfFuelFired &&
      this.rocket.fuel <= 0.01 &&
      (newPhase === 'flight' || newPhase === 'reentry') &&
      this.flightState.maxAltitude * 1000 > 100 // launched past 100 m
    ) {
      this.outOfFuelFired = true;
      this.callbacks.onOutOfFuel?.();
    }

    // Trajectory prediction (throttled)
    this.predictTimer -= dt;
    if (this.predictTimer <= 0) {
      this.predictTimer = 0.2;
      this.updateTrajectory(altitude, newPhase);
    }

    this.milestones.check(this.flightState);

    if (phaseChanged) {
      this.callbacks.onPhaseChange?.(newPhase);
      if (newPhase === 'landed') {
        const vSpeed = Math.abs(this.rocket.velocity.dot(
          new THREE.Vector3().subVectors(this.rocket.position, EARTH_CENTER).normalize()
        )) * 1000;
        this.callbacks.onLanded?.(vSpeed);
      }
    }

    this.renderer.updateCameraOffset(altitude);
    this.renderer.followTarget(this.rocket.position, dt);

    this.callbacks.onState?.(this.flightState);
  }

  private updateTrajectory(altitude: number, phase: FlightPhase) {
    if (phase === 'prelaunch' || altitude < 0.2) {
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
    // Color: green if stable orbit, yellow if reentering, red if crashing
    let color = 0x00e5ff;
    if (pred.impact) color = 0xff5577;
    else if (pred.periapsis < KARMAN_LINE * 0.5) color = 0xffd54a;
    else if (pred.periapsis >= 80) color = 0x2ee59d;

    this.trajectory.update(pred.points, color);

    // Stash apoapsis/periapsis on flight state
    this.flightState.apoapsis = pred.apoapsis;
    this.flightState.periapsis = pred.impact ? 0 : pred.periapsis;
  }

  private clampToSurface() {
    const toSurface = new THREE.Vector3()
      .subVectors(this.rocket.position, EARTH_CENTER)
      .normalize()
      .multiplyScalar(EARTH_RADIUS + 0.001);
    this.rocket.position.copy(EARTH_CENTER).add(toSurface);

    const radial = new THREE.Vector3()
      .subVectors(this.rocket.position, EARTH_CENTER)
      .normalize();
    const vRadial = radial.dot(this.rocket.velocity);
    if (vRadial < 0) {
      this.rocket.velocity.addScaledVector(radial, -vRadial);
      this.rocket.velocity.multiplyScalar(0.5);
      if (this.rocket.velocity.length() * 1000 < 0.5) {
        this.rocket.velocity.set(0, 0, 0);
      }
    }
  }

  private determinePhase(altitude: number): FlightPhase {
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
      apoapsis:    this.flightState?.apoapsis,
      periapsis:   this.flightState?.periapsis,
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
