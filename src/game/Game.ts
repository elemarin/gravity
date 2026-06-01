import * as THREE from 'three';
import { Renderer } from './Renderer';
import { InputManager } from './InputManager';
import { Earth } from '../entities/Earth';
import { Rocket } from '../entities/Rocket';
import { GravitySystem } from '../physics/GravitySystem';
import { Atmosphere } from '../physics/Atmosphere';
import { MilestoneManager } from '../career/Milestones';
import { PartsManager } from '../career/Parts';
import { HUD } from '../ui/HUD';
import { FlightState, FlightPhase } from '../types';
import { EARTH_CENTER, EARTH_RADIUS, KARMAN_LINE } from '../constants';

const FIXED_DT = 1 / 60;

export class Game {
  private renderer: Renderer;
  private input: InputManager;
  private earth: Earth;
  private rocket: Rocket;
  private gravity: GravitySystem;
  private atmosphere: Atmosphere;
  private milestones: MilestoneManager;
  private parts: PartsManager;
  private hud: HUD;

  private flightState: FlightState;
  private accumulator = 0;
  private lastTime    = 0;
  private running     = false;

  constructor() {
    this.renderer   = new Renderer();
    this.input      = new InputManager();
    this.earth      = new Earth(this.renderer.scene);
    this.rocket     = new Rocket(this.renderer.scene);
    this.gravity    = new GravitySystem();
    this.atmosphere = new Atmosphere();
    this.milestones = new MilestoneManager();
    this.parts      = new PartsManager();
    this.hud        = new HUD();

    this.flightState = this.buildFlightState();

    // Milestone completion callback
    this.milestones.onComplete = (m) => {
      this.hud.showToast(`🏆 ${m.name}\n${m.description}`, 4);
      this.parts.unlockAll(m.unlocks);
      const next = this.milestones.getNextTarget();
      if (next) this.hud.setNextMilestone(next.description);
    };

    // Show first milestone
    const first = this.milestones.getNextTarget();
    if (first) this.hud.setNextMilestone(first.description);
  }

  start() {
    this.running  = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private loop(time: number) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.loop(t));

    const rawDt = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    this.accumulator += rawDt;

    // Fixed timestep physics
    while (this.accumulator >= FIXED_DT) {
      this.update(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    this.renderer.render();
  }

  private update(dt: number) {
    // --- Input ---
    if (this.input.consumeReset()) {
      this.resetFlight();
      return;
    }

    const throttleDelta = this.input.getThrottleDelta();
    const rotation      = this.input.getRotation();

    if (throttleDelta !== 0) this.rocket.applyThrust(throttleDelta * dt);
    if (rotation !== 0)      this.rocket.rotate(rotation, dt);

    // --- Physics integration ---
    const altitude = this.gravity.getAltitude(this.rocket.position);
    const onGround = altitude < 0.001;

    if (!onGround || this.rocket.velocity.lengthSq() > 0 || this.rocket.throttle > 0) {
      // Gravity
      const gravAccel = this.gravity.getAcceleration(this.rocket.position);

      // Thrust
      const thrustAccel = this.rocket.getThrustAcceleration();

      // Atmosphere drag
      const dragAccel = this.atmosphere.getDragAcceleration(
        altitude,
        this.rocket.velocity,
        0.008
      );

      // Combine accelerations
      const totalAccel = new THREE.Vector3()
        .add(gravAccel)
        .add(thrustAccel)
        .add(dragAccel);

      // Integrate velocity and position (semi-implicit Euler)
      this.rocket.velocity.addScaledVector(totalAccel, dt);
      this.rocket.position.addScaledVector(this.rocket.velocity, dt);

      // Ground clamp
      const newAlt = this.gravity.getAltitude(this.rocket.position);
      if (newAlt <= 0) {
        this.clampToSurface();
      }
    }

    // Update rocket mesh + exhaust
    this.rocket.update(dt);

    // Earth rotation
    this.earth.update(dt);

    // --- Flight state ---
    this.flightState = this.buildFlightState();
    this.flightState.phase = this.determinePhase(altitude);

    // --- Milestone checks ---
    this.milestones.check(this.flightState);

    // --- Camera ---
    this.renderer.updateCameraOffset(altitude);
    this.renderer.followTarget(this.rocket.position, dt);

    // --- HUD ---
    this.hud.update(this.flightState, dt);
  }

  private clampToSurface() {
    // Project rocket position onto surface
    const toSurface = new THREE.Vector3()
      .subVectors(this.rocket.position, EARTH_CENTER)
      .normalize()
      .multiplyScalar(EARTH_RADIUS + 0.001);
    this.rocket.position.copy(EARTH_CENTER).add(toSurface);

    // Kill downward (toward center) velocity component
    const radial = new THREE.Vector3()
      .subVectors(this.rocket.position, EARTH_CENTER)
      .normalize();
    const vRadial = radial.dot(this.rocket.velocity);
    if (vRadial < 0) {
      this.rocket.velocity.addScaledVector(radial, -vRadial);
      // Simple ground friction
      this.rocket.velocity.multiplyScalar(0.6);
    }
  }

  private determinePhase(altitude: number): FlightPhase {
    const onGround   = altitude < 0.01;
    const inSpace    = altitude >= KARMAN_LINE;
    const speed      = this.rocket.velocity.length();

    if (onGround && speed < 0.001 && this.rocket.throttle < 0.01) {
      return this.flightState.maxAltitude > 0.1 ? 'landed' : 'prelaunch';
    }
    if (inSpace) {
      // Crude orbit detection: check if horizontal speed roughly matches circular velocity
      // v_circ ≈ sqrt(GM / r)
      const r    = this.rocket.position.distanceTo(EARTH_CENTER);
      const vCirc = Math.sqrt(9.81e-3 * EARTH_RADIUS * EARTH_RADIUS / r);
      const radial = new THREE.Vector3().subVectors(this.rocket.position, EARTH_CENTER).normalize();
      const vHoriz = this.rocket.velocity.clone().addScaledVector(radial, -radial.dot(this.rocket.velocity));
      if (vHoriz.length() > vCirc * 0.9) return 'orbit';
      return 'flight';
    }
    if (altitude > 0.01) {
      // Reentry: descending from space
      const radial = new THREE.Vector3().subVectors(this.rocket.position, EARTH_CENTER).normalize();
      if (radial.dot(this.rocket.velocity) < -0.05 && altitude < KARMAN_LINE * 1.2) return 'reentry';
      return 'flight';
    }
    return 'flight';
  }

  private buildFlightState(): FlightState {
    const altitude = this.gravity.getAltitude(this.rocket.position);
    const speed    = this.rocket.velocity.length();
    const maxAlt   = Math.max(this.flightState?.maxAltitude ?? 0, altitude);

    return {
      position:    this.rocket.position.clone(),
      velocity:    this.rocket.velocity.clone(),
      altitude,
      speed,
      fuel:        this.rocket.fuel,
      throttle:    this.rocket.throttle,
      angle:       this.rocket.angle,
      phase:       this.flightState?.phase ?? 'prelaunch',
      maxAltitude: maxAlt,
    };
  }

  private resetFlight() {
    this.rocket.reset();
    this.milestones.reset();
    this.flightState = {
      position:    this.rocket.position.clone(),
      velocity:    new THREE.Vector3(),
      altitude:    0,
      speed:       0,
      fuel:        100,
      throttle:    0,
      angle:       0,
      phase:       'prelaunch',
      maxAltitude: 0,
    };
    const first = this.milestones.getNextTarget();
    if (first) this.hud.setNextMilestone(first.description);
    this.hud.showToast('RESET', 1.5);
  }
}
