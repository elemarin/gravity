/**
 * The career rank ladder. Rank is derived purely from persisted reputation
 * (earned by completing contracts and campaign goals), so it is deterministic
 * and needs no storage of its own. Rank gates which contract tiers can be
 * accepted and which part tiers can be purchased, pacing progression into a
 * gradual climb instead of an all-at-once unlock.
 */

export type Rank = {
  level: number;
  /** Short enough for a UI pill, silly enough to be a goal in itself. */
  title: string;
  /** Reputation required to hold this rank. */
  reputationNeeded: number;
  /** Highest part `tier` purchasable at this rank (tier 0 is free). */
  maxPartTier: number;
  /** What the promotion actually buys you, in plain words. */
  perk: string;
};

export const RANKS: Rank[] = [
  {
    level: 0, title: 'Pad Sweeper', reputationNeeded: 0, maxPartTier: 1,
    perk: 'Orbit-of-Earth contracts. Allowed to touch the small rockets.',
  },
  {
    level: 1, title: 'Junior Throttle Jockey', reputationNeeded: 3, maxPartTier: 2,
    perk: 'Moon contracts and tier-2 hardware. Business cards pending.',
  },
  {
    level: 2, title: 'Licensed Menace', reputationNeeded: 8, maxPartTier: 3,
    perk: 'Inner-planet contracts and tier-3 hardware. The license is real.',
  },
  {
    level: 3, title: 'Interplanetary Uber Driver', reputationNeeded: 16, maxPartTier: 4,
    perk: 'Belt and Jupiter contracts, tier-4 hardware. Tips not included.',
  },
  {
    level: 4, title: 'Admiral of Vibes', reputationNeeded: 28, maxPartTier: 4,
    perk: 'Outer-system contracts. The Sun reports to you now (it does not).',
  },
];

/** The rank held at `reputation` points (monotonic, clamps to the top rank). */
export function rankForReputation(reputation: number): Rank {
  let held = RANKS[0];
  for (const r of RANKS) {
    if (reputation >= r.reputationNeeded) held = r;
  }
  return held;
}

export function nextRank(level: number): Rank | null {
  return RANKS.find((r) => r.level === level + 1) ?? null;
}

/** Progress toward the next rank, for UI bars. `fraction` is 0..1 (1 at max). */
export function rankProgress(reputation: number): {
  rank: Rank; next: Rank | null; fraction: number; toNext: number;
} {
  const rank = rankForReputation(reputation);
  const next = nextRank(rank.level);
  if (!next) return { rank, next: null, fraction: 1, toNext: 0 };
  const span = next.reputationNeeded - rank.reputationNeeded;
  const into = reputation - rank.reputationNeeded;
  return {
    rank,
    next,
    fraction: Math.max(0, Math.min(1, span > 0 ? into / span : 1)),
    toNext: Math.max(0, next.reputationNeeded - reputation),
  };
}

/** Can a part of `partTier` be purchased at rank `level`? (tier 0 is free). */
export function canPurchaseTier(level: number, partTier: number): boolean {
  const rank = RANKS.find((r) => r.level === level) ?? RANKS[0];
  return partTier <= rank.maxPartTier;
}

/** The lowest rank allowed to buy a part of `partTier`, for lock labels. */
export function rankNeededForTier(partTier: number): Rank {
  return RANKS.find((r) => partTier <= r.maxPartTier) ?? RANKS[RANKS.length - 1];
}
