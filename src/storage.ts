import { applyCorrections } from './corrections';
import { createSchedule, normalizeSchedule, type Schedule } from './model';

const STORAGE_KEY = 'jaderka-rozvrh:v1';

export interface AppState {
  schedules: Schedule[];
  activeId: string;
}

export function initialState(): AppState {
  const schedule = createSchedule();
  return { schedules: [schedule], activeId: schedule.id };
}

/** Parses stored state, dropping anything malformed. */
export function parseState(raw: string | null): AppState {
  if (!raw) return initialState();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return initialState();
  }
  if (!data || typeof data !== 'object') return initialState();
  const obj = data as Record<string, unknown>;
  const schedules = Array.isArray(obj.schedules)
    ? obj.schedules.map(normalizeSchedule).filter((s): s is Schedule => s !== null)
      // Codes misread in earlier official data are fixed when saved timetables load.
      .map((s) => ({ ...s, lessons: applyCorrections(s.lessons) }))
    : [];
  if (schedules.length === 0) return initialState();
  const activeId =
    typeof obj.activeId === 'string' && schedules.some((s) => s.id === obj.activeId)
      ? obj.activeId
      : schedules[0]!.id;
  return { schedules, activeId };
}

export function loadState(storage: Storage | undefined = safeStorage()): AppState {
  if (!storage) return initialState();
  try {
    return parseState(storage.getItem(STORAGE_KEY));
  } catch {
    return initialState();
  }
}

/** Persists state; returns false when the browser refuses (private mode, quota). */
export function saveState(state: AppState, storage: Storage | undefined = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
