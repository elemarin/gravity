import * as THREE from 'three';
import { buildSimStages } from './BuildSpec';
import { Body, buildFlightBodies, destinationTargetId } from './bodies';
import { FlightPlan } from './plan/FlightPlan';
import { SimConfig } from './plan/Simulator';
import { RocketBuild } from './types';

export const SIM_START_ALTITUDE = 0.001;

export type FlightSimSetup = {
  bodies: Body[];
  launchBodyId: string;
  startPosition: THREE.Vector3;
  config: SimConfig;
};

export function launchStartPosition(launchBody: Body): THREE.Vector3 {
  return launchBody.center.clone().add(new THREE.Vector3(0, launchBody.radius + SIM_START_ALTITUDE, 0));
}

export function buildFlightSimSetup(build: RocketBuild, plan: FlightPlan): FlightSimSetup {
  const bodies = buildFlightBodies(
    plan.launchBodyId,
    destinationTargetId(plan.destinationId, plan.launchBodyId),
  );
  const launchBody = bodies[0];
  const sim = buildSimStages(build);
  const startPosition = launchStartPosition(launchBody);

  return {
    bodies,
    launchBodyId: launchBody.id,
    startPosition,
    config: {
      bodies,
      stages: sim.stages,
      payloadMass: sim.payloadMass,
      landerIndex: sim.landerIndex,
      hasParachute: sim.hasParachute,
      hasLegs: sim.hasLegs,
      hasStation: sim.hasStation,
      stationMass: sim.stationMass,
      startPosition,
    },
  };
}
