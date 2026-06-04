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

export type CampaignGoal = {
  id: string;
  name: string;
  description: string;
  /** Body id unlocked as a launch base when this goal completes. */
  baseUnlock?: string;
  /**
   * Parts unlocked when this goal completes. Building a space station or a
   * surface base is how the heaviest, most capable hardware is earned — so the
   * orbital/base goals hand out the top-tier engines, tanks and landers that
   * carry the delta-v needed for the outer solar system.
   */
  partUnlocks?: string[];
};

export const CAMPAIGN_GOALS: CampaignGoal[] = [
  { id: 'moon-landing', name: 'Moon Landing',  description: 'Land a craft safely on the Moon.',
    partUnlocks: ['booster-srb-heavy'] },
  { id: 'iss',          name: 'Space Station',  description: 'Carry a Station Module to Earth orbit.',
    partUnlocks: ['tank-mega', 'capsule-command'] },
  { id: 'moon-base',    name: 'Moon Base',      description: 'Deliver a Station Module to the Moon surface.',
    baseUnlock: 'moon', partUnlocks: ['engine-mammoth', 'booster-liquid-xl'] },
  { id: 'mars-landing', name: 'Mars Landing',   description: 'Land a craft safely on Mars.',
    partUnlocks: ['lander-titan'] },
  { id: 'mars-base',    name: 'Mars Base',      description: 'Deliver a Station Module to the Mars surface.',
    baseUnlock: 'mars', partUnlocks: ['engine-plasma'] },
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

function carriesStation(build: RocketBuild): boolean {
  return build.noseId === 'station-module' ||
    (build.utilityIds ?? []).includes('station-module');
}

/** Returns campaign goal ids newly satisfied by a finished flight. */
export function evaluateGoals(ctx: GoalContext, alreadyDone: string[]): string[] {
  const { result, build } = ctx;
  const done = new Set(alreadyDone);
  const station = carriesStation(build);
  const out: string[] = [];
  const award = (id: string, ok: boolean) => {
    if (ok && !done.has(id)) { out.push(id); done.add(id); }
  };

  const landedOn = (body: string) =>
    result.outcome === 'landed' && result.landedBody === body;

  award('moon-landing', landedOn('moon'));
  award('iss', station && result.reachedOrbit && ctx.launchBodyId === 'earth');
  award('moon-base', station && landedOn('moon'));
  award('mars-landing', landedOn('mars'));
  award('mars-base', station && landedOn('mars'));
  return out;
}
