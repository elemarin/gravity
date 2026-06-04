import { FlightState } from '../types';
import { EARTH_CENTER, GM } from '../constants';

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
    description: 'Reach 1 km altitude',
    check: (s) => s.altitude >= 1,
    unlocks: ['tank-medium', 'nose-fairing'],
  },
  {
    id: 'high-altitude',
    name: 'High Altitude',
    description: 'Reach 25 km altitude',
    check: (s) => s.altitude >= 25,
    unlocks: ['tank-large', 'probe-core'],
  },
  {
    id: 'staging',
    name: 'Stage Separation',
    description: 'Separate a spent stage in flight',
    check: (s) => s.activeStage >= 1 && s.altitude >= 1,
    unlocks: ['parachute', 'engine-heavy', 'engine-aerospike'],
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
    unlocks: ['landing-legs', 'booster-liquid'],
  },
  {
    id: 'orbit',
    name: 'Orbit Achieved',
    description: 'Achieve a stable orbit above 100 km',
    check: (s) =>
      s.phase === 'orbit' &&
      s.altitude >= 100 &&
      (s.periapsis ?? 0) >= 80,
    unlocks: ['tank-xl', 'satellite-bus', 'solar-array', 'station-module'],
  },
  {
    id: 'high-orbit',
    name: 'High Orbit',
    description: 'Raise your orbit above 400 km',
    check: (s) => s.phase === 'orbit' && (s.periapsis ?? 0) >= 400,
    unlocks: ['engine-nuclear', 'booster-srb-heavy'],
  },
  {
    id: 'lander-deploy',
    name: 'Lander Away',
    description: 'Deploy a separable lander payload in flight',
    check: (s) => !!s.landerDeployed && s.altitude >= 50,
    unlocks: ['lander-heavy', 'rcs-pack'],
  },
  {
    id: 'transfer',
    name: 'Interplanetary Transfer',
    description: 'Reach the vicinity of another body',
    check: (s) =>
      !!s.reachedBodyIds &&
      s.reachedBodyIds.some((id) => id !== (s.launchBodyId ?? '')),
    unlocks: ['engine-nuclear'],
  },
  {
    id: 'soft-landing',
    name: 'Soft Landing',
    description: 'Touch down safely on another body',
    check: (s) =>
      s.phase === 'landed' &&
      s.landedBodyId != null &&
      s.landedBodyId !== (s.launchBodyId ?? ''),
    unlocks: ['lander-heavy', 'engine-ion'],
  },
  {
    id: 'crewed',
    name: 'Crewed Mission',
    description: 'Reach orbital speed and return safely',
    // Landed after reaching space at near-orbital speed — a crewed orbit & return.
    check: (s) => s.phase === 'landed' && s.maxAltitude >= 100 && s.maxSpeed >= 0.7,
    unlocks: ['capsule-crew'],
  },
  {
    id: 'deep-space',
    name: 'Deep Space',
    description: 'Exceed escape velocity and leave Earth',
    check: (s) => {
      if (s.altitude < 500) return false;
      const r = s.position.distanceTo(EARTH_CENTER);
      const vEsc = Math.sqrt((2 * GM) / r); // km/s
      return s.speed >= vEsc;
    },
    unlocks: ['engine-ion', 'engine-plasma'],
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
