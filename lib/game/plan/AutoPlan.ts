import { FlightPlan, Maneuver, Trigger, ManeuverActions, MissionKind, MissionSpec, newNodeId } from './FlightPlan';
import { buildFlightBodies, getDestination, bodyDef } from '../bodies';

/**
 * Guided flight-plan generator. Produces a ready-to-fly plan for a launch body,
 * a destination, and an objective (orbit / land, optionally with a return leg).
 *
 * The plan is expressed entirely as position-based maneuver nodes the
 * deterministic Simulator understands, so the whole mission — ascent, transfer,
 * capture/descent, and the trip home — replays identically every time. The
 * geometry is derived from the bodies, so the same recipe scales to any target;
 * the player just needs a rocket capable enough to carry the delta-v.
 */

function node(type: Trigger['type'], value: number | undefined, targetBodyId: string | undefined, actions: ManeuverActions): Maneuver {
  const trigger: Trigger = { type };
  if (value !== undefined) trigger.value = value;
  if (targetBodyId !== undefined) trigger.targetBodyId = targetBodyId;
  return { id: newNodeId(), trigger, actions };
}

/** Sensible default parking/target orbit altitude (km) for a launch world. */
export function defaultOrbitKm(launchId: string): number {
  const def = bodyDef(launchId);
  if (def.atmosphereHeight > 0) return Math.round(def.atmosphereHeight * 1.6);
  return Math.round(def.radius * 1.4);
}

/** Gravity-turn ascent into a circular orbit at `orbitKm`, scaled to the world. */
export function ascentNodes(launchId: string, orbitKm: number): Maneuver[] {
  const def = bodyDef(launchId);
  const atmo = def.atmosphereHeight;
  const insert = Math.max(2, orbitKm * 0.85);

  if (atmo > 0) {
    // Atmospheric world (Earth-like): tuned gravity turn → coast → circularize.
    return [
      node('at-altitude', atmo * 0.06, undefined, { heading: 22 }),
      node('at-altitude', atmo * 0.17, undefined, { heading: 45 }),
      node('at-altitude', atmo * 0.40, undefined, { heading: 66 }),
      node('at-altitude', atmo * 0.78, undefined, { heading: 82 }),
      node('at-apoapsis-altitude', orbitKm, undefined, { heading: 90, throttle: 0 }),
      node('at-apoapsis', undefined, undefined, { heading: 90, throttle: 0.5 }),
      node('at-periapsis-altitude', insert, undefined, { throttle: 0 }),
    ];
  }

  // Airless world: short vertical lift then pitch over to a low parking orbit.
  const r = def.radius;
  return [
    node('at-altitude', r * 0.25, undefined, { heading: 30 }),
    node('at-altitude', r * 0.7,  undefined, { heading: 62 }),
    node('at-altitude', r * 1.3,  undefined, { heading: 85 }),
    node('at-apoapsis-altitude', orbitKm, undefined, { heading: 90, throttle: 0 }),
    node('at-apoapsis', undefined, undefined, { heading: 90, throttle: 0.6 }),
    node('at-periapsis-altitude', insert, undefined, { throttle: 0 }),
  ];
}

export type AutoPlanOptions = Partial<MissionSpec>;

/** A complete guided plan for launchId → destinationId with an objective. */
export function autoPlan(launchId: string, destId: string, opts: AutoPlanOptions = {}): FlightPlan {
  const dest = getDestination(destId);
  const kind: MissionKind = opts.kind ?? 'orbit';
  const orbitKm = opts.orbitKm ?? defaultOrbitKm(launchId);

  // Parking orbit for transfers stays low to save delta-v; orbitKm is the
  // *target* orbit at the destination body.
  const parkingKm = dest.targetId ? defaultOrbitKm(launchId) : orbitKm;
  const nodes = ascentNodes(launchId, parkingKm);

  if (!dest.targetId) {
    // Orbiting (or de-orbiting onto) the launch world itself.
    if (kind === 'land' || kind === 'land-return') {
      // Drop periapsis into the atmosphere and ride it down under chute/descent.
      nodes.push(node('at-apoapsis', undefined, undefined, { attitude: 'retrograde', throttle: 1 }));
      nodes.push(node('at-periapsis-altitude', -1, undefined, { throttle: 0 }));
      nodes.push(node('at-altitude', Math.max(2, orbitKm * 0.4), undefined, { descend: true, deployParachute: true }));
    }
    return finish(launchId, destId, kind, orbitKm, nodes);
  }

  // ── Interplanetary / lunar transfer ────────────────────────────────────────
  const bodies = buildFlightBodies(launchId, dest.targetId);
  const lb = bodies[0];
  const tb = bodies[1];
  const targetDist = lb.center.distanceTo(tb.center);
  const apoTarget = targetDist - lb.radius; // raise apoapsis to reach the target

  nodes.push(node('at-transfer-window', undefined, dest.targetId, { attitude: 'prograde', throttle: 1 }));
  nodes.push(node('at-apoapsis-altitude', apoTarget, undefined, { throttle: 0 }));

  if (kind === 'orbit' || kind === 'orbit-return') {
    // Capture autopilot brakes the arrival into a near-circular orbit once the
    // target's gravity dominates.
    nodes.push(node('at-soi-entry', undefined, dest.targetId, { capture: true }));
    if (kind === 'orbit-return') {
      addReturnLeg(nodes, launchId);
    }
  } else {
    // Land (one-way) — brake the arrival on the upper stage with the powered
    // descent autopilot; the lander (if fitted) auto-separates late and slow for
    // the final touchdown, so its small tank is never asked to kill the whole
    // arrival speed alone.
    nodes.push(node('at-soi-entry', undefined, dest.targetId, { descend: true }));
    if (kind === 'land-return') {
      // After touchdown, fly the ascent autopilot back to orbit, then head home.
      nodes.push(node('after-touchdown', 3, undefined, { ascend: true }));
      addReturnLeg(nodes, launchId);
    }
  }

  return finish(launchId, destId, kind, orbitKm, nodes);
}

/**
 * Append the trip home: when the craft sits opposite the launch body (only true
 * once the *destination* dominates, so it never fires outbound), engage the
 * departure autopilot. It burns prograde just until the craft escapes the body
 * it is leaving — so it heads home instead of running away into deep space — and
 * the descent is then automatic (a fitted parachute auto-opens in the launch
 * world's atmosphere).
 */
function addReturnLeg(nodes: Maneuver[], launchId: string) {
  nodes.push(node('at-transfer-window', undefined, launchId, { depart: true }));
}

function finish(launchBodyId: string, destinationId: string, kind: MissionKind, orbitKm: number, nodes: Maneuver[]): FlightPlan {
  return {
    launchBodyId,
    destinationId,
    mission: { kind, orbitKm },
    launch: { heading: 0, power: 1 },
    nodes,
  };
}
