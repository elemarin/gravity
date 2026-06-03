import * as THREE from 'three';
import { Renderer } from './Renderer';
import { Planet } from './entities/Planet';
import { Rocket, ROCKET_START_ALTITUDE } from './entities/Rocket';
import { Launchpad } from './entities/Launchpad';
import { TrajectoryLine } from './TrajectoryLine';
import { MilestoneManager } from './career/Milestones';
import { Simulator, SimConfig } from './plan/Simulator';
import { FlightPlan, DEFAULT_PLAN, clonePlan } from './plan/FlightPlan';
import { Body, dominantBody, getScenario } from './bodies';
import { buildSimStages } from './BuildSpec';
import {
  FlightState, FlightPhase, GameCallbacks, MissionResult, RocketBuild, DEFAULT_BUILD,
} from './types';
import { EARTH_BODY } from './bodies';
import { KARMAN_LINE } from './constants';

const FIXED_DT = 1 / 60;
const SKIP_MAX_STEPS = 600_000;

// Preview: forward-run the plan to draw the predicted arc.
const PREVIEW_DT = 0.25;
const PREVIEW_STEPS = 4000;
const PREVIEW_SAMPLE = 8;

export type GameMode = 'plan' | 'sim';

export type GameOptions = {
  container: HTMLElement;
  build?: RocketBuild;
  plan?: FlightPlan;
  completedMilestoneIds?: string[];
  callbacks?: GameCallbacks;
};

export class Game {
  renderer: Renderer;
  private planets: Planet[] = [];
  rocket: Rocket;
  private trajectory: TrajectoryLine;
  private milestones: MilestoneManager;
  private launchpad?: Launchpad;

  private bodies: Body[];
  private launchBodyId: string;
  private cfg: SimConfig;
  private sim: Simulator;
  private plan: FlightPlan;
  private build: RocketBuild;

  mode: GameMode = 'plan';
  timeScale = 1;

  private callbacks: GameCallbacks;
  private flightState!: FlightState;
  private accumulator = 0;
  private lastTime = 0;
  private rafHandle = 0;
  private running = false;
  private missionEnded = false;
  private fastForwarding = false;
  private simTrajectoryTimer = 0;

  constructor(opts: GameOptions) {
    this.callbacks = opts.callbacks ?? {};
    this.build = opts.build ?? DEFAULT_BUILD;
    this.plan = clonePlan(opts.plan ?? DEFAULT_PLAN);

    const scenario = getScenario(this.plan.scenarioId);
    this.bodies = scenario.bodies;
    this.launchBodyId = this.bodies[0]?.id ?? EARTH_BODY.id;

    this.renderer = new Renderer(opts.container);
    this.planets = this.bodies.map((b) => new Planet(this.renderer.scene, b));
    this.rocket = new Rocket(this.renderer.scene, this.build);
    this.trajectory = new TrajectoryLine(this.renderer.scene);
    this.milestones = new MilestoneManager(opts.completedMilestoneIds ?? []);
    this.milestones.onComplete = (m) => this.callbacks.onMilestoneComplete?.(m.id, m.unlocks);

    // Launchpad at the surface of the first/launch body
    const lb = this.launchBody();
    const surfacePos = lb.center.clone().add(new THREE.Vector3(0, lb.radius, 0));
    this.launchpad = new Launchpad(this.renderer.scene, surfacePos, lb.center);

    this.cfg = this.buildConfig();
    this.sim = new Simulator(this.cfg, this.plan);

    this.flightState = this.buildFlightState();
    this.updatePreview();
  }

  private launchBody(): Body {
    return this.bodies.find((b) => b.id === this.launchBodyId) ?? this.bodies[0];
  }

  private startPosition(): THREE.Vector3 {
    const b = this.launchBody();
    return b.center.clone().add(new THREE.Vector3(0, b.radius + ROCKET_START_ALTITUDE, 0));
  }

  private buildConfig(): SimConfig {
    const sim = buildSimStages(this.build);
    return {
      bodies: this.bodies,
      stages: sim.stages,
      payloadMass: sim.payloadMass,
      landerIndex: sim.landerIndex,
      hasParachute: sim.hasParachute,
      hasLegs: sim.hasLegs,
      startPosition: this.startPosition(),
    };
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

  /** Begin executing the plan. */
  play() {
    this.mode = 'sim';
    this.missionEnded = false;
    this.timeScale = 1;
    this.sim.reset();
    this.rocket.reset(this.startPosition());
    this.simTrajectoryTimer = 0; // update trajectory immediately
    this.flightState = this.buildFlightState();
    this.callbacks.onModeChange?.('sim');
    this.callbacks.onState?.(this.flightState);
  }

  /** Return to planning, rewinding the rocket to the pad. */
  edit() {
    this.mode = 'plan';
    this.missionEnded = false;
    this.timeScale = 1;
    this.sim.reset();
    this.rocket.reset(this.startPosition());
    this.flightState = this.buildFlightState();
    this.updatePreview();
    this.callbacks.onModeChange?.('plan');
    this.callbacks.onState?.(this.flightState);
  }

  setBuild(build: RocketBuild) {
    this.build = build;
    this.rocket.setBuild(build);
    this.cfg = this.buildConfig();
    this.sim.setConfig(this.cfg);
    this.edit();
  }

  setPlan(plan: FlightPlan) {
    this.plan = clonePlan(plan);
    this.sim.setPlan(this.plan);
    this.sim.reset();
    this.rocket.reset(this.startPosition());
    if (this.mode === 'plan') this.updatePreview();
    this.flightState = this.buildFlightState();
    this.callbacks.onState?.(this.flightState);
  }

  /** Live aim update from the Angry-Birds drag controller. */
  setLaunch(heading: number, power: number) {
    this.plan.launch.heading = THREE.MathUtils.clamp(heading, -90, 90);
    this.plan.launch.power = THREE.MathUtils.clamp(power, 0, 1);
    this.sim.setPlan(this.plan);
    if (this.mode === 'plan') {
      this.sim.reset();
      this.rocket.reset(this.startPosition());
      this.updatePreview();
    }
  }

  getPlan(): FlightPlan { return clonePlan(this.plan); }

  /** Forward-run a sandbox simulation to draw the predicted trajectory. */
  private updatePreview() {
    const preview = new Simulator(this.cfg, this.plan);
    preview.reset();
    const points: THREE.Vector3[] = [preview.state.position.clone()];
    let apo = 0;
    let peri = Number.POSITIVE_INFINITY;
    let impact = false;
    let touchdown = false;
    let passedApo = false;
    let prevAlt = 0;

    for (let i = 0; i < PREVIEW_STEPS; i++) {
      preview.step(PREVIEW_DT);
      const alt = preview.altitude();
      apo = Math.max(apo, alt);
      if (alt < prevAlt) passedApo = true;
      if (passedApo) peri = Math.min(peri, alt);
      prevAlt = alt;
      if (i % PREVIEW_SAMPLE === 0) points.push(preview.state.position.clone());
      if (preview.finished) {
        impact = preview.state.phase === 'destroyed' ||
                 (preview.state.landedBodyId !== null && alt < 0.2 && preview.state.maxAltitude > 0.2 &&
                  preview.state.lastImpactSpeedMs > 30);
        touchdown = preview.state.landedBodyId !== null || preview.state.phase === 'destroyed';
        points.push(preview.state.position.clone());
        break;
      }
    }

    if (!Number.isFinite(peri)) peri = apo;

    let color = 0x00e5ff;
    if (impact) color = 0xff5577;
    else if (peri < KARMAN_LINE * 0.5) color = 0xffd54a;
    else if (peri >= 80) color = 0x2ee59d;

    const body = this.launchBody();
    this.trajectory.update(points, color, body.center, body.radius, touchdown);
    this.trajectory.setVisible(true);

    this.flightState = { ...this.flightState, apoapsis: apo, periapsis: impact ? 0 : peri };
    this.callbacks.onPreview?.({ apoapsis: apo, periapsis: impact ? 0 : peri, impact });
    this.callbacks.onState?.(this.flightState);
  }

  /** Fast-forward the watched flight to its end. */
  skipToCompletion() {
    if (this.mode !== 'sim' || this.sim.finished) return;
    this.fastForwarding = true;
    for (let i = 0; i < SKIP_MAX_STEPS; i++) {
      this.sim.step(FIXED_DT);
      this.afterStep(FIXED_DT, false);
      if (this.sim.finished) break;
    }
    this.fastForwarding = false;

    // If the rocket is in a stable orbit and never landed, end the mission now.
    if (!this.missionEnded && this.sim.state.everOrbit) {
      this.missionEnded = true;
      this.callbacks.onMissionEnd?.(this.buildMissionResult('landed'));
    }

    this.rocket.applyState(this.sim.state, this.dominant().center, FIXED_DT);
    this.flightState = this.buildFlightState();
    this.callbacks.onState?.(this.flightState);
    this.renderer.render();
  }

  private dominant(): Body { return dominantBody(this.bodies, this.sim.state.position); }

  private loop = (time: number) => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.loop);

    const realDt = Math.min((time - this.lastTime) / 1000, 0.1);
    let rawDt = realDt;
    this.lastTime = time;

    if (this.mode === 'sim' && !this.sim.finished) {
      rawDt *= this.timeScale;
      this.accumulator += rawDt;
      while (this.accumulator >= FIXED_DT) {
        this.sim.step(FIXED_DT);
        this.afterStep(FIXED_DT, true);
        this.accumulator -= FIXED_DT;
        if (this.sim.finished) break;
      }
      const center = this.dominant().center;
      this.rocket.applyState(this.sim.state, center, FIXED_DT);
      this.renderer.updateCameraOffset(this.sim.altitude());
      this.renderer.followTarget(this.rocket.position, FIXED_DT);
      this.flightState = this.buildFlightState();
      this.callbacks.onState?.(this.flightState);

      this.simTrajectoryTimer -= realDt;
      if (this.simTrajectoryTimer <= 0) {
        this.simTrajectoryTimer = 0.1;
        this.updateSimTrajectory();
      }
    } else {
      const center = this.dominant().center;
      this.rocket.applyState(this.sim.state, center, FIXED_DT);
      this.renderer.followTarget(this.rocket.position, FIXED_DT);
    }

    this.renderer.render();
  };

  /** Per-step side effects: thrust haptics, milestones, mission end. */
  private afterStep(_dt: number, fireEvents: boolean) {
    const s = this.sim.state;

    if (fireEvents) {
      if (s.justIgnited) this.callbacks.onThrustStart?.();
      if (s.justStagedTo >= 0 && !s.justDeployedLander) {
        this.rocket.emitStageBurst();
        this.callbacks.onStageSeparation?.();
      }
      if (s.justDeployedLander) {
        this.rocket.emitStageBurst();
        this.callbacks.onLanderDeploy?.();
      }
      if (s.justDeployedParachute) this.rocket.emitParachuteBurst();
    }

    this.flightState = this.buildFlightState();
    this.milestones.check(this.flightState);

    if (this.sim.finished && !this.missionEnded) {
      this.missionEnded = true;
      const outcome = s.phase === 'landed' ? 'landed' : 'crashed';
      if (fireEvents) this.callbacks.onTouchdown?.(outcome, s.lastImpactSpeedMs);
      this.callbacks.onMissionEnd?.(this.buildMissionResult(outcome));
    }
  }

  private buildMissionResult(outcome: 'landed' | 'crashed'): MissionResult {
    const s = this.sim.state;
    const maxAltitude = s.maxAltitude;
    const reachedSpace = maxAltitude >= KARMAN_LINE;
    const reachedBodies = Array.from(s.reachedBodyIds);
    const transferCompleted = reachedBodies.some((id) => id !== this.launchBodyId);

    let score = Math.round(maxAltitude * 10);
    if (reachedSpace)         score += 500;
    if (s.everOrbit)          score += 1500;
    if (outcome === 'landed') score += 1000;
    if (transferCompleted)    score += 2500;

    let rating = 'D';
    if (score >= 4000)      rating = 'S';
    else if (score >= 2500) rating = 'A';
    else if (score >= 1200) rating = 'B';
    else if (score >= 400)  rating = 'C';

    return {
      outcome,
      maxAltitude,
      maxSpeed: s.maxSpeed,
      landingSpeed: s.lastImpactSpeedMs,
      reachedSpace,
      reachedOrbit: s.everOrbit,
      rating,
      score,
      reachedBodies,
      landedBody: s.landedBodyId,
      transferCompleted,
    };
  }

  private buildFlightState(): FlightState {
    const s = this.sim.state;
    const altitude = this.sim.altitude();
    const speed = s.velocity.length();
    const stageCount = this.cfg.stages.length;
    return {
      position: s.position.clone(),
      velocity: s.velocity.clone(),
      altitude,
      speed,
      fuel: s.stageFuel[s.activeStage] ?? 0,
      throttle: s.throttle,
      angle: s.angle,
      phase: s.phase as FlightPhase,
      maxAltitude: s.maxAltitude,
      maxSpeed: s.maxSpeed,
      apoapsis: this.flightState?.apoapsis,
      periapsis: this.flightState?.periapsis,
      activeStage: s.activeStage,
      stageCount,
      canStage: s.activeStage < stageCount - 1,
      parachuteDeployed: s.deployedParachute,
      launchBodyId: this.launchBodyId,
      landedBodyId: s.landedBodyId,
      reachedBodyIds: Array.from(s.reachedBodyIds),
      landerDeployed: s.deployedLander,
    };
  }

  get hasParachute(): boolean { return this.cfg.hasParachute; }
  get hasLander(): boolean { return this.cfg.landerIndex >= 0; }

  manualStage() {
    if (this.mode !== 'sim' || this.sim.finished) return;
    const staged = this.sim.manualStage();
    if (staged) {
      this.rocket.emitStageBurst();
      this.callbacks.onStageSeparation?.();
    }
  }

  manualParachute() {
    if (this.mode !== 'sim' || this.sim.finished) return;
    const deployed = this.sim.manualParachute();
    if (deployed) this.rocket.emitParachuteBurst();
  }

  manualLander() {
    if (this.mode !== 'sim' || this.sim.finished) return;
    const deployed = this.sim.manualDeployLander();
    if (deployed) {
      this.rocket.emitStageBurst();
      this.callbacks.onLanderDeploy?.();
    }
  }

  /** Forward-predict trajectory from current sim state and refresh the line. */
  private updateSimTrajectory() {
    const cur = this.sim.state;
    const preview = new Simulator(this.cfg, this.plan);
    preview.reset();
    const s = preview.state;
    s.position.copy(cur.position);
    s.velocity.copy(cur.velocity);
    s.angle          = cur.angle;
    s.throttle       = cur.throttle;
    s.activeStage    = cur.activeStage;
    s.stageFuel      = [...cur.stageFuel];
    s.deployedLander    = cur.deployedLander;
    s.deployedParachute = cur.deployedParachute;
    s.elapsed        = cur.elapsed;
    s.phase          = cur.phase;
    s.maxAltitude    = cur.maxAltitude;
    s.maxSpeed       = cur.maxSpeed;
    s.apoapsis       = cur.apoapsis;
    s.periapsis      = cur.periapsis;
    s.crashed        = cur.crashed;
    s.everOrbit      = cur.everOrbit;
    s.landedBodyId   = cur.landedBodyId;
    s.lastImpactSpeedMs = cur.lastImpactSpeedMs;
    s.prevRadialVel  = cur.prevRadialVel;
    s.firedNodeIds   = new Set(cur.firedNodeIds);
    s.reachedBodyIds = new Set(cur.reachedBodyIds);

    const points: THREE.Vector3[] = [cur.position.clone()];
    let touchdown = false;
    for (let i = 0; i < PREVIEW_STEPS; i++) {
      preview.step(PREVIEW_DT);
      if (i % PREVIEW_SAMPLE === 0) points.push(preview.state.position.clone());
      if (preview.finished) {
        touchdown = preview.state.landedBodyId !== null || preview.state.phase === 'destroyed';
        points.push(preview.state.position.clone());
        break;
      }
    }

    let color = 0x00e5ff;
    if (preview.state.crashed) color = 0xff5577;
    else if (preview.state.periapsis > 0 && preview.state.periapsis < 80) color = 0xffd54a;
    else if (preview.state.periapsis >= 80) color = 0x2ee59d;

    const body = this.dominant();
    this.trajectory.update(points, color, body.center, body.radius, touchdown);
  }

  getNextMilestone() { return this.milestones.getNextTarget(); }

  destroy() {
    this.stop();
    this.trajectory.dispose();
    this.rocket.dispose();
    this.launchpad?.dispose();
    this.planets.forEach((p) => p.dispose());
    this.renderer.dispose();
  }
}
