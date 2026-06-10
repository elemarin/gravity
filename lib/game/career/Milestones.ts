import { FlightState } from '../types';
import { EARTH_CENTER, GM } from '../constants';

/**
 * Flight-skill milestones — one-time tutorial beats that pay a small cash
 * bonus. They no longer hand out parts (the catalog is bought with contract
 * money and gated by rank); they exist to teach the basics and fund the first
 * few purchases.
 */
export type Milestone = {
  id: string;
  name: string;
  description: string;
  check: (s: FlightState) => boolean;
  /** One-time cash bonus on completion. */
  cash: number;
};

export const MILESTONES: Milestone[] = [
  {
    id: 'first-flight',
    name: 'It Goes Up',
    description: 'Reach 1 km altitude — the sky’s first kilometre is free. This one isn’t.',
    check: (s) => s.altitude >= 1,
    cash: 400,
  },
  {
    id: 'high-altitude',
    name: 'Above the Weather',
    description: 'Reach 25 km. The clouds are now someone else’s problem.',
    check: (s) => s.altitude >= 25,
    cash: 600,
  },
  {
    id: 'staging',
    name: 'Litterbug',
    description: 'Separate a spent stage in flight. It’s not littering if it’s aerodynamic.',
    check: (s) => s.activeStage >= 1 && s.altitude >= 1,
    cash: 800,
  },
  {
    id: 'karman',
    name: 'Officially Space',
    description: 'Cross 100 km — the Kármán line. Bragging rights now legally enforceable.',
    check: (s) => s.altitude >= 100,
    cash: 1000,
  },
  {
    id: 'safe-return',
    name: 'Both Pieces, Same Rocket',
    description: 'Land safely after reaching space. The insurance people are weeping with joy.',
    check: (s) => s.phase === 'landed' && s.maxAltitude >= 100,
    cash: 1200,
  },
  {
    id: 'orbit',
    name: 'Falling With Style',
    description: 'Hold a stable orbit above 100 km. You are now missing the ground professionally.',
    check: (s) =>
      s.phase === 'orbit' &&
      s.altitude >= 100 &&
      (s.periapsis ?? 0) >= 80,
    cash: 1500,
  },
  {
    id: 'high-orbit',
    name: 'Premium Altitude',
    description: 'Raise your orbit above 400 km. Better view, same vacuum.',
    check: (s) => s.phase === 'orbit' && (s.periapsis ?? 0) >= 400,
    cash: 1500,
  },
  {
    id: 'lander-deploy',
    name: 'Drop It Like It’s Throttled',
    description: 'Deploy a separable lander payload in flight.',
    check: (s) => !!s.landerDeployed && s.altitude >= 50,
    cash: 1500,
  },
  {
    id: 'transfer',
    name: 'Are We There Yet',
    description: 'Reach the vicinity of another body. The kids in the back are a navball.',
    check: (s) =>
      !!s.reachedBodyIds &&
      s.reachedBodyIds.some((id) => id !== (s.launchBodyId ?? '')),
    cash: 2500,
  },
  {
    id: 'soft-landing',
    name: 'Stuck the Landing',
    description: 'Touch down safely on another body. The body did not consent, but it’s fine.',
    check: (s) =>
      s.phase === 'landed' &&
      s.landedBodyId != null &&
      s.landedBodyId !== (s.launchBodyId ?? ''),
    cash: 3000,
  },
  {
    id: 'crewed',
    name: 'Humans Included',
    description: 'Reach orbital speed and land intact. The crew gives it three stars: “loud”.',
    check: (s) => s.phase === 'landed' && s.maxAltitude >= 100 && s.maxSpeed >= 0.7,
    cash: 2500,
  },
  {
    id: 'deep-space',
    name: 'Goodbye, Gravity Well',
    description: 'Exceed escape velocity and leave Earth behind. Earth will text occasionally.',
    check: (s) => {
      if (s.altitude < 500) return false;
      const r = s.position.distanceTo(EARTH_CENTER);
      const vEsc = Math.sqrt((2 * GM) / r); // km/s
      return s.speed >= vEsc;
    },
    cash: 3000,
  },
];

export class MilestoneManager {
  private completed = new Set<string>();
  onComplete?: (m: Milestone) => void;

  constructor(completed: string[] = []) {
    completed.forEach((id) => this.completed.add(id));
  }

  check(state: FlightState) {
    for (const m of MILESTONES) {
      if (this.completed.has(m.id)) continue;
      if (m.check(state)) {
        this.completed.add(m.id);
        this.onComplete?.(m);
      }
    }
  }

  getNextTarget(): Milestone | null {
    return MILESTONES.find((m) => !this.completed.has(m.id)) ?? null;
  }

  getCompletedIds(): string[] { return Array.from(this.completed); }
  isCompleted(id: string): boolean { return this.completed.has(id); }
  reset() { this.completed.clear(); }
  setCompleted(ids: string[]) {
    this.completed.clear();
    ids.forEach((id) => this.completed.add(id));
  }
}
