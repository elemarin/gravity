export type PartType = 'engine' | 'tank' | 'nose' | 'capsule' | 'utility';

export type RocketPart = {
  id: string;
  name: string;
  type: PartType;
  mass: number;          // tonnes
  thrust: number;        // kN (engines)
  burnRate: number;      // L/s at full throttle (engines)
  fuelCapacity: number;  // L (tanks)
  unlockedByDefault: boolean;
  description: string;
  icon: string;          // single emoji or short symbol for UI
  color: number;         // hex color for 3D mesh
};

export const PARTS_CATALOG: RocketPart[] = [
  // ENGINES
  {
    id: 'engine-basic',
    name: 'Sparrow Engine',
    type: 'engine',
    mass: 0.5,
    thrust: 220,
    burnRate: 35,
    fuelCapacity: 0,
    unlockedByDefault: true,
    description: 'Reliable first-stage engine. Balanced thrust and efficiency.',
    icon: '🜂',
    color: 0x888899,
  },
  {
    id: 'engine-vacuum',
    name: 'Vacuum Engine',
    type: 'engine',
    mass: 0.4,
    thrust: 170,
    burnRate: 18,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'High-efficiency engine optimized for upper stages.',
    icon: '◉',
    color: 0xb0b0c8,
  },
  {
    id: 'engine-nuclear',
    name: 'NERV Engine',
    type: 'engine',
    mass: 1.2,
    thrust: 110,
    burnRate: 6,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Nuclear thermal — extreme efficiency for long burns.',
    icon: '☢',
    color: 0x55ff88,
  },
  {
    id: 'engine-ion',
    name: 'Ion Drive',
    type: 'engine',
    mass: 0.1,
    thrust: 6,
    burnRate: 0.4,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Tiny thrust, enormous efficiency. Deep space only.',
    icon: '✦',
    color: 0x66ccff,
  },

  // TANKS
  {
    id: 'tank-basic',
    name: 'Basic Tank',
    type: 'tank',
    mass: 0.2,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 100,
    unlockedByDefault: true,
    description: 'Small fuel tank. 100 L capacity.',
    icon: '▭',
    color: 0xff7700,
  },
  {
    id: 'tank-medium',
    name: 'Medium Tank',
    type: 'tank',
    mass: 0.35,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 200,
    unlockedByDefault: false,
    description: 'Doubled capacity. Good for sub-orbital hops.',
    icon: '▮',
    color: 0xff8833,
  },
  {
    id: 'tank-large',
    name: 'Large Tank',
    type: 'tank',
    mass: 0.6,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 380,
    unlockedByDefault: false,
    description: 'Heavy but holds a lot of fuel.',
    icon: '▮',
    color: 0xff9944,
  },
  {
    id: 'tank-xl',
    name: 'XL Tank',
    type: 'tank',
    mass: 1.0,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 650,
    unlockedByDefault: false,
    description: 'For interplanetary missions.',
    icon: '⬛',
    color: 0xffaa55,
  },

  // NOSES / CAPSULES
  {
    id: 'nose-cone',
    name: 'Nose Cone',
    type: 'nose',
    mass: 0.1,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 0,
    unlockedByDefault: true,
    description: 'Aerodynamic nose. Cheap and light.',
    icon: '▲',
    color: 0xeeeeff,
  },
  {
    id: 'capsule-crew',
    name: 'Crew Capsule',
    type: 'capsule',
    mass: 0.8,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Carries astronauts. Required for crewed missions.',
    icon: '◐',
    color: 0xddddff,
  },
  {
    id: 'satellite-bus',
    name: 'Satellite Bus',
    type: 'capsule',
    mass: 0.3,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Deployable satellite payload.',
    icon: '🛰',
    color: 0xffcc55,
  },

  // UTILITY
  {
    id: 'parachute',
    name: 'Parachute',
    type: 'utility',
    mass: 0.05,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Slows descent in atmosphere.',
    icon: '☂',
    color: 0xffffff,
  },
  {
    id: 'heat-shield',
    name: 'Heat Shield',
    type: 'utility',
    mass: 0.5,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Protects from reentry heating.',
    icon: '⛨',
    color: 0x884422,
  },
  {
    id: 'landing-legs',
    name: 'Landing Legs',
    type: 'utility',
    mass: 0.15,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Stable touchdown on flat ground.',
    icon: '⎍',
    color: 0xaaaaaa,
  },
];

export function getPart(id: string): RocketPart | undefined {
  return PARTS_CATALOG.find((p) => p.id === id);
}

export class PartsManager {
  private unlocked = new Set<string>();

  constructor(unlockedIds: string[] = []) {
    PARTS_CATALOG.forEach((p) => {
      if (p.unlockedByDefault) this.unlocked.add(p.id);
    });
    unlockedIds.forEach((id) => this.unlocked.add(id));
  }

  unlock(id: string) { this.unlocked.add(id); }
  unlockAll(ids: string[]) { ids.forEach((id) => this.unlocked.add(id)); }
  isUnlocked(id: string): boolean { return this.unlocked.has(id); }
  getUnlocked(): RocketPart[] {
    return PARTS_CATALOG.filter((p) => this.unlocked.has(p.id));
  }
  getAll(): RocketPart[] { return PARTS_CATALOG; }
  getUnlockedIds(): string[] { return Array.from(this.unlocked); }
}
