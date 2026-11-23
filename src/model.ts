import { DAYS, DEFAULT_COLOR_ID, FIRST_HOUR, LAST_HOUR, PALETTE, canonicalSpecId } from './config';
import { normalizeLecturerInitials } from './lecturer';

export interface Lesson {
  id: string;
  /** 0 = Monday … 4 = Friday. */
  day: number;
  /** Whole hour the lesson starts at (FIRST_HOUR … LAST_HOUR - 1). */
  start: number;
  /** Length in whole hours. */
  duration: number;
  subject: string;
  room: string;
  lecturer: string;
  color: string;
}

export interface Schedule {
  id: string;
  /** User's name for the timetable, e.g. "ZS 2026" (may be empty). */
  name: string;
  /** Program and kruh as shown on the timetable, e.g. "JCF1" (see canonicalSpecId). */
  specId: string;
  lessons: Lesson[];
  updatedAt: number;
}

export type LessonDraft = Omit<Lesson, 'id'>;

const MAX_TEXT = 80;

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';
}

/** Longest duration a lesson starting at `start` may have. */
export function maxDuration(start: number): number {
  return LAST_HOUR - start;
}

/**
 * Coerces arbitrary input into a valid lesson: integer day, a start on a
 * whole hour inside the grid, and a duration that keeps it inside the grid.
 */
export function normalizeLesson(input: Partial<Lesson> & Record<string, unknown>): Lesson {
  const day = clampInt(input.day, 0, DAYS.length - 1, 0);
  const start = clampInt(input.start, FIRST_HOUR, LAST_HOUR - 1, FIRST_HOUR);
  const duration = clampInt(input.duration, 1, maxDuration(start), 1);
  const color = PALETTE.some((c) => c.id === input.color) ? (input.color as string) : DEFAULT_COLOR_ID;
  return {
    id: typeof input.id === 'string' && input.id ? input.id : newId(),
    day,
    start,
    duration,
    subject: cleanText(input.subject),
    room: cleanText(input.room),
    lecturer: normalizeLecturerInitials(cleanText(input.lecturer)),
    color,
  };
}

export function createSchedule(specId = '', name = ''): Schedule {
  return { id: newId(), name: cleanText(name), specId: canonicalSpecId(cleanText(specId)), lessons: [], updatedAt: Date.now() };
}

/** Name shown for a schedule: its own name, else its ID, else "Rozvrh N". */
export function scheduleLabel(schedule: Schedule, index: number): string {
  return schedule.name || schedule.specId || `Rozvrh ${index + 1}`;
}

/** Validates untrusted data (storage, imports) into a schedule, or returns null. */
export function normalizeSchedule(input: unknown): Schedule | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const lessons = Array.isArray(raw.lessons)
    ? raw.lessons
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
        .map((l) => normalizeLesson(l))
    : [];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name: cleanText(raw.name),
    // Also migrates older IDs that carried the year ("Bc1JCF1" → "JCF1").
    specId: canonicalSpecId(cleanText(raw.specId)),
    lessons,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

export interface PlacedLesson {
  lesson: Lesson;
  /** Lane index inside its overlap group. */
  lane: number;
  /** Number of lanes in its overlap group. */
  lanes: number;
}

/**
 * Lays out one day's lessons so overlapping ones (e.g. parallel exercises)
 * are stacked into lanes, like the official timetable does.
 */
export function layoutDay(lessons: readonly Lesson[]): PlacedLesson[] {
  const sorted = [...lessons].sort((a, b) => a.start - b.start || b.duration - a.duration);
  const result: PlacedLesson[] = [];
  let group: PlacedLesson[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    for (const p of group) p.lanes = laneEnds.length;
    result.push(...group);
    group = [];
    laneEnds = [];
  };

  for (const lesson of sorted) {
    const end = lesson.start + lesson.duration;
    if (lesson.start >= groupEnd) {
      flush();
      groupEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= lesson.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    groupEnd = Math.max(groupEnd, end);
    group.push({ lesson, lane, lanes: 1 });
  }
  flush();
  return result;
}

/** Hours (FIRST_HOUR-based) offered as lesson start times. */
export function startHours(): number[] {
  const hours: number[] = [];
  for (let h = FIRST_HOUR; h < LAST_HOUR; h++) hours.push(h);
  return hours;
}

export function formatHour(hour: number): string {
  return `${hour}:00`;
}
