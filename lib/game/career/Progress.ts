import { MissionResult, RocketBuild } from '../types';

/**
 * Launch-facility tiers. Upgrading the base lets you assemble heavier and more
 * complex rockets. Upgrades are bought with contract money — the career's
 * currency — so a bigger pad is a purchase, not a participation award.
 */
export type FacilityTier = {
  level: number;
  name: string;
  maxMass: number;        // tonnes the pad can lift
  maxStages: number;      // assembly bay stage slots
  cost: number;           // money to upgrade INTO this tier
};

export const FACILITY_TIERS: FacilityTier[] = [
  { level: 0, name: 'Launch Pad',     maxMass: 14,  maxStages: 2, cost: 0 },
  { level: 1, name: 'Pad Mk II',      maxMass: 28,  maxStages: 3, cost: 3000 },
  { level: 2, name: 'Assembly Bay',   maxMass: 50,  maxStages: 4, cost: 10000 },
  { level: 3, name: 'Vehicle Hangar', maxMass: 90,  maxStages: 5, cost: 25000 },
  { level: 4, name: 'Orbital Yard',   maxMass: 180, maxStages: 6, cost: 50000 },
];

export function facilityTier(level: number): FacilityTier {
  return FACILITY_TIERS[Math.max(0, Math.min(level, FACILITY_TIERS.length - 1))];
}

export function nextFacilityTier(level: number): FacilityTier | null {
  return FACILITY_TIERS[level + 1] ?? null;
}

/** Can the player afford the next facility tier? */
export function canUpgradeFacility(level: number, money: number): boolean {
  const next = nextFacilityTier(level);
  return !!next && money >= next.cost;
}

// ── Campaign goal chain (the long game) ─────────────────────────────────────

export type GoalKind = 'station' | 'landing' | 'base';

export type CampaignGoal = {
  id: string;
  name: string;
  description: string;
  /** What the goal asks for: orbit a station, land, or land a base module. */
  kind: GoalKind;
  /** Body the goal happens at. */
  body: string;
  /** Body id unlocked as a launch base when this goal completes. */
  baseUnlock?: string;
  /** One-time cash bonus on completion. */
  cash: number;
  /** Reputation granted on completion (feeds the rank ladder). */
  reputation: number;
};

const station = (body: string, cash: number, rep: number, name: string, description: string): CampaignGoal =>
  ({ id: `station-${body}`, kind: 'station', body, name, description, cash, reputation: rep });
const landing = (body: string, cash: number, rep: number, name: string, description: string): CampaignGoal =>
  ({ id: `land-${body}`, kind: 'landing', body, name, description, cash, reputation: rep });
const base = (body: string, cash: number, rep: number, name: string, description: string): CampaignGoal =>
  ({ id: `base-${body}`, kind: 'base', body, name, description, baseUnlock: body, cash, reputation: rep });

/**
 * The campaign, ordered roughly by difficulty (delta-v). Stations only need an
 * orbit + a Station Module, so every world — even the gas giants you can't land
 * on — can host one. Landings and bases are reserved for the solid worlds.
 * Goals pay cash + reputation (and bases open new launch sites); the parts
 * catalog itself is bought with money, rank-gated.
 */
export const CAMPAIGN_GOALS: CampaignGoal[] = [
  station('earth', 1500, 1, 'Earth Station',  'Put a Station Module in Earth orbit. Like a treehouse, but worse to reach.'),
  landing('moon',  2500, 2, 'Moon Landing',   'Land on the Moon. Small step, giant invoice.'),
  station('moon',  2500, 2, 'Lunar Station',  'A station around the Moon — for people who find the Moon too crowded.'),
  station('mercury', 4000, 2, 'Mercury Station', 'Orbit scorched Mercury. Sunscreen is structural here.'),
  station('venus', 4000, 2, 'Venus Station',  'Hold a station above the clouds of Venus. Do not look down. Or breathe.'),
  landing('venus', 5000, 3, 'Venus Landing',  'Survive a landing on Venus, the solar system’s angriest sauna.'),
  landing('mercury', 5000, 3, 'Mercury Landing', 'Touch down on airless Mercury. Parking is free; everything else costs.'),
  station('mars',  5000, 3, 'Mars Station',   'Orbit a station around Mars. The red planet now has an HOA.'),
  landing('mars',  6000, 3, 'Mars Landing',   'Land on Mars. Bring snacks; the local cuisine is regolith.'),
  base('moon',     6000, 3, 'Moon Base',      'Deliver a Station Module to the Moon’s surface — your first off-world launch pad.'),
  landing('ceres', 7000, 3, 'Ceres Landing',  'Set down on Ceres, a dwarf world with big ambitions.'),
  base('mars',     8000, 4, 'Mars Base',      'A base on Mars: real estate slogan, “location, location, radiation”.'),
  landing('titan', 9000, 4, 'Titan Landing',  'Descend through Titan’s orange haze. The haze does not descend back.'),
  station('jupiter', 9000, 4, 'Jupiter Station', 'Orbit the king of planets without becoming part of it.'),
  station('saturn', 10000, 4, 'Saturn Station', 'A station among Saturn’s rings. Mind the gravel.'),
  station('uranus', 11000, 5, 'Uranus Station', 'Reach distant Uranus. Yes, the jokes are also gated by rank.'),
  station('neptune', 12000, 5, 'Neptune Station', 'A station around Neptune — the edge of the map, the top of the resume.'),
  // Outpost chain — a base on every other solid world makes it a launch site, so
  // missions can stage onward from across the system (the launch-from selector
  // lists every base you've established).
  base('venus',   9000, 4, 'Venus Base',   'A base on Venus. The brochure says “tropical”. The brochure is sweating.'),
  base('mercury', 9000, 4, 'Mercury Base', 'An outpost on Mercury, where every day is several days long.'),
  base('ceres',   9000, 4, 'Ceres Base',   'Found an outpost on Ceres and become big in the asteroid belt, literally.'),
  base('titan',  11000, 5, 'Titan Base',   'A base on Titan: lakeside property, methane lakes, no swimming.'),
  base('phobos', 10000, 4, 'Phobos Base',  'Anchor a base to Phobos before someone skips it across Mars.'),
];

export function campaignGoal(id: string): CampaignGoal | undefined {
  return CAMPAIGN_GOALS.find((g) => g.id === id);
}

/** Context captured at the end of a flight, used to award campaign goals. */
export type GoalContext = {
  result: MissionResult;
  build: RocketBuild;
  launchBodyId: string;
};

/**
 * Campaign goals satisfied at the END of a flight: landings (touching a world's
 * surface). Stations and bases are deployed in-flight with the DEPLOY button —
 * in orbit (a station) or on the surface (a base) — and granted the moment the
 * module separates (see {@link stationGoalId} / {@link baseGoalId}).
 */
export function evaluateGoals(ctx: GoalContext, alreadyDone: string[]): string[] {
  const done = new Set(alreadyDone);
  const landedOn = (body: string) =>
    ctx.result.outcome === 'landed' && ctx.result.landedBody === body;
  const out: string[] = [];
  for (const g of CAMPAIGN_GOALS) {
    if (done.has(g.id)) continue;
    if (g.kind === 'landing' && landedOn(g.body)) { out.push(g.id); done.add(g.id); }
  }
  return out;
}

/** The campaign goal id for deploying a station in orbit of `body`, if any. */
export function stationGoalId(body: string): string | undefined {
  const id = `station-${body}`;
  return CAMPAIGN_GOALS.some((g) => g.id === id) ? id : undefined;
}

/** The campaign goal id for deploying a base on the surface of `body`, if any. */
export function baseGoalId(body: string): string | undefined {
  const id = `base-${body}`;
  return CAMPAIGN_GOALS.some((g) => g.id === id) ? id : undefined;
}
