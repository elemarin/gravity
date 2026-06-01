import { FlightState } from '../types';

export type Milestone = {
  id: string;
  name: string;
  description: string;
  check: (state: FlightState) => boolean;
  unlocks: string[];
  completed: boolean;
};

export const MILESTONES: Milestone[] = [
  {
    id: 'first-flight',
    name: 'First Flight',
    description: 'Reach 500m altitude',
    check: (s) => s.altitude * 1000 >= 500,  // altitude in km, 0.5 km = 500m
    unlocks: ['tank-large'],
    completed: false,
  },
  {
    id: '10km',
    name: 'High Altitude',
    description: 'Reach 10 km altitude',
    check: (s) => s.altitude >= 10,
    unlocks: ['engine-vacuum'],
    completed: false,
  },
  {
    id: 'karman',
    name: 'Kármán Line',
    description: 'Reach 100 km — the edge of space',
    check: (s) => s.altitude >= 100,
    unlocks: ['stage-separator', 'parachute-basic'],
    completed: false,
  },
  {
    id: 'safe-return',
    name: 'Safe Return',
    description: 'Land safely (vertical speed < 5 m/s)',
    check: (s) =>
      s.phase === 'landed' &&
      Math.abs(s.velocity.y) * 1000 < 5,
    unlocks: ['heat-shield', 'legs-basic'],
    completed: false,
  },
  {
    id: 'orbit',
    name: 'Orbit Achieved',
    description: 'Achieve a stable orbit above 100 km',
    check: (s) => {
      // Rough orbital check: altitude > 100 km and horizontal speed ~ circular velocity
      // Circular orbital speed at 100 km: sqrt(GM/(R+100)) ≈ computed in game
      const minOrbitAlt = 100;
      return s.altitude >= minOrbitAlt && s.speed >= 7.5 && s.phase === 'orbit';
    },
    unlocks: ['engine-nuclear', 'tank-xl'],
    completed: false,
  },
  {
    id: 'moon-flyby',
    name: 'Lunar Flyby',
    description: 'Pass within 1000 km of the Moon',
    check: (_s) => false, // stub — moon not yet implemented
    unlocks: ['engine-ion'],
    completed: false,
  },
  {
    id: 'moon-landing',
    name: 'Moon Landing',
    description: 'Land on the Moon',
    check: (_s) => false,
    unlocks: ['lander-legs', 'ascent-engine'],
    completed: false,
  },
];

export class MilestoneManager {
  private milestones: Milestone[];
  onComplete?: (m: Milestone) => void;

  constructor() {
    // Deep-copy so we don't mutate the module-level array between resets
    this.milestones = MILESTONES.map((m) => ({ ...m, completed: false }));
  }

  check(state: FlightState) {
    for (const m of this.milestones) {
      if (!m.completed && m.check(state)) {
        m.completed = true;
        this.onComplete?.(m);
      }
    }
  }

  getNextTarget(): Milestone | null {
    return this.milestones.find((m) => !m.completed) ?? null;
  }

  getCompleted(): Milestone[] {
    return this.milestones.filter((m) => m.completed);
  }

  reset() {
    this.milestones.forEach((m) => (m.completed = false));
  }
}
