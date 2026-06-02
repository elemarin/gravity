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
  | 'at-time'        // value = sim seconds since launch
  | 'at-altitude'    // value = km above the dominant body surface (ascending)
  | 'at-apoapsis'    // highest point of the current arc
  | 'at-periapsis'   // lowest point of the current arc
  | 'on-fuel-empty'  // active stage runs dry
  | 'at-soi-entry';  // enters targetBodyId's sphere of influence

export type Trigger = {
  type: TriggerType;
  value?: number;        // for at-time / at-altitude
  targetBodyId?: string; // for at-soi-entry
};

/** What the node does when it fires. Any field left undefined is a no-op. */
export type ManeuverActions = {
  throttle?: number;        // 0..1, sets the held throttle
  heading?: number;         // degrees from local up (-90..90), sets aim
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

export type FlightPlan = {
  scenarioId: string;
  launch: LaunchVector;
  nodes: Maneuver[];
};

export const DEFAULT_PLAN: FlightPlan = {
  scenarioId: 'earth-orbit',
  launch: { heading: 0, power: 1 },
  nodes: [
    {
      id: 'turn',
      trigger: { type: 'at-altitude', value: 12 },
      actions: { heading: 45 },
    },
    {
      id: 'circularize',
      trigger: { type: 'at-apoapsis' },
      actions: { heading: 80, throttle: 1 },
    },
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
  'on-fuel-empty': 'On fuel empty',
  'at-soi-entry':  'At SOI entry',
};

/** Human-readable summary of a node for the plan list UI. */
export function describeTrigger(t: Trigger): string {
  switch (t.type) {
    case 'at-time':      return `T+${Math.round(t.value ?? 0)}s`;
    case 'at-altitude':  return `${Math.round(t.value ?? 0)} km up`;
    case 'at-apoapsis':  return 'Apoapsis';
    case 'at-periapsis': return 'Periapsis';
    case 'on-fuel-empty':return 'Fuel empty';
    case 'at-soi-entry': return `Enter ${t.targetBodyId ?? 'SOI'}`;
  }
}

export function describeActions(a: ManeuverActions): string {
  const parts: string[] = [];
  if (a.heading !== undefined)  parts.push(`aim ${Math.round(a.heading)}°`);
  if (a.throttle !== undefined) parts.push(`thr ${Math.round(a.throttle * 100)}%`);
  if (a.jettisonStage)          parts.push('stage');
  if (a.deployLander)           parts.push('lander');
  if (a.deployParachute)        parts.push('chute');
  return parts.length ? parts.join(' · ') : 'coast';
}

/** Defensive clone so UI edits never mutate a running plan. */
export function clonePlan(plan: FlightPlan): FlightPlan {
  return {
    scenarioId: plan.scenarioId,
    launch: { ...plan.launch },
    nodes: plan.nodes.map((n) => ({
      id: n.id,
      trigger: { ...n.trigger },
      actions: { ...n.actions },
    })),
  };
}
