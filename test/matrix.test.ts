/**
 * Full origin × destination flight matrix.
 *
 * For every solid launch world, to every other body, for every mission kind the
 * game allows, fly the real auto-plan on the rocket a player would actually take
 * and assert the mechanic works: a launch reaches and holds orbit, a landing
 * sets down intact, a return trip comes home. Δv-infeasible cells (no rocket in
 * the catalogue can carry the budget) are skipped, not failed — that is content
 * balance, not a physics bug.
 */
import { describe, it } from 'vitest';
import { bodyDef, destinationTargetId } from '../lib/game/bodies';
import {
  SOLID_BODY_IDS, destinationsFrom, kindsFor, pickBuild, runScenario,
  assertOrbit, assertLanding, assertReached,
} from './harness';

for (const launchId of SOLID_BODY_IDS) {
  describe(`launch from ${bodyDef(launchId).name}`, () => {
    for (const destId of destinationsFrom(launchId)) {
      const targetId = destinationTargetId(destId, launchId);
      for (const kind of kindsFor(launchId, destId)) {
        const { feasible, id: buildId } = pickBuild(launchId, destId, kind);
        const name = `${destId} · ${kind} [${buildId}]`;
        const test = feasible ? it : it.skip;

        test(name, () => {
          const r = runScenario({ launchId, destId, kind });
          switch (kind) {
            case 'orbit':
              // Orbit the target (transfer) or the launch world itself.
              assertOrbit(r, targetId ?? launchId);
              break;
            case 'land':
              // Land on the target (transfer) or back on the launch world.
              assertLanding(r, targetId ?? launchId);
              break;
            case 'orbit-return':
            case 'land-return':
              // Must visit the target, then come home and land intact.
              if (targetId) assertReached(r, targetId);
              assertLanding(r, launchId);
              break;
          }
        });
      }
    }
  });
}
