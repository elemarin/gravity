/**
 * Contract economy regressions: deterministic daily generation, achievability
 * against the same Δv budgets that gate launches, fulfillment detection from
 * MissionResult for every payload type, reward math, the rank ladder, and the
 * one-way mission-kind reduction (including old-save migration).
 */
import { describe, it, expect } from 'vitest';
import {
  dailyContracts, dateKey, STANDING_CONTRACTS, CONTRACT_TIERS,
  contractDeltaV, isAchievable, MAX_CATALOG_DV, contractReward,
  evaluateContract, contractTargetBodyId, payoffLine,
  seedFromString, mulberry32, Contract,
} from '../lib/game/career/Contracts';
import {
  RANKS, rankForReputation, nextRank, rankProgress, canPurchaseTier, rankNeededForTier,
} from '../lib/game/career/Rank';
import { partPrice, PART_TIER_PRICES, checkPurchase } from '../lib/game/career/Economy';
import { PARTS_CATALOG } from '../lib/game/career/Parts';
import { MISSION_LABELS } from '../lib/game/plan/FlightPlan';
import { migrateStoredPlan } from '../lib/storage';
import { isLandable } from '../lib/game/bodies';
import { MissionResult } from '../lib/game/types';

const KEY = '2026-06-10';

function result(over: Partial<MissionResult> = {}): MissionResult {
  return {
    outcome: 'landed', maxAltitude: 300, maxSpeed: 1, landingSpeed: 2,
    reachedSpace: true, reachedOrbit: true, rating: 'B', score: 2000,
    reachedBodies: ['earth'], landedBody: null, transferCompleted: false,
    stationDeployed: false, stationBodyId: null,
    ...over,
  };
}

describe('daily contract generation', () => {
  it('is deterministic for a given date key', () => {
    expect(dailyContracts(KEY)).toEqual(dailyContracts(KEY));
  });

  it('differs across days (the board actually refreshes)', () => {
    const a = JSON.stringify(dailyContracts('2026-06-10'));
    const b = JSON.stringify(dailyContracts('2026-06-11'));
    const c = JSON.stringify(dailyContracts('2026-06-12'));
    expect(a === b && b === c).toBe(false);
  });

  it('produces one contract per tier, ids keyed to the date', () => {
    const board = dailyContracts(KEY);
    expect(board).toHaveLength(CONTRACT_TIERS.length);
    board.forEach((c, i) => {
      expect(c.id).toBe(`daily:${KEY}:${i}`);
      expect(c.rankRequired).toBe(CONTRACT_TIERS[i].rankRequired);
    });
  });

  it('every generated contract is achievable and one-way, across many days', () => {
    for (let day = 1; day <= 28; day++) {
      const key = `2026-06-${String(day).padStart(2, '0')}`;
      for (const c of dailyContracts(key)) {
        expect(['orbit', 'land']).toContain(c.missionKind);
        expect(isAchievable(c), `${c.id} needs ${contractDeltaV(c)} > ${MAX_CATALOG_DV}`).toBe(true);
        if (c.missionKind === 'land') {
          expect(isLandable(contractTargetBodyId(c)), `${c.id} lands on a gas giant`).toBe(true);
        }
        if (c.payloadType === 'base') expect(c.missionKind).toBe('land');
        if (c.payloadType === 'station' || c.payloadType === 'satellite') {
          expect(c.missionKind).toBe('orbit');
        }
        expect(c.reward).toBeGreaterThan(0);
        expect(c.reputation).toBeGreaterThan(0);
        // The jokes never obscure the facts: every contract names its destination.
        expect(c.title.length).toBeGreaterThan(0);
        expect(c.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('always includes exactly one tourist on the daily board', () => {
    for (const key of ['2026-06-10', '2026-07-01', '2027-01-31']) {
      const tourists = dailyContracts(key).filter((c) => c.payloadType === 'tourist');
      expect(tourists).toHaveLength(1);
      expect(tourists[0].tourist).toBeDefined();
      expect(tourists[0].requiredPartType).toBe('capsule');
    }
  });

  it('dateKey is a stable local calendar day', () => {
    expect(dateKey(new Date(2026, 5, 10, 23, 59))).toBe('2026-06-10');
    expect(dateKey(new Date(2026, 5, 11, 0, 0))).toBe('2026-06-11');
  });

  it('seeded PRNG is deterministic', () => {
    const a = mulberry32(seedFromString('x'));
    const b = mulberry32(seedFromString('x'));
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});

describe('standing contracts', () => {
  it('are all achievable, one-way, and uniquely identified', () => {
    const ids = new Set<string>();
    for (const c of STANDING_CONTRACTS) {
      expect(['orbit', 'land']).toContain(c.missionKind);
      expect(isAchievable(c)).toBe(true);
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
    }
  });

  it('include the cheating-alien-husband tourist premise', () => {
    const c = STANDING_CONTRACTS.find((x) => x.id === 'standing:alien-husband')!;
    expect(c.payloadType).toBe('tourist');
    expect(c.tourist!.premise).toContain('cheating alien husband');
    expect(c.tourist!.payoff).toContain('divorce');
  });
});

describe('contract fulfillment', () => {
  const cargo: Contract = {
    id: 't:cargo', title: 't', description: 't', destinationId: 'moon',
    missionKind: 'orbit', payloadType: 'cargo', reward: 1000, bonus: 250,
    reputation: 2, rankRequired: 1,
  };

  it('cargo to orbit: completed by reaching the body intact', () => {
    const ok = evaluateContract(cargo, result({ reachedBodies: ['earth', 'moon'] }));
    expect(ok.completed).toBe(true);
    expect(ok.payout).toBe(1000);
    expect(ok.line.length).toBeGreaterThan(0);
    expect(evaluateContract(cargo, result({ reachedBodies: ['earth'] })).completed).toBe(false);
    expect(evaluateContract(cargo, result({
      reachedBodies: ['earth', 'moon'], outcome: 'crashed',
    })).completed).toBe(false);
  });

  it('pays the clean-job bonus on an S or A rating', () => {
    const r = result({ reachedBodies: ['earth', 'moon'], rating: 'S' });
    expect(evaluateContract(cargo, r).payout).toBe(1250);
  });

  it('cargo to land: completed only by a touchdown on the target', () => {
    const land: Contract = { ...cargo, id: 't:land', missionKind: 'land' };
    expect(evaluateContract(land, result({
      reachedBodies: ['earth', 'moon'], landedBody: 'moon',
    })).completed).toBe(true);
    expect(evaluateContract(land, result({
      reachedBodies: ['earth', 'moon'], landedBody: null,
    })).completed).toBe(false);
    expect(evaluateContract(land, result({
      reachedBodies: ['earth', 'moon'], landedBody: 'moon', outcome: 'crashed',
    })).completed).toBe(false);
  });

  it("'orbit' destination resolves to the launch world and uses reachedOrbit", () => {
    const leo: Contract = { ...cargo, id: 't:leo', destinationId: 'orbit' };
    expect(contractTargetBodyId(leo)).toBe('earth');
    expect(evaluateContract(leo, result({ reachedOrbit: true })).completed).toBe(true);
    expect(evaluateContract(leo, result({ reachedOrbit: false })).completed).toBe(false);
  });

  it('station: completed by an in-orbit module deploy at the target', () => {
    const station: Contract = { ...cargo, id: 't:station', payloadType: 'station' };
    expect(evaluateContract(station, result({
      reachedBodies: ['earth', 'moon'], stationDeployed: true, stationBodyId: 'moon',
    })).completed).toBe(true);
    expect(evaluateContract(station, result({
      reachedBodies: ['earth', 'moon'], stationDeployed: true, stationBodyId: 'earth',
    })).completed).toBe(false);
    expect(evaluateContract(station, result({
      reachedBodies: ['earth', 'moon'],
    })).completed).toBe(false);
  });

  it('base: completed by a surface deploy observed in-flight', () => {
    const base: Contract = { ...cargo, id: 't:base', missionKind: 'land', payloadType: 'base' };
    const landedOnMoon = result({ reachedBodies: ['earth', 'moon'], landedBody: 'moon' });
    expect(evaluateContract(base, landedOnMoon, { surfaceDeployBodyId: 'moon' }).completed).toBe(true);
    expect(evaluateContract(base, landedOnMoon, { surfaceDeployBodyId: null }).completed).toBe(false);
    expect(evaluateContract(base, landedOnMoon, { surfaceDeployBodyId: 'mars' }).completed).toBe(false);
  });

  it('tourist: delivery counts only with a capsule aboard', () => {
    const tourist: Contract = {
      ...cargo, id: 't:tourist', payloadType: 'tourist', requiredPartType: 'capsule',
      tourist: { name: 'T', premise: 'p', payoff: 'Tourist delivered.' },
    };
    const r = result({ reachedBodies: ['earth', 'moon'] });
    expect(evaluateContract(tourist, r, { hasCapsule: true }).completed).toBe(true);
    expect(evaluateContract(tourist, r, { hasCapsule: false }).completed).toBe(false);
    const done = evaluateContract(tourist, r, { hasCapsule: true });
    expect(done.line).toBe('Tourist delivered.'); // the persona's payoff line
  });

  it('payoff lines are deterministic per contract', () => {
    expect(payoffLine(cargo)).toBe(payoffLine({ ...cargo }));
  });
});

describe('reward math & part economy', () => {
  it('rewards climb with the destination ladder and the payload stakes', () => {
    const leo = contractReward('orbit', 'orbit', 'cargo', 0);
    const moon = contractReward('moon', 'orbit', 'cargo', 1);
    const mars = contractReward('mars', 'land', 'cargo', 2);
    const neptune = contractReward('neptune', 'orbit', 'cargo', 4);
    expect(leo).toBeGreaterThan(0);
    expect(moon).toBeGreaterThan(leo);
    expect(mars).toBeGreaterThan(moon);
    expect(neptune).toBeGreaterThan(mars);
    expect(contractReward('moon', 'orbit', 'tourist', 1)).toBeGreaterThan(moon);
    expect(contractReward('moon', 'orbit', 'station', 1)).toBeGreaterThan(moon);
  });

  it('part prices follow tiers; starters are free', () => {
    for (const p of PARTS_CATALOG) {
      if (p.unlockedByDefault) expect(partPrice(p)).toBe(0);
      else {
        expect(partPrice(p)).toBeGreaterThan(0);
        expect(partPrice(p)).toBe(PART_TIER_PRICES[Math.min(p.tier ?? 1, 4)] || PART_TIER_PRICES[1]);
      }
    }
  });

  it('spend-to-unlock: enough money + rank buys, anything less does not', () => {
    const part = PARTS_CATALOG.find((p) => !p.unlockedByDefault && (p.tier ?? 0) === 2)!;
    const price = partPrice(part);
    expect(checkPurchase(part, price, 1).ok).toBe(true);      // rank 1 buys tier 2
    expect(checkPurchase(part, price - 1, 1).ok).toBe(false); // short on funds
    expect(checkPurchase(part, price, 0).ok).toBe(false);     // short on rank
  });
});

describe('rank ladder', () => {
  it('is ordered and monotonic in reputation', () => {
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].level).toBe(RANKS[i - 1].level + 1);
      expect(RANKS[i].reputationNeeded).toBeGreaterThan(RANKS[i - 1].reputationNeeded);
      expect(RANKS[i].maxPartTier).toBeGreaterThanOrEqual(RANKS[i - 1].maxPartTier);
    }
  });

  it('rank-from-reputation is deterministic and monotonic', () => {
    let prev = -1;
    for (let rep = 0; rep <= 60; rep++) {
      const r = rankForReputation(rep);
      expect(r.level).toBe(rankForReputation(rep).level);
      expect(r.level).toBeGreaterThanOrEqual(prev);
      prev = r.level;
    }
    expect(rankForReputation(0).level).toBe(0);
    expect(rankForReputation(10_000).level).toBe(RANKS[RANKS.length - 1].level);
  });

  it('rank thresholds are exact (promotion lands on the boundary)', () => {
    for (const r of RANKS) {
      expect(rankForReputation(r.reputationNeeded).level).toBe(r.level);
      if (r.reputationNeeded > 0) {
        expect(rankForReputation(r.reputationNeeded - 1).level).toBe(r.level - 1);
      }
    }
  });

  it('progress-to-next is well-formed', () => {
    const p = rankProgress(RANKS[1].reputationNeeded + 1);
    expect(p.rank.level).toBe(1);
    expect(p.next?.level).toBe(2);
    expect(p.fraction).toBeGreaterThan(0);
    expect(p.fraction).toBeLessThan(1);
    expect(p.toNext).toBe(RANKS[2].reputationNeeded - RANKS[1].reputationNeeded - 1);
    const max = rankProgress(10_000);
    expect(max.next).toBeNull();
    expect(max.fraction).toBe(1);
  });

  it('gates part tiers by rank', () => {
    expect(canPurchaseTier(0, 1)).toBe(true);
    expect(canPurchaseTier(0, 2)).toBe(false);
    expect(canPurchaseTier(RANKS[RANKS.length - 1].level, 4)).toBe(true);
    expect(rankNeededForTier(4).level).toBeGreaterThan(rankNeededForTier(2).level);
  });

  it('every contract tier is acceptable at some rank', () => {
    const top = RANKS[RANKS.length - 1].level;
    for (const t of CONTRACT_TIERS) {
      expect(t.rankRequired).toBeLessThanOrEqual(top);
    }
  });
});

describe('one-way missions & save migration', () => {
  it('the mission-kind set is exactly orbit + land', () => {
    expect(Object.keys(MISSION_LABELS).sort()).toEqual(['land', 'orbit']);
  });

  it('old saves with return kinds migrate to their one-way equivalents', () => {
    const saved = {
      launchBodyId: 'earth',
      destinationId: 'moon',
      mission: { kind: 'orbit-return', orbitKm: 150 },
      launch: { heading: 5, power: 0.9 },
      nodes: [{ id: 'n1', trigger: { type: 'at-altitude', value: 10 }, actions: { heading: 45 } }],
    };
    const plan = migrateStoredPlan(saved as never);
    expect(plan.mission?.kind).toBe('orbit');
    expect(plan.mission?.orbitKm).toBe(150);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.launch.heading).toBe(5);

    const landReturn = migrateStoredPlan({
      ...saved, mission: { kind: 'land-return', orbitKm: 80 },
    } as never);
    expect(landReturn.mission?.kind).toBe('land');
  });

  it('unknown kinds and malformed payloads fall back safely', () => {
    const weird = migrateStoredPlan({
      launchBodyId: 'earth', destinationId: 'moon',
      mission: { kind: 'sightsee', orbitKm: 100 },
      launch: { heading: 0, power: 1 }, nodes: [],
    } as never);
    expect(weird.mission?.kind).toBe('orbit');
    const empty = migrateStoredPlan({} as never);
    expect(empty.mission?.kind).toBe('orbit'); // the default plan
  });

  it('legacy after-touchdown + ascend nodes still migrate to the relaunch button', () => {
    const plan = migrateStoredPlan({
      launchBodyId: 'earth', destinationId: 'moon',
      launch: { heading: 0, power: 1 },
      nodes: [{ id: 'n1', trigger: { type: 'after-touchdown', value: 5 }, actions: { ascend: true } }],
    } as never);
    expect(plan.nodes[0].trigger.type).toBe('on-manual-relaunch');
    expect(plan.nodes[0].trigger.value).toBeUndefined();
  });
});
