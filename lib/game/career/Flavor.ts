/**
 * Centralized comedy. Every generated player-facing flavor string lives here —
 * contract titles and blurbs, tourist personas, payout one-liners, mission
 * headlines — so the game's tone (dry, absurd, strictly PG) stays consistent
 * and can be retuned in one place. Functions are pure: callers pass a number
 * (a seeded roll or a score) and always get the same line back.
 *
 * Rule of tone: the joke rides on top of the facts. Destination, mission kind,
 * payload and reward must survive the punchline.
 */

import { MissionResult } from '../types';

/** Deterministic pick — same n, same list, same line. */
export function pick<T>(list: readonly T[], n: number): T {
  return list[Math.abs(Math.floor(n)) % list.length];
}

// ── Contract titles & blurbs, by payload type ───────────────────────────────
// Templates use {dest}, replaced with the destination body's display name.

export const CARGO_TITLES = [
  'Definitely Just Office Supplies',
  'One (1) Mystery Crate',
  'Fragile: This Side Up-ish',
  'Bulk Snack Resupply',
  'Someone Forgot Their Luggage',
] as const;

export const CARGO_BLURBS = [
  'Haul a crate to {dest}. Do not open the crate. Do not ask about the crate.',
  'Priority freight for {dest}. "Priority" meaning we already cashed the cheque.',
  'A customer at {dest} ordered this three years ago. Reviews mention "shipping".',
  'Deliver supplies to {dest}. Mostly snacks. Morale is also cargo.',
] as const;

export const SATELLITE_TITLES = [
  'Five More Bars of Signal',
  'The Algorithm Needs Eyes',
  'Weather Satellite (Trust Issues)',
  'StreamSat Premium™ Rollout',
] as const;

export const SATELLITE_BLURBS = [
  'Park a satellite in orbit of {dest}. Someone down there has terrible Wi-Fi.',
  'Insert this satellite around {dest}. It only judges you a little.',
  'The marketing team promised coverage at {dest}. Now it is your problem.',
] as const;

export const STATION_TITLES = [
  'Habitat, Some Assembly Required',
  'Open a Branch Office',
  'The HOA Approved a Station',
  'Premium Orbital Real Estate',
] as const;

export const STATION_BLURBS = [
  'Deploy a station module in orbit of {dest}. Use the DEPLOY button, not hope.',
  'Management wants a presence around {dest}. Management will not be visiting.',
  'Establish a station at {dest}. The brochure says "cosy". It is one module.',
] as const;

export const BASE_TITLES = [
  'Plant a Flagless Base',
  'Ground Floor Opportunity',
  'Surface Branch, No Windows',
  'Real Estate, Technically',
] as const;

export const BASE_BLURBS = [
  'Land a station module on {dest} and deploy it on the surface. Gently. GENTLY.',
  'Set up a base on {dest}. The welcome mat is included in the module. Probably.',
  'Corporate wants boots on {dest}. The boots are a building. Deliver the building.',
] as const;

// ── Tourists ─────────────────────────────────────────────────────────────────

export type TouristPersona = {
  name: string;
  /** The pitch, with {dest} substituted. Doubles as the contract blurb. */
  premise: string;
  /** Shown in the payout summary when delivered. */
  payoff: string;
};

export const TOURIST_PERSONAS: readonly TouristPersona[] = [
  {
    name: 'Glorbnak (yes, that Glorbnak)',
    premise: 'Get me to {dest} to catch my cheating alien husband. He said he was "working late at the nebula".',
    payoff: 'Tourist delivered. Husband confronted. 5⭐ review, minus the divorce.',
  },
  {
    name: 'Kayleigh-Bree, Content Creator',
    premise: 'I need {dest} for my feed. The lighting on Earth is SO over.',
    payoff: 'Tourist delivered. 14,000 photos taken, one posted. You were not tagged.',
  },
  {
    name: 'Harold, 78',
    premise: 'I booked a river cruise. This says {dest}. At my age you just go with it.',
    payoff: 'Tourist delivered. Harold rated the buffet 2⭐. There was no buffet.',
  },
  {
    name: 'A Billionaire (legally anonymous)',
    premise: 'Get me to {dest} before the board meeting starts. Especially if it has started.',
    payoff: 'Tourist delivered. The board voted. He does not want to talk about it.',
  },
  {
    name: 'Trish from Accounts',
    premise: 'I won the office raffle to {dest}. Second prize was two trips.',
    payoff: 'Tourist delivered. Expense report filed from orbit. Receipt: one (1) rocket.',
  },
  {
    name: 'Dr. Wexler, Flat-Planet Society',
    premise: 'Take me to {dest} so I can confirm it is a disc. I will not be elaborating.',
    payoff: 'Tourist delivered. Findings inconclusive, worldview intact, payment cleared.',
  },
] as const;

export const TOURIST_TITLES = [
  'One Passenger, Many Opinions',
  'Space Tourism (No Refunds)',
  'VIP Transport, Allegedly',
  'A Paying Customer, Somehow',
] as const;

// ── Payout one-liners (non-tourist), by payload type ─────────────────────────

export const CARGO_PAYOFFS = [
  'Crate delivered. Contents unknown. Curiosity professionally suppressed.',
  'Package delivered. Signature obtained from a rock.',
  'Freight arrived. Only mildly rearranged by physics.',
] as const;

export const SATELLITE_PAYOFFS = [
  'Satellite on station. Somewhere, a download finishes.',
  'Satellite deployed. It is already disappointed in our search history.',
  'Coverage achieved. Marketing has been notified, regrettably.',
] as const;

export const STATION_PAYOFFS = [
  'Station deployed. The HOA has already filed a noise complaint.',
  'Station open for business. Gravity sold separately.',
  'Module on station. Someone has dibs on the window. There is no window.',
] as const;

export const BASE_PAYOFFS = [
  'Base deployed. First order of business: arguing about the thermostat.',
  'Surface outpost established. The welcome mat blew away immediately.',
  'Base online. Population: one building, several opinions.',
] as const;

// ── Mission-summary headlines ────────────────────────────────────────────────

const CRASH_HEADLINES = [
  'Rapid Unscheduled Disassembly',
  'Lithobraking: Not a Real Maneuver',
  'The Ground Was There First',
  'New Crater, Who Dis',
] as const;

const LANDED_HEADLINES = [
  'The Eagle Has Flopped (Gently)',
  'Touchdown. Crowd Goes Mild.',
  'Parked. Sort Of Legally.',
  'Landing: Technically Graceful',
] as const;

const ORBIT_HEADLINES = [
  'Going in Circles, Professionally',
  'Orbit Achieved. Loitering, Now.',
  'Falling Forever, On Purpose',
] as const;

const ENDED_HEADLINES = [
  'Well, That Happened',
  'Flight Concluded (Verb Chosen Carefully)',
  'Mission Over. Paperwork Begins.',
] as const;

/** Deterministic comic headline for the mission-summary screen. */
export function missionHeadline(result: MissionResult): string {
  const roll = result.score;
  if (result.outcome === 'crashed') return pick(CRASH_HEADLINES, roll);
  if (result.landedBody)            return pick(LANDED_HEADLINES, roll);
  if (result.reachedOrbit)          return pick(ORBIT_HEADLINES, roll);
  return pick(ENDED_HEADLINES, roll);
}

// ── Small UI copy ────────────────────────────────────────────────────────────

export const CONTRACT_FAILED_LINE =
  'Contract not fulfilled. The customer has been told it was "weather".';

export const NO_CONTRACT_HINT =
  'No contract accepted — flying for the love of it (and $0).';
