import { MissionResult, RocketBuild } from '../types';

/**
 * Launch-facility tiers. Upgrading the base lets you assemble heavier and more
 * complex rockets. Upgrades are gated on the number of milestones completed
 * (career progression doubles as the "tech" currency).
 */
export type FacilityTier = {
  level: number;
  name: string;
  maxMass: number;        // tonnes the pad can lift
  maxStages: number;      // assembly bay stage slots
  milestonesNeeded: number;
};

export const FACILITY_TIERS: FacilityTier[] = [
  { level: 0, name: 'Launch Pad',     maxMass: 14,  maxStages: 2, milestonesNeeded: 0 },
  { level: 1, name: 'Pad Mk II',      maxMass: 28,  maxStages: 3, milestonesNeeded: 2 },
  { level: 2, name: 'Assembly Bay',   maxMass: 50,  maxStages: 4, milestonesNeeded: 4 },
  { level: 3, name: 'Vehicle Hangar', maxMass: 90,  maxStages: 5, milestonesNeeded: 7 },
  { level: 4, name: 'Orbital Yard',   maxMass: 180, maxStages: 6, milestonesNeeded: 10 },
];

export function facilityTier(level: number): FacilityTier {
  return FACILITY_TIERS[Math.max(0, Math.min(level, FACILITY_TIERS.length - 1))];
}

export function nextFacilityTier(level: number): FacilityTier | null {
  return FACILITY_TIERS[level + 1] ?? null;
}

/** Can the player upgrade to the next tier yet? */
export function canUpgradeFacility(level: number, milestonesDone: number): boolean {
  const next = nextFacilityTier(level);
  return !!next && milestonesDone >= next.milestonesNeeded;
}

// ── Campaign goal chain (the end game) ─────────────────────────────────────

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
  /**
   * Parts unlocked when this goal completes. The campaign — not the quick
   * flight-skill milestones — is the long game: every station, landing and
   * base across the solar system hands out a new part, so progression is paced
   * across many distinct missions instead of a handful of early flights.
   */
  partUnlocks?: string[];
};

const station = (body: string, name: string, description: string, partUnlocks: string[]): CampaignGoal =>
  ({ id: `station-${body}`, kind: 'station', body, name, description, partUnlocks });
const landing = (body: string, name: string, description: string, partUnlocks: string[]): CampaignGoal =>
  ({ id: `land-${body}`, kind: 'landing', body, name, description, partUnlocks });
const base = (body: string, name: string, description: string, partUnlocks: string[]): CampaignGoal =>
  ({ id: `base-${body}`, kind: 'base', body, name, description, baseUnlock: body, partUnlocks });

/**
 * The campaign, ordered roughly by difficulty (delta-v). Stations only need an
 * orbit + a Station Module, so every world — even the gas giants you can't land
 * on — can host one. Landings and bases are reserved for the solid worlds.
 */
export const CAMPAIGN_GOALS: CampaignGoal[] = [
  station('earth',   'Earth Station',    'Carry a Station Module to Earth orbit.',            ['probe-core']),
  landing('moon',    'Moon Landing',     'Land a craft safely on the Moon.',                  ['satellite-bus']),
  station('moon',    'Lunar Station',    'Establish a station in orbit around the Moon.',     ['nose-fairing']),
  station('mercury', 'Mercury Station',  'Orbit a station around scorched Mercury.',          ['engine-aerospike']),
  station('venus',   'Venus Station',    'Orbit a station above the clouds of Venus.',        ['solar-array']),
  landing('venus',   'Venus Landing',    'Survive a landing on the surface of Venus.',        ['rcs-pack']),
  landing('mercury', 'Mercury Landing',  'Touch down on airless Mercury.',                    ['tank-jumbo']),
  station('mars',    'Mars Station',     'Orbit a station around Mars.',                      ['engine-vector']),
  landing('mars',    'Mars Landing',     'Land a craft safely on Mars.',                      ['lander-rover']),
  base('moon',       'Moon Base',        'Deliver a Station Module to the Moon surface.',     ['engine-mammoth']),
  landing('ceres',   'Ceres Landing',    'Set down on the dwarf world Ceres.',                ['booster-srb-heavy']),
  base('mars',       'Mars Base',        'Deliver a Station Module to the Mars surface.',     ['tank-mega']),
  landing('titan',   'Titan Landing',    'Descend through Titan’s haze to its surface.',      ['booster-liquid-xl']),
  station('jupiter', 'Jupiter Station',  'Hold a station in orbit around mighty Jupiter.',    ['capsule-command']),
  station('saturn',  'Saturn Station',   'Orbit a station among Saturn’s rings.',             ['capsule-cupola']),
  station('uranus',  'Uranus Station',   'Reach a station orbit around distant Uranus.',      ['engine-plasma']),
  station('neptune', 'Neptune Station',  'The final frontier — a station orbiting Neptune.',  ['lander-titan']),
  // Outpost chain — a base on every other solid world makes it a launch site, so
  // missions can stage onward from across the system (the launch-from selector
  // lists every base you've established).
  base('venus',      'Venus Base',       'Deliver a Station Module to the Venusian surface.', []),
  base('mercury',    'Mercury Base',     'Establish a base on scorched Mercury.',             []),
  base('ceres',      'Ceres Base',       'Found an outpost on the dwarf world Ceres.',        []),
  base('titan',      'Titan Base',       'Set up a base on Titan, Saturn’s giant moon.',      []),
  base('phobos',     'Phobos Base',      'Anchor a base on tiny Phobos, a moon of Mars.',     []),
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
