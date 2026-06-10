import { RocketBuild, DEFAULT_BUILD } from './game/types';
import { FlightPlan, MissionKind, DEFAULT_PLAN, clonePlan } from './game/plan/FlightPlan';
import { Contract } from './game/career/Contracts';

const BUILD_KEY    = 'gravity:build';
const MILESTONES_KEY = 'gravity:milestones';
const UNLOCKS_KEY  = 'gravity:unlocks';
const PLAN_KEY     = 'gravity:plan';
const FACILITY_KEY = 'gravity:facility';
const BASES_KEY    = 'gravity:bases';
const GOALS_KEY    = 'gravity:goals';
const DEV_MODE_KEY = 'gravity:devMode';
const MONEY_KEY    = 'gravity:money';
const REPUTATION_KEY = 'gravity:reputation';
const ACTIVE_CONTRACT_KEY = 'gravity:activeContract';
const CONTRACTS_DONE_KEY  = 'gravity:contractsDone';

const isClient = typeof window !== 'undefined';

function loadStringArray(key: string, fallback: string[]): string[] {
  if (!isClient) return [...fallback];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...fallback];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [...fallback];
  } catch { return [...fallback]; }
}

function saveStringArray(key: string, ids: string[]) {
  if (!isClient) return;
  localStorage.setItem(key, JSON.stringify(Array.from(new Set(ids))));
}

/** Launch-facility tier (0-based). Higher tiers lift heavier rockets. */
export function loadFacilityLevel(): number {
  if (!isClient) return 0;
  const n = Number(localStorage.getItem(FACILITY_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
export function saveFacilityLevel(level: number) {
  if (!isClient) return;
  localStorage.setItem(FACILITY_KEY, String(Math.max(0, Math.floor(level))));
}

/** Body ids the player can launch from (bases). Earth is always available. */
export function loadBases(): string[] {
  const bases = loadStringArray(BASES_KEY, ['earth']);
  return bases.includes('earth') ? bases : ['earth', ...bases];
}
export function addBase(id: string) {
  saveStringArray(BASES_KEY, [...loadBases(), id]);
}

/** Completed campaign goal ids (Moon landing, ISS, bases, Mars, …). */
export function loadGoals(): string[] { return loadStringArray(GOALS_KEY, []); }
export function addGoal(id: string) { saveStringArray(GOALS_KEY, [...loadGoals(), id]); }

export function loadBuild(): RocketBuild {
  if (!isClient) return DEFAULT_BUILD;
  try {
    const raw = localStorage.getItem(BUILD_KEY);
    if (!raw) return DEFAULT_BUILD;
    const parsed = JSON.parse(raw) as RocketBuild;
    if (!parsed?.engineId || !Array.isArray(parsed.tankIds) || !parsed.noseId) return DEFAULT_BUILD;
    const merged = { ...DEFAULT_BUILD, ...parsed, utilityIds: parsed.utilityIds ?? [] };
    // Migrate older single-stage saves and reject malformed stage entries.
    const validStages = Array.isArray(merged.stages)
      ? merged.stages.filter(
          (st) => st && typeof st.engineId === 'string' && Array.isArray(st.tankIds))
      : [];
    merged.stages = validStages.length > 0
      ? validStages
      : [{ engineId: merged.engineId, tankIds: merged.tankIds }];
    return merged;
  } catch {
    return DEFAULT_BUILD;
  }
}

export function saveBuild(build: RocketBuild) {
  if (!isClient) return;
  localStorage.setItem(BUILD_KEY, JSON.stringify(build));
}

export function loadCompletedMilestones(): string[] {
  if (!isClient) return [];
  try {
    const raw = localStorage.getItem(MILESTONES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

export function saveCompletedMilestones(ids: string[]) {
  if (!isClient) return;
  localStorage.setItem(MILESTONES_KEY, JSON.stringify(ids));
}

export function addCompletedMilestone(id: string) {
  const ids = loadCompletedMilestones();
  if (!ids.includes(id)) {
    ids.push(id);
    saveCompletedMilestones(ids);
  }
}

export function loadUnlockedParts(): string[] {
  if (!isClient) return [];
  try {
    const raw = localStorage.getItem(UNLOCKS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

export function saveUnlockedParts(ids: string[]) {
  if (!isClient) return;
  localStorage.setItem(UNLOCKS_KEY, JSON.stringify(ids));
}

export function addUnlockedParts(ids: string[]) {
  const existing = new Set(loadUnlockedParts());
  ids.forEach((id) => existing.add(id));
  saveUnlockedParts(Array.from(existing));
}

export function resetProgress() {
  if (!isClient) return;
  localStorage.removeItem(BUILD_KEY);
  localStorage.removeItem(MILESTONES_KEY);
  localStorage.removeItem(UNLOCKS_KEY);
  localStorage.removeItem(PLAN_KEY);
  localStorage.removeItem(FACILITY_KEY);
  localStorage.removeItem(BASES_KEY);
  localStorage.removeItem(GOALS_KEY);
  localStorage.removeItem(MONEY_KEY);
  localStorage.removeItem(REPUTATION_KEY);
  localStorage.removeItem(ACTIVE_CONTRACT_KEY);
  localStorage.removeItem(CONTRACTS_DONE_KEY);
}

// ── Money & reputation (the contract economy) ───────────────────────────────

function loadNonNegativeInt(key: string): number {
  if (!isClient) return 0;
  const n = Number(localStorage.getItem(key));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Agency funds. Earned from contracts, spent on parts and facility upgrades. */
export function loadMoney(): number { return loadNonNegativeInt(MONEY_KEY); }
export function saveMoney(amount: number) {
  if (!isClient) return;
  localStorage.setItem(MONEY_KEY, String(Math.max(0, Math.round(amount))));
}
export function addMoney(amount: number) { saveMoney(loadMoney() + amount); }
/** Spend funds; returns false (and spends nothing) when short. */
export function spendMoney(amount: number): boolean {
  const have = loadMoney();
  if (have < amount) return false;
  saveMoney(have - amount);
  return true;
}

/** Career reputation. Drives the rank ladder (see career/Rank.ts). */
export function loadReputation(): number { return loadNonNegativeInt(REPUTATION_KEY); }
export function saveReputation(rep: number) {
  if (!isClient) return;
  localStorage.setItem(REPUTATION_KEY, String(Math.max(0, Math.round(rep))));
}
export function addReputation(rep: number) { saveReputation(loadReputation() + rep); }

// ── Contracts ────────────────────────────────────────────────────────────────

/** The accepted contract being flown, or null. Stored whole so a daily board
 *  rolling over at midnight can't orphan an in-progress job. */
export function loadActiveContract(): Contract | null {
  if (!isClient) return null;
  try {
    const raw = localStorage.getItem(ACTIVE_CONTRACT_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Contract;
    return c && typeof c.id === 'string' && typeof c.destinationId === 'string' &&
      (c.missionKind === 'orbit' || c.missionKind === 'land')
      ? c : null;
  } catch { return null; }
}
export function saveActiveContract(contract: Contract | null) {
  if (!isClient) return;
  if (contract) localStorage.setItem(ACTIVE_CONTRACT_KEY, JSON.stringify(contract));
  else localStorage.removeItem(ACTIVE_CONTRACT_KEY);
}

/** Completed contract ids (daily ids embed their date, so they never collide). */
export function loadCompletedContracts(): string[] {
  return loadStringArray(CONTRACTS_DONE_KEY, []);
}
export function addCompletedContract(id: string) {
  saveStringArray(CONTRACTS_DONE_KEY, [...loadCompletedContracts(), id]);
}

// ── Dev mode ─────────────────────────────────────────────────────────────────

export function loadDevMode(): boolean {
  if (!isClient) return false;
  return localStorage.getItem(DEV_MODE_KEY) === '1';
}

export function saveDevMode(on: boolean) {
  if (!isClient) return;
  if (on) localStorage.setItem(DEV_MODE_KEY, '1');
  else localStorage.removeItem(DEV_MODE_KEY);
}

/** Coerce legacy round-trip kinds — return missions no longer exist. */
function migrateMissionKind(kind: string): MissionKind {
  if (kind === 'orbit-return') return 'orbit';
  if (kind === 'land-return') return 'land';
  return kind === 'land' ? 'land' : 'orbit';
}

/**
 * Pure migrator from a persisted (possibly legacy) plan payload to a valid
 * FlightPlan. Exported so the save-migration rules are unit-testable.
 */
export function migrateStoredPlan(parsed: Partial<FlightPlan> & { scenarioId?: string }): FlightPlan {
  if (!parsed?.launch || !Array.isArray(parsed.nodes)) return clonePlan(DEFAULT_PLAN);
  // Migrate legacy scenarioId → launch body + destination.
  const legacyDest = parsed.scenarioId === 'moon-transfer' ? 'moon' : 'orbit';
  const mission = parsed.mission && typeof parsed.mission.kind === 'string'
    ? {
        kind: migrateMissionKind(parsed.mission.kind),
        orbitKm: Number.isFinite(parsed.mission.orbitKm) ? parsed.mission.orbitKm : 120,
      }
    : undefined;
  return {
      launchBodyId: typeof parsed.launchBodyId === 'string' ? parsed.launchBodyId : 'earth',
    destinationId: typeof parsed.destinationId === 'string' ? parsed.destinationId : legacyDest,
    mission,
    launch: {
      heading: Number.isFinite(parsed.launch.heading) ? parsed.launch.heading : 0,
      power:   Number.isFinite(parsed.launch.power) ? parsed.launch.power : 1,
    },
    nodes: parsed.nodes
      .filter((n) => n && n.trigger && n.actions && typeof n.id === 'string')
      .map((n) => {
        const trigger = { ...n.trigger };
        const actions = { ...n.actions };
        // Migrate: after-touchdown + ascend → on-manual-relaunch (player button).
        if (trigger.type === 'after-touchdown' && actions.ascend) {
          trigger.type = 'on-manual-relaunch';
          delete trigger.value;
        }
        return { id: n.id, trigger, actions };
      }),
  };
}

export function loadPlan(): FlightPlan {
  if (!isClient) return clonePlan(DEFAULT_PLAN);
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return clonePlan(DEFAULT_PLAN);
    return migrateStoredPlan(JSON.parse(raw));
  } catch {
    return clonePlan(DEFAULT_PLAN);
  }
}

export function savePlan(plan: FlightPlan) {
  if (!isClient) return;
  localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
}
