/**
 * Gravity 2.0 flight-plan model.
 *
 * A plan is *pure data*: an Angry-Birds style launch vector plus an ordered
 * list of maneuver nodes ("stage points"). The deterministic Simulator reads
 * this plan and replays it identically every time, so the player can plan,
 * watch, edit and replay.
 */

/** What makes a maneuver node fire. */
export type TriggerType =
  | 'at-time'             // value = sim seconds since launch
  | 'at-altitude'         // value = km above the dominant body surface (ascending)
  | 'at-apoapsis'         // highest point of the current arc
  | 'at-periapsis'        // lowest point of the current arc
  | 'at-apoapsis-altitude'  // when projected apoapsis ≥ value km (ascending)
  | 'at-periapsis-altitude' // when projected periapsis ≥ value km
  | 'at-transfer-window'  // aligned to burn toward targetBodyId
  | 'on-fuel-empty'       // active stage runs dry
  | 'at-soi-entry'        // enters targetBodyId's sphere of influence
  | 'after-orbit'         // after reaching orbit around a non-target body
  | 'after-touchdown'     // value = seconds after a soft landing (for relaunch)
  | 'on-manual-relaunch'; // player presses the Return button while landed

export type Trigger = {
  type: TriggerType;
  value?: number;        // for at-time / at-altitude
  targetBodyId?: string; // for at-soi-entry
};

/** How the craft orients itself when thrusting. */
export type Attitude = 'manual' | 'prograde' | 'retrograde';

/** What the node does when it fires. Any field left undefined is a no-op. */
export type ManeuverActions = {
  throttle?: number;        // 0..1, sets the held throttle
  heading?: number;         // degrees from local up (-90..90), sets aim
  /** Hold an automatic attitude (prograde/retrograde) instead of a fixed aim. */
  attitude?: Attitude;
  /** Engage the powered-descent autopilot for a guided soft landing. */
  descend?: boolean;
  /** Engage the powered-ascent autopilot to climb from a surface into orbit. */
  ascend?: boolean;
  /** Engage the transfer autopilot — climb out of the launch world's well and
   *  home in on a (moving) target body until its gravity takes over. */
  transfer?: boolean;
  /** Engage the capture autopilot — brake toward a circular orbit at arrival. */
  capture?: boolean;
  /** Engage the circularize autopilot — close the current arc into a circular orbit. */
  circularize?: boolean;
  /** Engage the departure autopilot — burn until escaping back to the home body. */
  depart?: boolean;
  jettisonStage?: boolean;  // drop the spent stage, ignite the next
  deployLander?: boolean;   // separate the lander payload
  deployParachute?: boolean;// pop the parachute for a soft landing
};

export type Maneuver = {
  id: string;
  trigger: Trigger;
  actions: ManeuverActions;
};

/** Angry-Birds launch: direction = heading, length of pull = power/throttle. */
export type LaunchVector = {
  heading: number; // degrees from local up (-90 = west, 0 = straight up, 90 = east)
  power: number;   // 0..1 initial throttle held until the first node fires
};

/** What the player wants to do at the destination. Drives the auto-planner.
 *  Missions are one-way deliveries — nobody pays for the trip home. */
export type MissionKind = 'orbit' | 'land';

export type MissionSpec = {
  kind: MissionKind;
  /** Target orbit altitude (km above surface) for orbit objectives. */
  orbitKm: number;
};

export const MISSION_LABELS: Record<MissionKind, string> = {
  'orbit': 'Orbit',
  'land':  'Land',
};

export type FlightPlan = {
  /** Body the flight launches from (an unlocked base). */
  launchBodyId: string;
  /** Destination id (see DESTINATIONS), e.g. 'orbit' | 'moon' | 'mars'. */
  destinationId: string;
  /** High-level objective used by the plan wizard (optional for legacy saves). */
  mission?: MissionSpec;
  launch: LaunchVector;
  nodes: Maneuver[];
};

export const DEFAULT_PLAN: FlightPlan = {
  launchBodyId: 'earth',
  destinationId: 'orbit',
  mission: { kind: 'orbit', orbitKm: 120 },
  launch: { heading: 0, power: 1 },
  // A forgiving "gravity turn → coast → circularize" profile that reaches a
  // stable low orbit on the default rocket. Tunable in the plan panel.
  nodes: [
    { id: 'turn-1', trigger: { type: 'at-altitude', value: 4 },  actions: { heading: 22 } },
    { id: 'turn-2', trigger: { type: 'at-altitude', value: 12 }, actions: { heading: 45 } },
    { id: 'turn-3', trigger: { type: 'at-altitude', value: 28 }, actions: { heading: 66 } },
    { id: 'turn-4', trigger: { type: 'at-altitude', value: 55 }, actions: { heading: 82 } },
    { id: 'meco',        trigger: { type: 'at-apoapsis-altitude', value: 130 }, actions: { heading: 90, throttle: 0 } },
    { id: 'circularize', trigger: { type: 'at-apoapsis' }, actions: { heading: 90, throttle: 0.5 } },
    { id: 'insert',      trigger: { type: 'at-periapsis-altitude', value: 105 }, actions: { throttle: 0 } },
  ],
};

let nodeCounter = 0;
/** Stable-ish unique id for new nodes created in the UI. */
export function newNodeId(): string {
  nodeCounter += 1;
  return `node-${Date.now().toString(36)}-${nodeCounter}`;
}

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  'at-time':       'At time',
  'at-altitude':   'At altitude',
  'at-apoapsis':   'At apoapsis',
  'at-periapsis':  'At periapsis',
  'at-apoapsis-altitude':  'Apoapsis ≥',
  'at-periapsis-altitude': 'Periapsis ≥',
  'at-transfer-window': 'Transfer window',
  'on-fuel-empty': 'On fuel empty',
  'at-soi-entry':  'At SOI entry',
  'after-orbit':   'After orbit',
  'after-touchdown': 'After landing',
  'on-manual-relaunch': 'Return button',
};

/** Human-readable summary of a node for the plan list UI. */
export function describeTrigger(t: Trigger): string {
  switch (t.type) {
    case 'at-time':      return `T+${Math.round(t.value ?? 0)}s`;
    case 'at-altitude':  return `${Math.round(t.value ?? 0)} km up`;
    case 'at-apoapsis':  return 'Apoapsis';
    case 'at-periapsis': return 'Periapsis';
    case 'at-apoapsis-altitude':  return `AP ≥ ${Math.round(t.value ?? 0)} km`;
    case 'at-periapsis-altitude': return `PE ≥ ${Math.round(t.value ?? 0)} km`;
    case 'at-transfer-window': return 'Transfer window';
    case 'on-fuel-empty':return 'Fuel empty';
    case 'at-soi-entry': return `Enter ${t.targetBodyId ?? 'SOI'}`;
    case 'after-orbit':  return `Orbit, then ${t.targetBodyId ?? 'depart'}`;
    case 'after-touchdown': return `T+${Math.round(t.value ?? 0)}s after landing`;
    case 'on-manual-relaunch': return 'Return button';
  }
}

export function describeActions(a: ManeuverActions): string {
  const parts: string[] = [];
  if (a.descend)                parts.push('descend');
  if (a.ascend)                 parts.push('ascend');
  if (a.transfer)               parts.push('transfer');
  if (a.capture)                parts.push('capture');
  if (a.circularize)            parts.push('circularize');
  if (a.depart)                 parts.push('depart home');
  if (a.attitude && a.attitude !== 'manual') parts.push(a.attitude);
  else if (a.heading !== undefined) parts.push(`aim ${Math.round(a.heading)}°`);
  if (a.throttle !== undefined) parts.push(`thr ${Math.round(a.throttle * 100)}%`);
  if (a.jettisonStage)          parts.push('stage');
  if (a.deployLander)           parts.push('lander');
  if (a.deployParachute)        parts.push('chute');
  return parts.length ? parts.join(' · ') : 'coast';
}

/** Defensive clone so UI edits never mutate a running plan. */
export function clonePlan(plan: FlightPlan): FlightPlan {
  return {
    launchBodyId: plan.launchBodyId,
    destinationId: plan.destinationId,
    mission: plan.mission ? { ...plan.mission } : undefined,
    launch: { ...plan.launch },
    nodes: plan.nodes.map((n) => ({
      id: n.id,
      trigger: { ...n.trigger },
      actions: { ...n.actions },
    })),
  };
}
