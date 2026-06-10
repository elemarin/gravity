import { FlightPlan, Maneuver, Trigger, ManeuverActions, MissionKind, MissionSpec, newNodeId } from './FlightPlan';
import { destinationTargetId, bodyDef } from '../bodies';
import { KARMAN_LINE } from '../constants';

/**
 * Guided flight-plan generator. Produces a ready-to-fly plan for a launch body,
 * a destination, and an objective (orbit or land — all missions are one-way).
 *
 * The plan is expressed entirely as position-based maneuver nodes the
 * deterministic Simulator understands, so the whole mission — ascent, transfer,
 * and capture/descent — replays identically every time. The
 * geometry is derived from the bodies, so the same recipe scales to any target;
 * the player just needs a rocket capable enough to carry the delta-v.
 */

function node(type: Trigger['type'], value: number | undefined, targetBodyId: string | undefined, actions: ManeuverActions): Maneuver {
  const trigger: Trigger = { type };
  if (value !== undefined) trigger.value = value;
  if (targetBodyId !== undefined) trigger.targetBodyId = targetBodyId;
  return { id: newNodeId(), trigger, actions };
}

/** Lowest orbit altitude the planner should offer around a body. */
export function minimumOrbitKm(bodyId: string): number {
  const def = bodyDef(bodyId);
  if (def.atmosphereHeight > 0) {
    return Math.ceil(Math.max(KARMAN_LINE, def.atmosphereHeight * 1.15));
  }
  return Math.ceil(Math.max(20, def.radius * 0.3));
}

/** Sensible default parking/target orbit altitude (km) for a world. */
export function defaultOrbitKm(launchId: string): number {
  const def = bodyDef(launchId);
  if (def.atmosphereHeight > 0) return Math.max(minimumOrbitKm(launchId), Math.round(def.atmosphereHeight * 1.6));
  return Math.max(minimumOrbitKm(launchId), Math.round(def.radius * 1.4));
}

/**
 * Gravity-turn ascent into an orbit at `orbitKm`, scaled to the world.
 *
 * `circularize` picks the insertion style:
 *  - true  → a closed-loop circularization autopilot. It steers the velocity
 *            correction and only ever asks for circular speed, so even a very
 *            powerful engine brakes itself instead of overshooting the burn
 *            into an escape trajectory. Used for direct orbit missions.
 *  - false → the original open-loop apoapsis burn + periapsis-altitude cutoff,
 *            which interplanetary transfers are tuned around for their parking
 *            orbit. Transfers only ever fly capable builds, so the open-loop
 *            burn's escape pathology doesn't bite there.
 */
export function ascentNodes(launchId: string, orbitKm: number, circularize = true): Maneuver[] {
  const def = bodyDef(launchId);
  const atmo = def.atmosphereHeight;
  const insert = Math.max(2, orbitKm * 0.85);
  const insertion = (): Maneuver[] => (circularize
    ? [
        node('at-altitude', insert, undefined, { circularize: true }),
        node('at-apoapsis', undefined, undefined, { circularize: true }),
      ]
    : [
        node('at-apoapsis', undefined, undefined, { heading: 90, throttle: 0.5 }),
        node('at-periapsis-altitude', insert, undefined, { throttle: 0 }),
      ]);

  if (atmo > 0) {
    // Atmospheric world (Earth-like): tuned gravity turn → coast → circularize.
    return [
      node('at-altitude', atmo * 0.06, undefined, { heading: 22 }),
      node('at-altitude', atmo * 0.17, undefined, { heading: 45 }),
      node('at-altitude', atmo * 0.40, undefined, { heading: 66 }),
      node('at-apoapsis-altitude', orbitKm, undefined, { heading: 90, throttle: 0 }),
      ...insertion(),
    ];
  }

  // Airless world: short vertical lift then pitch over to a low parking orbit.
  const r = def.radius;
  return [
    node('at-altitude', r * 0.08, undefined, { heading: 45 }),
    node('at-altitude', r * 0.20, undefined, { heading: 82 }),
    node('at-apoapsis-altitude', orbitKm, undefined, { heading: 90, throttle: 0 }),
    ...insertion(),
  ];
}

export type AutoPlanOptions = Partial<MissionSpec>;

function needsAscentAssist(launchId: string): boolean {
  return launchId !== 'earth';
}

/** A complete guided plan for launchId → destinationId with an objective. */
export function autoPlan(launchId: string, destId: string, opts: AutoPlanOptions = {}): FlightPlan {
  const targetId = destinationTargetId(destId, launchId);
  const orbitBodyId = targetId ?? launchId;
  const kind: MissionKind = opts.kind ?? 'orbit';
  const orbitKm = Math.max(minimumOrbitKm(orbitBodyId), opts.orbitKm ?? defaultOrbitKm(orbitBodyId));

  // Parking orbit for transfers stays low to save delta-v; orbitKm is the
  // *target* orbit at the destination body. Both direct-orbit and transfer
  // ascents use the closed-loop circularization: it steers the velocity
  // correction and only ever asks for circular speed, so it reaches a stable
  // parking orbit on ANY capable build instead of escaping (a powerful engine)
  // or stalling suborbital (a weak one) the way the old open-loop apoapsis burn
  // did. The transfer-window burn then departs from that circular orbit.
  const parkingKm = targetId ? defaultOrbitKm(launchId) : orbitKm;
  const nodes = needsAscentAssist(launchId)
    ? [node('at-time', 0, undefined, { ascend: true })]
    : ascentNodes(launchId, parkingKm, true);

  if (!targetId) {
    // Orbiting (or de-orbiting onto) the launch world itself.
    if (kind === 'land') {
      // Drop periapsis into the atmosphere and ride it down under chute/descent.
      nodes.push(node(needsAscentAssist(launchId) ? 'after-orbit' : 'at-apoapsis', undefined, undefined, { attitude: 'retrograde', throttle: 1 }));
      nodes.push(node('at-periapsis-altitude', -1, undefined, { throttle: 0 }));
      nodes.push(node('at-altitude', Math.max(2, orbitKm * 0.4), undefined, { descend: true, deployParachute: true }));
    }
    return finish(launchId, destId, kind, orbitKm, nodes);
  }

  // ── Moon → its host planet (e.g. Moon → Earth) ──────────────────────────────
  // The launch world orbits the target, so the craft is already inside the host's
  // SOI. Escape the moon with a depart burn, then capture (orbit) or descend
  // (land) at the host — the at-soi-entry triggers are dominance-gated so they
  // only fire once the moon has actually been left behind.
  const launchDef = bodyDef(launchId);
  const launchHost = launchDef.parent && launchDef.parent !== 'sun' ? launchDef.parent : null;
  if (targetId === launchHost) {
    // Escape the moon, then capture (orbit) or descend (land) at the host. The
    // capture circularizes LOW — below the moon's own lane — before settling or
    // de-orbiting, so the craft can't swing back out into the moon and get
    // recaptured (which would land it back on the moon).
    nodes.push(node('after-orbit', undefined, targetId, { depart: true }));
    if (kind === 'orbit') {
      nodes.push(node('at-soi-entry', undefined, targetId, { capture: true }));
    } else {
      nodes.push(node('at-soi-entry', undefined, targetId, { descend: true }));
    }
    return finish(launchId, destId, kind, orbitKm, nodes);
  }

  // ── Interplanetary / lunar transfer ────────────────────────────────────────
  // Once a parking orbit is established, hand the cruise to the homing transfer
  // autopilot: it climbs out of the launch world's well and chases the (orbiting)
  // target until the target's gravity takes over. This replaces the old open-loop
  // "burn at a transfer window, coast to a fixed apoapsis", which could never hit
  // a target that is itself moving along its orbit.
  //
  // A moon of ANOTHER planet (e.g. Titan around Saturn) can't be hit directly
  // across interplanetary space — its sphere of influence is a needle in the
  // haystack of its host's. So route in two legs: cross to the host planet and
  // capture into its system first, then hop to the moon from there (the same
  // phased transfer the Earth→Moon route flies). The moon-hop's `after-orbit`
  // trigger waits until the host has actually been reached (see the Simulator),
  // so it can't fire prematurely back at the launch world's parking orbit.
  const tDef = bodyDef(targetId);
  const hostId = tDef.parent && tDef.parent !== 'sun' && tDef.parent !== launchId
    ? tDef.parent : null;
  if (hostId) {
    nodes.push(node('after-orbit', undefined, hostId, { transfer: true }));
    nodes.push(node('at-soi-entry', undefined, hostId, { capture: true }));
  }
  nodes.push(node('after-orbit', undefined, targetId, { transfer: true }));

  if (kind === 'orbit') {
    // Capture autopilot brakes the arrival into a near-circular orbit once the
    // target's gravity dominates.
    nodes.push(node('at-soi-entry', undefined, targetId, { capture: true }));
  } else {
    // Land (one-way) — brake the arrival on the upper stage with the powered
    // descent autopilot; the lander (if fitted) auto-separates late and slow for
    // the final touchdown, so its small tank is never asked to kill the whole
    // arrival speed alone.
    nodes.push(node('at-soi-entry', undefined, targetId, { descend: true }));
  }

  return finish(launchId, destId, kind, orbitKm, nodes);
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
