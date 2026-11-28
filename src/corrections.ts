/**
 * Course codes fixed by cross-checking the official timetables (see
 * import/reconcile.ts), applied to saved timetables when they load, so a
 * timetable imported before a fix gets it without importing again.
 *
 * The list is written by `npm run preprocess-fjfi` to
 * src/import/shared-corrections.json (not committed) and bundled at build
 * time; without it, nothing changes.
 */
import type { Lesson } from './model';

export interface CodeCorrection {
  day: number;
  start: number;
  duration: number;
  lecturer: string;
  room: string;
  /** The code as OCR misread it, e.g. "D". */
  from: string;
  /** The code the other timetables agree on, e.g. "DIM1". */
  to: string;
}

const lecturerKey = (text: string) => text.trim().toLowerCase();
const roomKey = (text: string) => text.replace(/\s+/g, '').toLowerCase();
const keyOf = (c: Pick<CodeCorrection, 'day' | 'start' | 'duration' | 'lecturer' | 'room' | 'from'>) =>
  [c.day, c.start, c.duration, lecturerKey(c.lecturer), roomKey(c.room), c.from.trim()].join('|');

/** Validates the generated list; anything malformed is dropped. */
export function parseCorrections(data: unknown): CodeCorrection[] {
  const list = data && typeof data === 'object' ? (data as { corrections?: unknown }).corrections : undefined;
  if (!Array.isArray(list)) return [];
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
  const text = (v: unknown) => typeof v === 'string' && v.length <= 80;
  return list.filter((c): c is CodeCorrection => !!c && typeof c === 'object'
    && int(c.day) && int(c.start) && int(c.duration) && text(c.lecturer) && text(c.room) && text(c.from)
    && typeof c.to === 'string' && /^[\p{L}\p{N}._]{1,80}$/u.test(c.to));
}

const generated = import.meta.glob<unknown>('./import/shared-corrections.json', { eager: true, import: 'default' });
const SHARED_CORRECTIONS = parseCorrections(Object.values(generated)[0]);

/** Replaces misread codes on lessons that match a correction exactly (time, lecturer, room and the misread code). */
export function applyCorrections(lessons: Lesson[], corrections: readonly CodeCorrection[] = SHARED_CORRECTIONS): Lesson[] {
  if (!corrections.length) return lessons;
  const byKey = new Map(corrections.map((c) => [keyOf(c), c.to]));
  return lessons.map((lesson) => {
    if (!lesson.lecturer.trim() || !lesson.room.trim()) return lesson;
    const to = byKey.get(keyOf({ ...lesson, from: lesson.subject }));
    return to ? { ...lesson, subject: to } : lesson;
  });
}
