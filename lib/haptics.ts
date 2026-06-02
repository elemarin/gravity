/**
 * Tiny haptics wrapper over the Vibration API. Mobile-first: fires short
 * pulses for flight events. Degrades silently where unsupported (notably
 * iOS Safari, which does not implement navigator.vibrate).
 */

let enabled = true;

function canVibrate(): boolean {
  return enabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function setHapticsEnabled(on: boolean) {
  enabled = on;
  if (!on && canVibrate()) navigator.vibrate(0);
}

export function isHapticsEnabled(): boolean {
  return enabled;
}

function buzz(pattern: number | number[]) {
  if (!canVibrate()) return;
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

/** Engine ignition / start of a burn. */
export function hapticThrust() { buzz(18); }

/** Stage separation — a sharp double tap. */
export function hapticStage() { buzz([12, 24, 12]); }

/** Lander deployment. */
export function hapticDeploy() { buzz([10, 18, 10, 18, 10]); }

/** Soft touchdown. */
export function hapticLanding() { buzz([20, 40, 60]); }

/** Crash — a long heavy buzz. */
export function hapticCrash() { buzz([60, 30, 120]); }

/** Light UI confirmation (button / node added). */
export function hapticTick() { buzz(8); }

/** Stop any ongoing vibration. */
export function hapticStop() { if (canVibrate()) navigator.vibrate(0); }
