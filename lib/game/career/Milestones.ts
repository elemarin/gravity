import { FlightState } from '../types';

export type Milestone = {
  id: string;
  name: string;
  description: string;
  check: (s: FlightState) => boolean;
  unlocks: string[];
};

export const MILESTONES: Milestone[] = [
  {
    id: 'first-flight',
    name: 'First Flight',
    description: 'Reach 500 m altitude',
    check: (s) => s.altitude * 1000 >= 500,
    unlocks: ['tank-medium'],
  },
  {
    id: 'high-altitude',
    name: 'High Altitude',
    description: 'Reach 10 km altitude',
    check: (s) => s.altitude >= 10,
    unlocks: ['tank-large', 'parachute'],
  },
  {
    id: 'karman',
    name: 'Kármán Line',
    description: 'Reach 100 km — the edge of space',
    check: (s) => s.altitude >= 100,
    unlocks: ['engine-vacuum', 'heat-shield'],
  },
  {
    id: 'safe-return',
    name: 'Safe Return',
    description: 'Land safely after reaching space',
    check: (s) => s.phase === 'landed' && s.maxAltitude >= 100,
    unlocks: ['landing-legs'],
  },
  {
    id: 'orbit',
    name: 'Orbit Achieved',
    description: 'Achieve a stable orbit above 100 km',
    check: (s) =>
      s.phase === 'orbit' &&
      s.altitude >= 100 &&
      (s.periapsis ?? 0) >= 80,
    unlocks: ['tank-xl', 'engine-nuclear'],
  },
  {
    id: 'satellite-deploy',
    name: 'Satellite Deployed',
    description: 'Deploy a satellite from orbit',
    check: () => false, // requires satellite mechanic
    unlocks: ['satellite-bus'],
  },
  {
    id: 'crewed',
    name: 'Crewed Mission',
    description: 'Send a crew to orbit and back',
    check: () => false,
    unlocks: ['capsule-crew'],
  },
  {
    id: 'deep-space',
    name: 'Deep Space',
    description: 'Escape Earth gravity',
    check: () => false,
    unlocks: ['engine-ion'],
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
