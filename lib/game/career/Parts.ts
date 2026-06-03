export type PartType =
  | 'engine' | 'booster' | 'tank' | 'nose' | 'capsule' | 'utility' | 'lander';

export type RocketPart = {
  id: string;
  name: string;
  type: PartType;
  mass: number;          // tonnes (dry)
  thrust: number;        // kN (engines / boosters)
  burnRate: number;      // L/s at full throttle (engines / boosters)
  fuelCapacity: number;  // L (tanks / boosters / landers)
  unlockedByDefault: boolean;
  description: string;
  icon: string;          // single emoji or short symbol for UI
  color: number;         // hex color for 3D mesh
};

/**
 * Balance notes (Gravity "casual arcade KSP"):
 * Surface orbital velocity in this scaled world is ~0.79 km/s, so a single
 * basic stack should comfortably reach orbit. Engines are deliberately light
 * relative to their thrust so staging and side-boosters always help rather
 * than hurt.
 */
export const PARTS_CATALOG: RocketPart[] = [
  // ── ENGINES ────────────────────────────────────────────────────────────
  {
    id: 'engine-basic',
    name: 'Sparrow',
    type: 'engine',
    mass: 0.5,
    thrust: 95,
    burnRate: 9,
    fuelCapacity: 0,
    unlockedByDefault: true,
    description: 'Reliable first-stage engine. Punchy and forgiving.',
    icon: '🜂',
    color: 0x9aa3b8,
  },
  {
    id: 'engine-vacuum',
    name: 'Comet Vac',
    type: 'engine',
    mass: 0.4,
    thrust: 70,
    burnRate: 6,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'High-efficiency upper-stage engine. Loves the vacuum.',
    icon: '◉',
    color: 0xc2c8de,
  },
  {
    id: 'engine-heavy',
    name: 'Titan Heavy',
    type: 'engine',
    mass: 1.3,
    thrust: 260,
    burnRate: 20,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Brute-force core engine for heavy lifters.',
    icon: '🜨',
    color: 0x7d8496,
  },
  {
    id: 'engine-nuclear',
    name: 'NERV',
    type: 'engine',
    mass: 1.1,
    thrust: 70,
    burnRate: 3,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Nuclear thermal — extreme efficiency for long burns.',
    icon: '☢',
    color: 0x6effa6,
  },
  {
    id: 'engine-ion',
    name: 'Ion Drive',
    type: 'engine',
    mass: 0.1,
    thrust: 12,
    burnRate: 0.4,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Tiny thrust, enormous efficiency. Deep space only.',
    icon: '✦',
    color: 0x6cd0ff,
  },

  // ── SIDE BOOSTERS ──────────────────────────────────────────────────────
  {
    id: 'booster-solid',
    name: 'Kicker SRB',
    type: 'booster',
    mass: 0.45,
    thrust: 150,
    burnRate: 17,
    fuelCapacity: 220,
    unlockedByDefault: true,
    description: 'Strap-on solid booster. Big shove off the pad, drops with stage 1.',
    icon: '🚀',
    color: 0xf2f2f5,
  },
  {
    id: 'booster-liquid',
    name: 'Twin Liquid',
    type: 'booster',
    mass: 0.7,
    thrust: 230,
    burnRate: 19,
    fuelCapacity: 360,
    unlockedByDefault: false,
    description: 'Liquid-fuel strap-on. Heavy lift for big payloads.',
    icon: '🛢',
    color: 0xffd27a,
  },

  // ── TANKS ──────────────────────────────────────────────────────────────
  {
    id: 'tank-small',
    name: 'Pony Tank',
    type: 'tank',
    mass: 0.1,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 80,
    unlockedByDefault: true,
    description: 'Tiny tank for trims and upper stages.',
    icon: '▫',
    color: 0xffc04d,
  },
  {
    id: 'tank-basic',
    name: 'Basic Tank',
    type: 'tank',
    mass: 0.18,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 160,
    unlockedByDefault: true,
    description: 'Dependable workhorse tank.',
    icon: '▭',
    color: 0xff9a3c,
  },
  {
    id: 'tank-medium',
    name: 'Medium Tank',
    type: 'tank',
    mass: 0.3,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 320,
    unlockedByDefault: false,
    description: 'Doubled capacity for orbital insertions.',
    icon: '▮',
    color: 0xffab52,
  },
  {
    id: 'tank-large',
    name: 'Large Tank',
    type: 'tank',
    mass: 0.5,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 560,
    unlockedByDefault: false,
    description: 'Heavy but holds a lot of fuel.',
    icon: '▯',
    color: 0xffbd6b,
  },
  {
    id: 'tank-xl',
    name: 'XL Tank',
    type: 'tank',
    mass: 0.9,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 1000,
    unlockedByDefault: false,
    description: 'For interplanetary missions.',
    icon: '⬛',
    color: 0xffce85,
  },

  // ── NOSES / PAYLOADS ───────────────────────────────────────────────────
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
    color: 0xf3f6ff,
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
    color: 0xe6ecff,
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
    color: 0xffd866,
  },
  {
    id: 'station-module',
    name: 'Station Module',
    type: 'capsule',
    mass: 1.2,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Heavy outpost module. Deliver it to build a base or station.',
    icon: '🏗',
    color: 0x9ad0ff,
  },

  // ── UTILITY ────────────────────────────────────────────────────────────
  {
    id: 'parachute',
    name: 'Parachute',
    type: 'utility',
    mass: 0.05,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Auto-opens on descent in atmosphere for a soft landing.',
    icon: '☂',
    color: 0xffffff,
  },
  {
    id: 'heat-shield',
    name: 'Heat Shield',
    type: 'utility',
    mass: 0.4,
    thrust: 0,
    burnRate: 0,
    fuelCapacity: 0,
    unlockedByDefault: false,
    description: 'Protects from reentry heating.',
    icon: '⛨',
    color: 0xb5703a,
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
    color: 0xc8ccd6,
  },

  // ── LANDERS — separable descent payload with their own engine + fuel ────
  {
    id: 'lander-light',
    name: 'Scout Lander',
    type: 'lander',
    mass: 0.5,
    thrust: 55,
    burnRate: 5,
    fuelCapacity: 200,
    unlockedByDefault: true,
    description: 'Light descent stage with its own tank. Separates late for a soft touchdown.',
    icon: '🛬',
    color: 0xd6e0ee,
  },
  {
    id: 'lander-heavy',
    name: 'Pioneer Lander',
    type: 'lander',
    mass: 1.0,
    thrust: 100,
    burnRate: 9,
    fuelCapacity: 460,
    unlockedByDefault: false,
    description: 'Heavy lander with deep descent tanks — enough fuel to brake and even fly home.',
    icon: '🛸',
    color: 0xf0d98a,
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
