# Todos

Outstanding work on the flight/guidance engine, captured after the test-suite +
hardening pass. The deterministic Vitest suite (`npm test`) is the source of
truth; reproduce any flight by pasting a dev-mode **Copy Log** (build + plan +
system + final state + full event timeline) into a scenario.

## Known-failing flights (highest priority)

From the representative "land on / depart from every solid world" sample
(`test/representative.test.ts`). Landing on all 8 solid worlds passes; 5/8
departures pass. The three below are marked `it.todo` with their root causes:

- [ ] **Mercury → Earth (depart):** Mercury orbits fast and its Hohmann
  perihelion sits on its own lane, so the escape arc loops back through Mercury's
  SOI and it recaptures the craft → crash on Mercury.
- [ ] **Venus → Earth (depart):** the heliocentric cruise over-burns (apoapsis
  ran to ~59,000,000 km), then perihelion collapses into the Sun → burns up.
- [ ] **Titan → Earth (depart):** reaches Earth but the long-range final descent
  comes in too fast and crashes on the Earth landing.

Likely-related cells not re-verified since the last full matrix run
(`npm run test:matrix`), worth re-checking and folding in:

- [ ] Interplanetary **planet returns** (orbit-return / land-return to Mars,
  Venus, Ceres, Saturn): the inward return leg historically dives sunward or
  overshoots. Some were improved by the return-leg gate + deeper reentry
  periapsis; confirm which still fail.
- [ ] **Moon → Earth land-return** specifically: the Moon tangles the Earth
  *capture* on the way out, leaving a too-fast descent. (One-way Moon→Earth land
  and orbit-return both pass.)

## Root cause & proposed fix (do this before more point-fixes)

The interplanetary transfer/capture guidance is a web of interacting heuristics:
point-fixes for the cases above each regressed the working set this session
(Sun-floor, heliocentric phase-window injection, launch-planet avoidance were all
tried and reverted). The durable fix is a **principled cruise-guidance pass**, not
another patch:

- [ ] **Impulsive Lambert injection + ballistic coast.** Solve Lambert once from
  clean Sun-space (clear of the launch world's SOI), burn to that velocity, then
  COAST — no per-step re-burning. Re-solve only as a bounded mid-course trim.
  This removes the continuous-burn energy pumping behind both the Venus
  over-burn and the inner-transfer Sun dives.
- [ ] **Sun-radius perihelion floor (narrow).** Only engage when heliocentric
  perihelion drops below ~2× the Sun's radius (far under any target lane, so
  legitimate transfers never trip it). The earlier attempt used a lane-relative
  floor that fired during normal transfers — keep it Sun-radius-only.
- [ ] **Launch-world re-encounter avoidance, gated correctly.** Dodging the
  launch planet fixed Mercury but broke Earth→Mars/Mercury because Earth's large
  SOI keeps the craft "near Earth" mid-cruise. Gate on "left the SOI by N radii,
  now re-closing" rather than raw proximity, and validate against Earth-origin
  transfers.
- [ ] **Long-range descent margin.** Far returns (Titan→Earth) arrive low on
  fuel; ensure capture leaves a survivable orbit and the descent commits to
  braking early (the lander now deploys as a last resort on small airless worlds;
  extend the same robustness to fast atmospheric reentries).

## Test-suite follow-ups

- [ ] Drive the **full 290-cell matrix** (`npm run test:matrix`) to a known state
  and record the exact pass/fail list; promote the green cells, mark the rest
  `it.todo` with reasons (mirror `representative.test.ts`).
- [ ] Consider a faster default `npm test` (the fast career + robustness +
  representative suites) with the heavy full matrix behind `test:matrix`, so CI
  stays quick while the sweep remains available.

## Notes / smaller items

- [ ] `cannon-es` was removed; no rigid-body engine is used — physics is
  analytic Keplerian + patched conics by design. Re-confirm before anyone is
  tempted to add a physics engine for orbits (it would not help).
- [ ] Mercury landing is marginal (a low orbit is ~286 m/s and there's little
  altitude to brake); the last-resort lander deploy makes it land, but the
  descent profile for tiny near-Sun worlds could be made gentler.
