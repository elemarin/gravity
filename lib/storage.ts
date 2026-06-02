import { RocketBuild, DEFAULT_BUILD } from './game/types';

const BUILD_KEY    = 'gravity:build';
const MILESTONES_KEY = 'gravity:milestones';
const UNLOCKS_KEY  = 'gravity:unlocks';

const isClient = typeof window !== 'undefined';

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
}
