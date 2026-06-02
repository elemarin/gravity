import * as THREE from 'three';

export type FlightPhase = 'prelaunch' | 'flight' | 'orbit' | 'reentry' | 'landed' | 'destroyed';

export type FlightState = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  altitude: number;      // km
  speed: number;         // km/s
  fuel: number;          // 0-100
  throttle: number;      // 0-1
  angle: number;         // degrees from local up
  phase: FlightPhase;
  maxAltitude: number;
  apoapsis?: number;     // km
  periapsis?: number;    // km
};

export type RocketBuild = {
  engineId: string;
  tankIds: string[];
  noseId: string;
  utilityIds: string[];
};

export const DEFAULT_BUILD: RocketBuild = {
  engineId: 'engine-basic',
  tankIds:  ['tank-basic'],
  noseId:   'nose-cone',
  utilityIds: [],
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
};
