import { FlightPlan, Maneuver, Trigger, ManeuverActions, newNodeId } from './FlightPlan';
import { buildFlightBodies, getDestination, bodyDef } from '../bodies';

/**
 * Guided flight-plan generator. Produces a ready-to-fly plan for a given
 * launch body + destination: a gravity-turn ascent into a parking orbit and,
 * for interplanetary destinations, a prograde transfer burn at the right
 * window, a coast, and an automatic powered descent + capture at the target.
 *
 * The transfer geometry is derived from the bodies, so the same plan works for
 * any reachable target — the player only has to build a capable enough rocket.
 */

function node(type: Trigger['type'], value: number | undefined, targetBodyId: string | undefined, actions: ManeuverActions): Maneuver {
  const trigger: Trigger = { type };
  if (value !== undefined) trigger.value = value;
  if (targetBodyId !== undefined) trigger.targetBodyId = targetBodyId;
  return { id: newNodeId(), trigger, actions };
}

/** Gravity-turn ascent into a parking orbit, scaled to the launch world. */
export function ascentNodes(launchId: string): Maneuver[] {
  const def = bodyDef(launchId);
  const atmo = def.atmosphereHeight;

  if (atmo > 0) {
    // Atmospheric world (Earth-like): tuned gravity turn → coast → circularize.
    const meco = atmo * 1.85;
    const insert = atmo * 1.5;
    return [
      node('at-altitude', atmo * 0.06, undefined, { heading: 22 }),
      node('at-altitude', atmo * 0.17, undefined, { heading: 45 }),
      node('at-altitude', atmo * 0.40, undefined, { heading: 66 }),
      node('at-altitude', atmo * 0.78, undefined, { heading: 82 }),
      node('at-apoapsis-altitude', meco, undefined, { heading: 90, throttle: 0 }),
      node('at-apoapsis', undefined, undefined, { heading: 90, throttle: 0.5 }),
      node('at-periapsis-altitude', insert, undefined, { throttle: 0 }),
    ];
  }

  // Airless world: short vertical lift then pitch over to a low parking orbit.
  const r = def.radius;
  const meco = r * 2.4;
  const insert = r * 1.9;
  return [
    node('at-altitude', r * 0.25, undefined, { heading: 30 }),
    node('at-altitude', r * 0.7,  undefined, { heading: 62 }),
    node('at-altitude', r * 1.3,  undefined, { heading: 85 }),
    node('at-apoapsis-altitude', meco, undefined, { heading: 90, throttle: 0 }),
    node('at-apoapsis', undefined, undefined, { heading: 90, throttle: 0.6 }),
    node('at-periapsis-altitude', insert, undefined, { throttle: 0 }),
  ];
}

/** A complete guided plan for launchId → destinationId. */
export function autoPlan(launchId: string, destId: string): FlightPlan {
  const dest = getDestination(destId);
  const nodes = ascentNodes(launchId);

  if (dest.targetId) {
    const bodies = buildFlightBodies(launchId, dest.targetId);
    const lb = bodies[0];
    const tb = bodies[1];
    const targetDist = lb.center.distanceTo(tb.center);
    // Raise apoapsis to the target's distance so the craft arrives at it.
    const apoTarget = targetDist - lb.radius;

    nodes.push(node('at-transfer-window', undefined, dest.targetId, { attitude: 'prograde', throttle: 1 }));
    nodes.push(node('at-apoapsis-altitude', apoTarget, undefined, { throttle: 0 }));
    // Capture + guided powered descent on arrival. A lander (if fitted)
    // separates for the touchdown; parachutes on atmospheric worlds auto-open.
    nodes.push(node('at-soi-entry', undefined, dest.targetId, { descend: true, deployLander: true }));
  }

  return {
    launchBodyId: launchId,
    destinationId: destId,
    launch: { heading: 0, power: 1 },
    nodes,
  };
}
