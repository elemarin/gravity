export type PartType = 'engine' | 'tank' | 'stage' | 'payload' | 'capsule' | 'legs' | 'chute' | 'shield';

export type RocketPart = {
  id: string;
  name: string;
  type: PartType;
  mass: number;         // tonnes
  thrust: number;       // kN (0 if not engine)
  fuelCapacity: number; // units (0 if not tank)
  unlocked: boolean;
  description: string;
};

export const PARTS_CATALOG: RocketPart[] = [
  {
    id: 'engine-basic',
    name: 'Sparrow Engine',
    type: 'engine',
    mass: 0.5,
    thrust: 180,
    fuelCapacity: 0,
    unlocked: true,
    description: 'A reliable first-stage engine.',
  },
  {
    id: 'tank-basic',
    name: 'Basic Fuel Tank',
    type: 'tank',
    mass: 0.2,
    thrust: 0,
    fuelCapacity: 100,
    unlocked: true,
    description: 'Small tank, enough to get off the ground.',
  },
  {
    id: 'tank-large',
    name: 'Large Fuel Tank',
    type: 'tank',
    mass: 0.5,
    thrust: 0,
    fuelCapacity: 250,
    unlocked: false,
    description: 'Bigger tank for longer flights.',
  },
  {
    id: 'engine-vacuum',
    name: 'Vacuum Engine',
    type: 'engine',
    mass: 0.3,
    thrust: 90,
    fuelCapacity: 0,
    unlocked: false,
    description: 'High ISP engine optimized for vacuum.',
  },
  {
    id: 'stage-separator',
    name: 'Stage Separator',
    type: 'stage',
    mass: 0.05,
    thrust: 0,
    fuelCapacity: 0,
    unlocked: false,
    description: 'Jettison your first stage.',
  },
  {
    id: 'parachute-basic',
    name: 'Parachute',
    type: 'chute',
    mass: 0.05,
    thrust: 0,
    fuelCapacity: 0,
    unlocked: false,
    description: 'Deploy to slow your descent.',
  },
  {
    id: 'heat-shield',
    name: 'Heat Shield',
    type: 'shield',
    mass: 0.4,
    thrust: 0,
    fuelCapacity: 0,
    unlocked: false,
    description: 'Survive reentry heating.',
  },
  {
    id: 'legs-basic',
    name: 'Landing Legs',
    type: 'legs',
    mass: 0.15,
    thrust: 0,
    fuelCapacity: 0,
    unlocked: false,
    description: 'Extend before landing.',
  },
  {
    id: 'engine-nuclear',
    name: 'Nuclear Engine',
    type: 'engine',
    mass: 0.8,
    thrust: 60,
    fuelCapacity: 0,
    unlocked: false,
    description: 'Extreme ISP for deep space missions.',
  },
  {
    id: 'tank-xl',
    name: 'XL Tank',
    type: 'tank',
    mass: 1.0,
    thrust: 0,
    fuelCapacity: 600,
    unlocked: false,
    description: 'For interplanetary missions.',
  },
  {
    id: 'engine-ion',
    name: 'Ion Drive',
    type: 'engine',
    mass: 0.1,
    thrust: 2,
    fuelCapacity: 0,
    unlocked: false,
    description: 'Tiny thrust, enormous efficiency.',
  },
  {
    id: 'lander-legs',
    name: 'Lander Legs',
    type: 'legs',
    mass: 0.3,
    thrust: 0,
    fuelCapacity: 0,
    unlocked: false,
    description: 'Wide stance for uneven terrain.',
  },
  {
    id: 'ascent-engine',
    name: 'Ascent Engine',
    type: 'engine',
    mass: 0.2,
    thrust: 30,
    fuelCapacity: 0,
    unlocked: false,
    description: 'Light engine for lunar ascent.',
  },
];

export class PartsManager {
  private catalog: RocketPart[];

  constructor() {
    this.catalog = PARTS_CATALOG.map((p) => ({ ...p }));
  }

  unlock(id: string) {
    const part = this.catalog.find((p) => p.id === id);
    if (part) part.unlocked = true;
  }

  unlockAll(ids: string[]) {
    ids.forEach((id) => this.unlock(id));
  }

  getUnlocked(): RocketPart[] {
    return this.catalog.filter((p) => p.unlocked);
  }

  getAll(): RocketPart[] {
    return this.catalog;
  }
}
