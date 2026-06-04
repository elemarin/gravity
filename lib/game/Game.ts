import * as THREE from 'three';
import { Renderer } from './Renderer';
import { Planet } from './entities/Planet';
import { Rocket } from './entities/Rocket';
import { Launchpad } from './entities/Launchpad';
import { TrajectoryLine } from './TrajectoryLine';
import { TrailLine } from './TrailLine';
import { MilestoneManager } from './career/Milestones';
import { Simulator, SimConfig } from './plan/Simulator';
import { FlightPlan, DEFAULT_PLAN, clonePlan, describeActions, describeTrigger } from './plan/FlightPlan';
import { Body, dominantBody, bodyDef } from './bodies';
import { orbitEllipse } from './orbit';
import { buildFlightSimSetup, launchStartPosition } from './SimSetup';
import {
  FlightState, FlightPhase, GameCallbacks, MissionResult, RocketBuild, DEFAULT_BUILD,
} from './types';
import { KARMAN_LINE } from './constants';

const FIXED_DT = 1 / 60;

// Preview: forward-run the plan to draw the predicted arc.
const PREVIEW_DT = 0.25;
const PREVIEW_STEPS = 4000;
const PREVIEW_SAMPLE = 8;
const SIM_TRAJECTORY_STEPS = 16000;
const SIM_TRAJECTORY_SAMPLE = 12;

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
  private trail: TrailLine;
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
  /** The flight is over (summary shown) — set by a crash or a manual Finish. */
  private ended = false;
  private prevSimPhase = 'prelaunch';
  private simTrajectoryTimer = 0;
  private previewHandle = 0;

  constructor(opts: GameOptions) {
    this.callbacks = opts.callbacks ?? {};
    this.build = opts.build ?? DEFAULT_BUILD;
    this.plan = clonePlan(opts.plan ?? DEFAULT_PLAN);

    const setup = buildFlightSimSetup(this.build, this.plan);
    this.bodies = setup.bodies;
    this.launchBodyId = setup.launchBodyId;
    this.cfg = setup.config;

    this.renderer = new Renderer(opts.container);
    this.planets = this.bodies.map((b) => new Planet(this.renderer.scene, b));
    this.rocket = new Rocket(this.renderer.scene, this.build);
    this.trajectory = new TrajectoryLine(this.renderer.scene);
    this.trail = new TrailLine(this.renderer.scene);
    this.milestones = new MilestoneManager(opts.completedMilestoneIds ?? []);
    this.milestones.onComplete = (m) => this.callbacks.onMilestoneComplete?.(m.id, m.unlocks);

    // Launchpad at the surface of the first/launch body
    const lb = this.launchBody();
    const surfacePos = lb.center.clone().add(new THREE.Vector3(0, lb.radius, 0));
    this.launchpad = new Launchpad(this.renderer.scene, surfacePos, lb.center);

    // Sky tint follows the launch world's atmosphere (bright day at the
    // surface, fading to space with altitude).
    const ld = bodyDef(this.launchBodyId);
    this.renderer.setSky(ld.skyDay, ld.atmosphereHeight);

    this.sim = new Simulator(this.cfg, this.plan);

    this.flightState = this.buildFlightState();
    this.updatePreview();
    this.frameRocket(true);
  }

  /** Frame the camera so the whole rocket is visible on the pad. */
  private frameRocket(snap = false) {
    this.renderer.setRocketHeight(this.rocket.getHeight());
    this.renderer.updateCameraOffset(0);
    if (snap) {
      const center = this.dominant().center;
      const up = this.rocket.position.clone().sub(center).normalize();
      this.renderer.snapTo(this.rocket.position, up);
    }
  }

  private launchBody(): Body {
    return this.bodies.find((b) => b.id === this.launchBodyId) ?? this.bodies[0];
  }

  private startPosition(): THREE.Vector3 {
    return launchStartPosition(this.launchBody());
  }

  private buildConfig(): SimConfig {
    const setup = buildFlightSimSetup(this.build, this.plan);
    this.bodies = setup.bodies;
    this.launchBodyId = setup.launchBodyId;
    return setup.config;
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
    this.ended = false;
    this.prevSimPhase = 'prelaunch';
    this.timeScale = 1;
    this.sim.reset();
    this.rocket.reset(this.startPosition());
    this.simTrajectoryTimer = 0; // update trajectory immediately
    this.trail.reset();
    this.flightState = this.buildFlightState();
    this.frameRocket(true);
    this.callbacks.onModeChange?.('sim');
    this.callbacks.onState?.(this.flightState);
  }

  /** Return to planning, rewinding the rocket to the pad. */
  edit() {
    this.mode = 'plan';
    this.missionEnded = false;
    this.ended = false;
    this.prevSimPhase = 'prelaunch';
    this.timeScale = 1;
    this.sim.reset();
    this.rocket.reset(this.startPosition());
    this.trail.reset();
    this.flightState = this.buildFlightState();
    this.updatePreview();
    this.frameRocket(true);
    this.callbacks.onModeChange?.('plan');
    this.callbacks.onState?.(this.flightState);
  }

  setBuild(build: RocketBuild) {
    this.build = build;
    this.rocket.setBuild(build);
    this.cfg = this.buildConfig();
    this.sim.setConfig(this.cfg);
    this.edit();
    this.frameRocket(true);
  }

  setPlan(plan: FlightPlan) {
    this.plan = clonePlan(plan);
    this.sim.setPlan(this.plan);
    this.sim.reset();
    // The rocket mesh doesn't depend on the plan, so don't rebuild it here —
    // the render loop repositions it from the reset sim state next frame. This
    // keeps plan edits (slider drags) cheap and fluid.
    if (this.mode === 'plan') this.schedulePreview();
    this.flightState = this.buildFlightState();
    this.callbacks.onState?.(this.flightState);
  }

  /**
   * Coalesce trajectory-preview recomputes so a rapid stream of plan edits
   * (dragging a slider) only forward-runs the sandbox sim once per frame instead
   * of on every input event — otherwise the heavy preview blocks the drag.
   */
  private schedulePreview() {
    if (this.previewHandle) return;
    this.previewHandle = requestAnimationFrame(() => {
      this.previewHandle = 0;
      if (this.mode === 'plan') this.updatePreview();
    });
  }

  /** Live aim update from the Angry-Birds drag controller. */
  setLaunch(heading: number, power: number) {
    this.plan.launch.heading = THREE.MathUtils.clamp(heading, -90, 90);
    this.plan.launch.power = THREE.MathUtils.clamp(power, 0, 1);
    this.sim.setPlan(this.plan);
    if (this.mode === 'plan') {
      this.sim.reset();
      this.schedulePreview();
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
    // If the plan settles into a stable orbit, preview the whole orbit loop
    // rather than the partial ascent arc the integration stopped at.
    const finalBody = dominantBody(this.bodies, preview.state.position);
    const ellipse = !impact && !touchdown
      ? orbitEllipse(finalBody, preview.state.position, preview.state.velocity)
      : null;
    if (ellipse) {
      this.trajectory.update(ellipse.points, color, finalBody.center, finalBody.radius, false);
    } else {
      this.trajectory.update(points, color, body.center, body.radius, touchdown);
    }
    this.trajectory.setVisible(true);

    this.flightState = { ...this.flightState, apoapsis: apo, periapsis: impact ? 0 : peri };
    this.callbacks.onPreview?.({ apoapsis: apo, periapsis: impact ? 0 : peri, impact });
    this.callbacks.onState?.(this.flightState);
  }

  private dominant(): Body { return dominantBody(this.bodies, this.sim.state.position); }

  private loop = (time: number) => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.loop);

    const realDt = Math.min((time - this.lastTime) / 1000, 0.1);
    let rawDt = realDt;
    this.lastTime = time;

    if (this.mode === 'sim' && !this.ended) {
      rawDt *= this.timeScale;
      this.accumulator += rawDt;
      while (this.accumulator >= FIXED_DT) {
        this.sim.step(FIXED_DT);
        this.afterStep(FIXED_DT, true);
        this.trail.push(this.sim.state.position);
        this.accumulator -= FIXED_DT;
        // Only a crash is terminal; a soft landing keeps simulating so the
        // player can deploy a base, relaunch, or finish the mission manually.
        if (this.sim.state.phase === 'destroyed') break;
      }
      const center = this.dominant().center;
      this.rocket.applyState(this.sim.state, center, FIXED_DT);
      this.renderer.updateCameraOffset(this.sim.altitude());
      this.renderer.updateSky(this.sim.altitude());
      const up = this.rocket.position.clone().sub(center).normalize();
      this.renderer.followTarget(this.rocket.position, FIXED_DT, up);
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
      this.renderer.updateCameraOffset(this.sim.altitude());
      const up = this.rocket.position.clone().sub(center).normalize();
      this.renderer.followTarget(this.rocket.position, FIXED_DT, up);
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

    // Touchdown feedback fires on the first landing/crash (sound + haptics),
    // but a soft landing no longer ENDS the flight — only a crash does that
    // automatically; otherwise the player ends it with the Finish button.
    const justLanded = this.prevSimPhase !== 'landed' && s.phase === 'landed';
    const justDestroyed = this.prevSimPhase !== 'destroyed' && s.phase === 'destroyed';
    this.prevSimPhase = s.phase;
    if (fireEvents && (justLanded || justDestroyed)) {
      this.callbacks.onTouchdown?.(justDestroyed ? 'crashed' : 'landed', s.lastImpactSpeedMs);
    }
    if (s.phase === 'destroyed' && !this.missionEnded) {
      this.missionEnded = true;
      this.ended = true;
      this.callbacks.onMissionEnd?.(this.buildMissionResult('crashed'));
    }
  }

  /**
   * Manually end the flight and report the result (the Finish button). Works at
   * any point — a safe craft (in orbit or landed) ends as a completed mission,
   * a destroyed one as a loss.
   */
  finishMission() {
    if (this.mode !== 'sim' || this.ended) return;
    this.ended = true;
    this.missionEnded = true;
    const outcome = this.sim.state.phase === 'destroyed' ? 'crashed' : 'landed';
    this.callbacks.onMissionEnd?.(this.buildMissionResult(outcome));
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
      stationDeployed: s.deployedStation,
      stationBodyId: s.stationBodyId,
    };
  }

  private buildFlightState(): FlightState {
    const s = this.sim.state;
    const altitude = this.sim.altitude();
    const speed = s.velocity.length();
    const stageCount = this.cfg.stages.length;
    // Distance to the destination body (the non-launch body), if any.
    const target = this.bodies.find((b) => b.id !== this.launchBodyId);
    const targetDistance = target
      ? Math.max(0, s.position.distanceTo(target.center) - target.radius)
      : undefined;
    const nextNodeIndex = this.plan.nodes.findIndex((n) => !s.firedNodeIds.has(n.id));
    const guidanceSteps = this.plan.nodes.map((node, index) => {
      const done = s.firedNodeIds.has(node.id);
      return {
        id: node.id,
        index,
        trigger: describeTrigger(node.trigger),
        action: describeActions(node.actions),
        status: done ? 'done' as const : index === nextNodeIndex ? 'current' as const : 'pending' as const,
      };
    });
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
      currentBodyId: this.dominant().id,
      landedBodyId: s.landedBodyId,
      reachedBodyIds: Array.from(s.reachedBodyIds),
      landerDeployed: s.deployedLander,
      stationDeployed: s.deployedStation,
      canDeployStation: this.sim.canDeployStation(),
      targetName: target?.name,
      targetDistance,
      guidanceSteps,
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

  /** Release the station module (the DEPLOY button) — in orbit or on a surface. */
  manualDeployStation() {
    if (this.mode !== 'sim' || this.ended) return;
    const bodyId = this.sim.manualDeployStation();
    if (bodyId) {
      this.rocket.deployStation();
      this.callbacks.onStationDeploy?.(bodyId, this.sim.state.stationDeployedOnSurface);
    }
  }

  get hasStation(): boolean { return this.cfg.hasStation; }

  /** De-orbit + land from the current orbit (the LAND button). */
  manualLand() {
    if (this.mode !== 'sim' || this.sim.finished) return;
    this.sim.manualDeorbit();
  }

  /** Forward-predict trajectory from current sim state and refresh the line. */
  private updateSimTrajectory() {
    const cur = this.sim.state;

    // A stable, surface-clearing orbit is drawn as its full analytic ellipse so
    // the path is a complete, steady loop rather than a half-arc that keeps
    // getting recomputed as the craft moves. Don't use it while guidance is
    // still pending; transfer/landing plans need the forward-simulated route.
    const body = this.dominant();
    const hasPendingGuidance =
      this.plan.nodes.some((n) => !cur.firedNodeIds.has(n.id)) ||
      cur.landingAssist ||
      cur.ascentAssist ||
      cur.captureAssist ||
      cur.deorbitAssist ||
      cur.departAssist;
    const ellipse = orbitEllipse(body, cur.position, cur.velocity);
    if (!hasPendingGuidance && ellipse && cur.phase !== 'prelaunch') {
      let color = 0x2ee59d;
      if (ellipse.periAlt < 80) color = 0xffd54a;
      this.trajectory.update(ellipse.points, color, body.center, body.radius, false);
      return;
    }

    const preview = new Simulator(this.cfg, this.plan);
    preview.reset();
    const s = preview.state;
    s.position.copy(cur.position);
    s.velocity.copy(cur.velocity);
    s.angle          = cur.angle;
    s.attitude       = cur.attitude;
    s.throttle       = cur.throttle;
    s.activeStage    = cur.activeStage;
    s.stageFuel      = [...cur.stageFuel];
    s.deployedLander    = cur.deployedLander;
    s.deployedParachute = cur.deployedParachute;
    s.landingAssist     = cur.landingAssist;
    s.ascentAssist      = cur.ascentAssist;
    s.captureAssist     = cur.captureAssist;
    s.captureTargetId   = cur.captureTargetId;
    s.captureOrbitSign  = cur.captureOrbitSign;
    s.deorbitAssist     = cur.deorbitAssist;
    s.departAssist      = cur.departAssist;
    s.departFromId      = cur.departFromId;
    s.departTargetId    = cur.departTargetId;
    s.landedTime        = cur.landedTime;
    s.relaunchStart     = cur.relaunchStart;
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
    for (let i = 0; i < SIM_TRAJECTORY_STEPS; i++) {
      preview.step(PREVIEW_DT);
      if (i % SIM_TRAJECTORY_SAMPLE === 0) points.push(preview.state.position.clone());
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

    const markerBody = touchdown ? dominantBody(this.bodies, preview.state.position) : body;
    this.trajectory.update(points, color, markerBody.center, markerBody.radius, touchdown);
  }

  getNextMilestone() { return this.milestones.getNextTarget(); }

  destroy() {
    this.stop();
    if (this.previewHandle) cancelAnimationFrame(this.previewHandle);
    this.trajectory.dispose();
    this.trail.dispose();
    this.rocket.dispose();
    this.launchpad?.dispose();
    this.planets.forEach((p) => p.dispose());
    this.renderer.dispose();
  }
}
