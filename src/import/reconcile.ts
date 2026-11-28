/**
 * Cross-checks course codes between official timetables. A lecture shared by
 * several programs is printed identically in each of their timetables, but
 * OCR reads each copy separately and can misread one of them ("D" for DIM1).
 * When a reading is not a known course and the same lesson (same time,
 * lecturer and room) elsewhere has exactly one known code, that code is used.
 */
import type { LessonDraft } from '../model';
import { courseMatcher, type CourseMatcher } from './courses';

export interface SharedTimetable {
  id: string;
  lessons: LessonDraft[];
}

export interface SharedCorrection {
  id: string;
  day: number;
  start: number;
  from: string;
  to: string;
}

/** Same lesson: same time, lecturer and room. Lessons without a lecturer or room are never matched. */
function lessonKey(lesson: LessonDraft): string | null {
  const lecturer = lesson.lecturer.trim().toLowerCase();
  const room = lesson.room.replace(/\s+/g, '').toLowerCase();
  return lecturer && room ? [lesson.day, lesson.start, lesson.duration, lecturer, room].join('|') : null;
}

/** "cv" for exercises, "rez" for reservations, "" for lectures, as the catalogue writes them. */
function kindOf(subject: string): string {
  return /cv$/.test(subject) ? 'cv' : /\.rez$/i.test(subject) ? 'rez' : '';
}

export function reconcileSharedLessons<T extends SharedTimetable>(
  timetables: readonly T[],
  matcher: CourseMatcher = courseMatcher,
): { timetables: T[]; corrections: SharedCorrection[] } {
  const known = new Map<string, Set<string>>();
  for (const timetable of timetables) {
    for (const lesson of timetable.lessons) {
      const key = lessonKey(lesson);
      if (!key || !matcher.isKnown(lesson.subject)) continue;
      let codes = known.get(key);
      if (!codes) known.set(key, (codes = new Set()));
      codes.add(matcher.canonical(lesson.subject));
    }
  }
  const corrections: SharedCorrection[] = [];
  const result = timetables.map((timetable) => ({
    ...timetable,
    lessons: timetable.lessons.map((lesson) => {
      const key = lessonKey(lesson);
      const codes = key ? known.get(key) : undefined;
      if (!codes || matcher.isKnown(lesson.subject)) return lesson;
      // A lecture and its exercise can share a slot; keep to the reading's kind when they do.
      let candidates = [...codes];
      if (candidates.length > 1) candidates = candidates.filter((code) => kindOf(code) === kindOf(lesson.subject));
      if (candidates.length !== 1) return lesson;
      corrections.push({ id: timetable.id, day: lesson.day, start: lesson.start, from: lesson.subject, to: candidates[0]! });
      return { ...lesson, subject: candidates[0]! };
    }),
  }));
  return { timetables: result, corrections };
}
