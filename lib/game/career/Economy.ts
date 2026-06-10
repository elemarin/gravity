/**
 * The money side of the career: part prices and purchase gating.
 *
 * Starter parts (unlockedByDefault) are free; everything else is bought with
 * contract money, priced by the part's `tier` and gated by career rank so the
 * catalog unlocks gradually instead of all at once.
 */

import { RocketPart } from './Parts';
import { canPurchaseTier, rankNeededForTier, Rank } from './Rank';

/** Sticker price per part tier (tier 0 parts are the free starters). */
export const PART_TIER_PRICES = [0, 2000, 6000, 14000, 30000] as const;

export function partTier(part: RocketPart): number {
  return part.tier ?? 1;
}

export function partPrice(part: RocketPart): number {
  if (part.unlockedByDefault) return 0;
  const tier = Math.max(0, Math.min(partTier(part), PART_TIER_PRICES.length - 1));
  // A tier-0 part that isn't a default starter still costs the tier-1 price.
  return PART_TIER_PRICES[tier] || PART_TIER_PRICES[1];
}

export type PurchaseCheck =
  | { ok: true; price: number }
  | { ok: false; price: number; reason: 'rank' | 'funds'; rankNeeded?: Rank };

/** Can a part be bought right now, and if not, why (for lock labels). */
export function checkPurchase(part: RocketPart, money: number, rankLevel: number): PurchaseCheck {
  const price = partPrice(part);
  if (!canPurchaseTier(rankLevel, partTier(part))) {
    return { ok: false, price, reason: 'rank', rankNeeded: rankNeededForTier(partTier(part)) };
  }
  if (money < price) return { ok: false, price, reason: 'funds' };
  return { ok: true, price };
}

/** Format money for UI — short, loud, tabular-friendly. */
export function fmtMoney(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}
