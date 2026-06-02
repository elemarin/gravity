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
};

export const DEFAULT_BUILD: RocketBuild = {
  engineId: 'engine-basic',
  tankIds:  ['tank-basic'],
  noseId:   'nose-cone',
  utilityIds: [],
  stages: [{ engineId: 'engine-basic', tankIds: ['tank-basic'] }],
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
  onPhaseChange?:       (phase: FlightPhase) => void;
  onOutOfFuel?:         () => void;
  onLanded?:            (vSpeed: number) => void;
  onCrashed?:           () => void;
  onMissionEnd?:        (result: MissionResult) => void;
};
