import * as THREE from 'three';

export type FlightPhase = 'prelaunch' | 'flight' | 'orbit' | 'reentry' | 'landed' | 'destroyed';

export type FlightState = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  altitude: number;      // km
  speed: number;         // km/s
  fuel: number;          // 0-100 (active stage)
  throttle: number;      // 0-1
  angle: number;         // degrees from local up
  phase: FlightPhase;
  maxAltitude: number;
  maxSpeed: number;      // km/s, peak speed reached this flight
  apoapsis?: number;     // km
  periapsis?: number;    // km
  activeStage: number;   // index of the currently firing stage
  stageCount: number;    // total stages in the rocket
  canStage: boolean;     // true when there is a lower stage to jettison
  parachuteDeployed: boolean;
  launchBodyId?: string;        // body the flight launched from
  landedBodyId?: string | null; // body currently/last landed on
  reachedBodyIds?: string[];    // bodies whose vicinity has been reached
  landerDeployed?: boolean;     // a lander payload has separated
  targetName?: string;          // destination body name, if any
  targetDistance?: number;      // km to the destination body surface
};

/** A single stage = one engine plus the fuel tanks feeding it. */
export type StageSpec = {
  engineId: string;
  tankIds: string[];
};

export type RocketBuild = {
  engineId: string;
  tankIds: string[];
  noseId: string;
  utilityIds: string[];
  /**
   * Optional explicit multi-stage definition, ordered bottom-first
   * (index 0 fires first and is jettisoned first). When present this is the
   * source of truth; `engineId`/`tankIds` mirror stage 0 for backward
   * compatibility with older saves and single-stage code paths.
   */
  stages?: StageSpec[];
  /**
   * Optional side-mounted boosters strapped to the first stage. They add
   * thrust + fuel to the launch stage and are jettisoned with it.
   */
  boosterIds?: string[];
  /**
   * Optional separable lander payload. When present it forms an extra top
   * "stage" with its own descent engine + fuel that the `deployLander`
   * maneuver action separates near a target body.
   */
  landerId?: string;
};

export const DEFAULT_BUILD: RocketBuild = {
  engineId: 'engine-basic',
  tankIds:  ['tank-basic', 'tank-basic'],
  noseId:   'nose-cone',
  utilityIds: [],
  boosterIds: [],
  stages: [{ engineId: 'engine-basic', tankIds: ['tank-basic', 'tank-basic'] }],
};

/** Summary of a completed flight, used to drive the mission-summary screen. */
export type MissionResult = {
  outcome: 'landed' | 'crashed';
  maxAltitude: number;   // km
  maxSpeed: number;      // km/s
  landingSpeed: number;  // m/s (impact vertical speed)
  reachedSpace: boolean;
  reachedOrbit: boolean;
  rating: string;        // letter grade
  score: number;
  /** Body ids whose vicinity the craft reached (e.g. 'earth', 'moon'). */
  reachedBodies: string[];
  /** Body the craft came to rest on, or null. */
  landedBody: string | null;
  /** True when the craft reached a body other than its launch body. */
  transferCompleted: boolean;
};

export type RocketStats = {
  dryMass:       number;
  wetMass:       number;
  fuelCapacity:  number;
  thrust:        number;
  burnRate:      number;
};

export type GameCallbacks = {
  onState?:             (state: FlightState) => void;
  onMilestoneComplete?: (milestoneId: string, unlocks: string[]) => void;
  onModeChange?:        (mode: 'plan' | 'sim') => void;
  onPreview?:           (info: { apoapsis: number; periapsis: number; impact: boolean }) => void;
  onThrustStart?:       () => void;
  onStageSeparation?:   () => void;
  onLanderDeploy?:      () => void;
  onTouchdown?:         (outcome: 'landed' | 'crashed', vSpeed: number) => void;
  onMissionEnd?:        (result: MissionResult) => void;
};
