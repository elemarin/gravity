/**
 * The contract system — the career's job board.
 *
 * A contract is a delivery: fly a payload (cargo, satellite, station module,
 * base module, or a paying tourist) to a destination with a required mission
 * kind ('orbit' | 'land' — all jobs are one-way), and get paid.
 *
 * Everything here is pure and deterministic: the daily board is generated from
 * a date-keyed seed over hardcoded pools, rewards are derived from the same Δv
 * budgets that gate launches (Requirements.ts), and fulfillment is decided
 * from the MissionResult the simulator already produces. No second physics
 * path — contracts are a metadata + reward layer on top of the sim.
 */

import { MissionKind } from '../plan/FlightPlan';
import { MissionResult } from '../types';
import { bodyDef, isLandable } from '../bodies';
import { requiredDeltaV } from './Requirements';
import { ROCKET_PRESETS } from './Presets';
import { estimateBuildDeltaV } from '../BuildSpec';
import {
  pick, TouristPersona, TOURIST_PERSONAS, TOURIST_TITLES,
  CARGO_TITLES, CARGO_BLURBS, SATELLITE_TITLES, SATELLITE_BLURBS,
  STATION_TITLES, STATION_BLURBS, BASE_TITLES, BASE_BLURBS,
  CARGO_PAYOFFS, SATELLITE_PAYOFFS, STATION_PAYOFFS, BASE_PAYOFFS,
} from './Flavor';

export type PayloadType = 'cargo' | 'satellite' | 'station' | 'base' | 'tourist';

export type Contract = {
  id: string;
  title: string;
  description: string;
  /** Launch site the job assumes (defaults to Earth). */
  launchBodyId?: string;
  /** Destination id: a body id, or 'orbit' for "orbit the launch world". */
  destinationId: string;
  missionKind: MissionKind;
  payloadType: PayloadType;
  /** Base payout on completion. */
  reward: number;
  /** Extra payout for a clean job (rating S or A). */
  bonus: number;
  /** Reputation earned on completion (feeds the rank ladder). */
  reputation: number;
  /** Minimum rank level required to accept the job. */
  rankRequired: number;
  /** Part type that must be aboard (tourists insist on a capsule of some kind). */
  requiredPartType?: 'capsule';
  /** The passenger, when payloadType is 'tourist'. */
  tourist?: TouristPersona;
};

export const PAYLOAD_LABELS: Record<PayloadType, string> = {
  cargo:     '📦 Cargo',
  satellite: '🛰 Satellite',
  station:   '🏗 Station',
  base:      '🏠 Base',
  tourist:   '🧳 Tourist',
};

// ── Seeded PRNG (no dependencies, deterministic across platforms) ────────────

export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local calendar day, e.g. '2026-06-10' — the daily board rolls at midnight. */
export function dateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// ── Hardcoded generation pools ───────────────────────────────────────────────

/** Destination pools by contract tier; the tier doubles as the rank gate. */
export const CONTRACT_TIERS: readonly { rankRequired: number; destinations: readonly string[] }[] = [
  { rankRequired: 0, destinations: ['orbit'] },
  { rankRequired: 1, destinations: ['moon'] },
  { rankRequired: 2, destinations: ['mercury', 'venus', 'mars'] },
  { rankRequired: 3, destinations: ['phobos', 'ceres', 'jupiter'] },
  { rankRequired: 4, destinations: ['saturn', 'titan', 'uranus', 'neptune'] },
];

const ORBIT_PAYLOADS: readonly PayloadType[] = ['cargo', 'satellite', 'station'];
const LAND_PAYLOADS: readonly PayloadType[] = ['cargo', 'base'];

/** Display name for a destination ('orbit' is the launch world's orbit). */
export function destinationName(destinationId: string, launchBodyId = 'earth'): string {
  if (destinationId === 'orbit') return `${bodyDef(launchBodyId).name} orbit`;
  return bodyDef(destinationId).name;
}

/** Body a contract is fulfilled at ('orbit' resolves to the launch world). */
export function contractTargetBodyId(c: Contract): string {
  return c.destinationId === 'orbit' ? (c.launchBodyId ?? 'earth') : c.destinationId;
}

// ── Achievability ────────────────────────────────────────────────────────────

/** The most Δv any rocket in the catalog can carry — the hard content cap. */
export const MAX_CATALOG_DV = Math.max(
  ...ROCKET_PRESETS.map((p) => estimateBuildDeltaV(p.build)),
);

/** Δv a build must carry to fly this contract (the same gate launches use). */
export function contractDeltaV(c: Contract): number {
  return requiredDeltaV(c.launchBodyId ?? 'earth', c.destinationId, c.missionKind);
}

/** A contract no buildable rocket can fly must never reach the board. */
export function isAchievable(c: Contract): boolean {
  return contractDeltaV(c) <= MAX_CATALOG_DV;
}

// ── Reward math ──────────────────────────────────────────────────────────────

const PAYLOAD_MULTIPLIER: Record<PayloadType, number> = {
  cargo: 1.0, satellite: 1.15, tourist: 1.35, station: 1.6, base: 1.9,
};

/** Base payout: scales with the job's Δv budget and climbs with its tier. */
export function contractReward(
  destinationId: string, missionKind: MissionKind, payloadType: PayloadType, tier: number,
): number {
  const dv = requiredDeltaV('earth', destinationId, missionKind);
  const raw = Math.max(800, (dv - 2200) * 1.5) * (1 + 0.25 * tier) * PAYLOAD_MULTIPLIER[payloadType];
  return Math.round(raw / 50) * 50;
}

function bonusFor(reward: number): number {
  return Math.round((reward * 0.25) / 50) * 50;
}

// ── Contract construction ────────────────────────────────────────────────────

type Spec = {
  id: string;
  tier: number;
  destinationId: string;
  missionKind: MissionKind;
  payloadType: PayloadType;
  /** Seeded roll used to pick flavor lines deterministically. */
  roll: number;
};

function makeContract(spec: Spec): Contract {
  const { id, tier, destinationId, payloadType, roll } = spec;
  // A land job whose Δv budget no rocket carries downgrades to orbit; bases
  // have no orbit fallback, so they become plain cargo if that happens.
  let missionKind = spec.missionKind;
  let payload = payloadType;
  const landDv = requiredDeltaV('earth', destinationId, 'land');
  if (missionKind === 'land' && landDv > MAX_CATALOG_DV) {
    missionKind = 'orbit';
    if (payload === 'base') payload = 'cargo';
  }

  const dest = destinationName(destinationId);
  const sub = (s: string) => s.replace(/\{dest\}/g, dest);
  let title: string;
  let description: string;
  let tourist: TouristPersona | undefined;
  switch (payload) {
    case 'tourist': {
      const persona = pick(TOURIST_PERSONAS, roll);
      tourist = { ...persona, premise: sub(persona.premise) };
      title = pick(TOURIST_TITLES, roll);
      description = `${tourist.name}: “${tourist.premise}”`;
      break;
    }
    case 'satellite':
      title = pick(SATELLITE_TITLES, roll);
      description = sub(pick(SATELLITE_BLURBS, roll));
      break;
    case 'station':
      title = pick(STATION_TITLES, roll);
      description = sub(pick(STATION_BLURBS, roll));
      break;
    case 'base':
      title = pick(BASE_TITLES, roll);
      description = sub(pick(BASE_BLURBS, roll));
      break;
    default:
      title = pick(CARGO_TITLES, roll);
      description = sub(pick(CARGO_BLURBS, roll));
  }

  const reward = contractReward(destinationId, missionKind, payload, tier);
  return {
    id,
    title,
    description,
    destinationId,
    missionKind,
    payloadType: payload,
    reward,
    bonus: bonusFor(reward),
    reputation: tier + 1,
    rankRequired: CONTRACT_TIERS[tier].rankRequired,
    ...(payload === 'tourist' ? { requiredPartType: 'capsule' as const, tourist } : {}),
  };
}

// ── Daily board ──────────────────────────────────────────────────────────────

/**
 * The day's contracts: one per tier so every rank always has a job, generated
 * deterministically from the date key (same day → same board), with exactly
 * one slot forced to carry a tourist.
 */
export function dailyContracts(key: string): Contract[] {
  const rng = mulberry32(seedFromString(`gravity-daily:${key}`));
  const touristSlot = Math.floor(rng() * CONTRACT_TIERS.length);
  return CONTRACT_TIERS.map((tierDef, tier) => {
    const destinationId = tierDef.destinations[Math.floor(rng() * tierDef.destinations.length)];
    const target = destinationId === 'orbit' ? 'earth' : destinationId;
    const canLand = destinationId !== 'orbit' && isLandable(target);
    const missionKind: MissionKind = canLand && rng() < 0.5 ? 'land' : 'orbit';
    const pool = missionKind === 'land' ? LAND_PAYLOADS : ORBIT_PAYLOADS;
    const payloadType = tier === touristSlot
      ? 'tourist'
      : pool[Math.floor(rng() * pool.length)];
    return makeContract({
      id: `daily:${key}:${tier}`,
      tier,
      destinationId,
      missionKind,
      payloadType,
      roll: Math.floor(rng() * 1e9),
    });
  });
}

// ── Standing contracts (always on the board, each completable once) ─────────

function standing(
  id: string, tier: number, destinationId: string, missionKind: MissionKind,
  payloadType: PayloadType, roll: number,
): Contract {
  return makeContract({ id: `standing:${id}`, tier, destinationId, missionKind, payloadType, roll });
}

export const STANDING_CONTRACTS: Contract[] = [
  standing('first-delivery', 0, 'orbit', 'orbit', 'cargo', 0),
  standing('leo-satellite',  0, 'orbit', 'orbit', 'satellite', 1),
  standing('earth-station',  0, 'orbit', 'orbit', 'station', 0),
  standing('moon-freight',   1, 'moon', 'land', 'cargo', 2),
  standing('moon-base',      1, 'moon', 'land', 'base', 1),
  // The flagship tourist job — Glorbnak's marital crisis waits at Mars.
  standing('alien-husband',  2, 'mars', 'orbit', 'tourist', 0),
  standing('mars-drop',      2, 'mars', 'land', 'cargo', 3),
  standing('jupiter-eye',    3, 'jupiter', 'orbit', 'satellite', 2),
  standing('titan-base',     4, 'titan', 'land', 'base', 3),
  standing('neptune-cruise', 4, 'neptune', 'orbit', 'tourist', 2),
];

// ── Fulfillment ──────────────────────────────────────────────────────────────

export type ContractEvaluation = {
  completed: boolean;
  /** reward (+ bonus on an S/A rating) when completed, else 0. */
  payout: number;
  /** The comedic payoff line for the summary screen. */
  line: string;
};

const PAYOFFS_BY_PAYLOAD: Record<Exclude<PayloadType, 'tourist'>, readonly string[]> = {
  cargo: CARGO_PAYOFFS,
  satellite: SATELLITE_PAYOFFS,
  station: STATION_PAYOFFS,
  base: BASE_PAYOFFS,
};

export function payoffLine(c: Contract): string {
  if (c.payloadType === 'tourist' && c.tourist) return c.tourist.payoff;
  return pick(
    PAYOFFS_BY_PAYLOAD[c.payloadType as Exclude<PayloadType, 'tourist'>] ?? CARGO_PAYOFFS,
    seedFromString(c.id),
  );
}

export type FulfillmentContext = {
  /** Body a base module was deployed on the surface of this flight, if any
   *  (from the onStationDeploy(bodyId, onSurface=true) callback). */
  surfaceDeployBodyId?: string | null;
  /** Whether the build carries a capsule-type payload (tourists demand seats).
   *  Omitted = assumed true. */
  hasCapsule?: boolean;
  /** Whether the build carries a Satellite Bus (satellite contracts require one).
   *  Omitted = assumed true. */
  hasSatelliteBus?: boolean;
  /** Whether the build carries a Payload Fairing nose (cargo contracts require one).
   *  Omitted = assumed true. */
  hasPayloadFairing?: boolean;
};

/**
 * Decide whether `result` fulfills the contract, and the payout. Pure: maps
 * the contract onto the same signals campaign goals already use — reached /
 * orbited a body, landed on it, station module deployed — never the physics.
 */
export function evaluateContract(
  c: Contract, result: MissionResult, ctx: FulfillmentContext = {},
): ContractEvaluation {
  const target = contractTargetBodyId(c);
  const homeOrbit = c.destinationId === 'orbit';
  const reachedTarget = homeOrbit
    ? result.reachedOrbit
    : result.reachedBodies.includes(target);

  let completed: boolean;
  switch (c.payloadType) {
    case 'station':
      completed = result.stationDeployed && result.stationBodyId === target;
      break;
    case 'base':
      completed = ctx.surfaceDeployBodyId === target;
      break;
    case 'satellite':
      // Satellite Bus must be aboard; reaching the target deploys it automatically.
      completed = ctx.hasSatelliteBus !== false && (
        c.missionKind === 'land'
          ? result.outcome === 'landed' && result.landedBody === target
          : reachedTarget && result.outcome !== 'crashed'
      );
      break;
    case 'cargo':
      // Payload Fairing must be on the nose to haul cargo.
      completed = ctx.hasPayloadFairing !== false && (
        c.missionKind === 'land'
          ? result.outcome === 'landed' && result.landedBody === target
          : reachedTarget && result.outcome !== 'crashed'
      );
      break;
    default:
      // Tourist: deliver intact to the required spot (capsule check follows below).
      completed = c.missionKind === 'land'
        ? result.outcome === 'landed' && result.landedBody === target
        : reachedTarget && result.outcome !== 'crashed';
  }
  if (c.requiredPartType === 'capsule' && ctx.hasCapsule === false) completed = false;

  const cleanJob = result.rating === 'S' || result.rating === 'A';
  const payout = completed ? c.reward + (cleanJob ? c.bonus : 0) : 0;
  return { completed, payout, line: completed ? payoffLine(c) : '' };
}
