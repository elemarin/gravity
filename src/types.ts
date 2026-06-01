import * as THREE from 'three';

export type FlightPhase = 'prelaunch' | 'flight' | 'orbit' | 'reentry' | 'landed' | 'destroyed';

export type FlightState = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  altitude: number;
  speed: number;
  fuel: number;
  throttle: number;
  angle: number;
  phase: FlightPhase;
  maxAltitude: number;
};
