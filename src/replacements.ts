/**
 * "Nahradit hodinu": a student who has to miss a lesson looks for the same
 * course (the very same code) in every other official timetable and sees
 * which of those lessons fall into their free time.
 */
import type { Lesson, LessonDraft } from './model';

/** One official timetable to search, e.g. "Bc1JCF2". */
export interface CatalogTimetable {
  /** Official ID, e.g. "Bc1JCF2". */
  id: string;
  /** Program abbreviation and kruh, without the year, e.g. "JCF2". */
  short: string;
  /** Full name, e.g. "1. ročník Bc. – Jaderná a částicová fyzika, 2. kruh". */
  label: string;
  lessons: readonly LessonDraft[];
}

export interface ReplacementSource {
  id: string;
  short: string;
  label: string;
}

/** A lesson of the same course in other timetables, merged when several timetables share it. */
export interface ReplacementOption {
  /** Stable key of the merged lesson (time, room, lecturer). */
  key: string;
  day: number;
  start: number;
  duration: number;
  subject: string;
  room: string;
  lecturer: string;
  color: string;
  /** Timetables this lesson appears in, in catalogue order. */
  sources: ReplacementSource[];
  /** The student's own lessons it overlaps (the skipped one included); empty means free. */
  clashes: Lesson[];
}

/**
 * Course code used for matching: the same code, ignoring spaces and letter
 * case (OCR may read "MAN1cv" as "MAN1 cv"). Rooms and lecturers may differ.
 */
export function subjectKey(subject: string): string {
  return subject.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

type Slot = Pick<LessonDraft, 'day' | 'start' | 'duration'>;

export function overlaps(a: Slot, b: Slot): boolean {
  return a.day === b.day && a.start < b.start + b.duration && b.start < a.start + a.duration;
}

const sameSlot = (a: Slot, b: Slot) => a.day === b.day && a.start === b.start && a.duration === b.duration;

/**
 * Finds every lesson of `skipped`'s course in `catalog`, merged across
 * timetables and sorted by day and time. The skipped lesson's own time does
 * not count as free (the student can't be there), and lessons the student
 * already has at that exact time are left out.
 */
export function findReplacements(own: readonly Lesson[], skipped: Lesson, catalog: readonly CatalogTimetable[]): ReplacementOption[] {
  const key = subjectKey(skipped.subject);
  if (!key) return [];
  const mine = own.filter((l) => subjectKey(l.subject) === key);
  const merged = new Map<string, ReplacementOption>();
  for (const timetable of catalog) {
    for (const lesson of timetable.lessons) {
      if (subjectKey(lesson.subject) !== key || mine.some((l) => sameSlot(l, lesson))) continue;
      const id = [lesson.day, lesson.start, lesson.duration, lesson.room.trim().toLowerCase(), lesson.lecturer.trim().toLowerCase()].join('|');
      let option = merged.get(id);
      if (!option) {
        option = {
          key: id,
          day: lesson.day,
          start: lesson.start,
          duration: lesson.duration,
          subject: lesson.subject,
          room: lesson.room,
          lecturer: lesson.lecturer,
          color: lesson.color,
          sources: [],
          clashes: own.filter((l) => overlaps(l, lesson)),
        };
        merged.set(id, option);
      }
      if (!option.sources.some((s) => s.id === timetable.id)) option.sources.push({ id: timetable.id, short: timetable.short, label: timetable.label });
    }
  }
  return [...merged.values()].sort((a, b) => a.day - b.day || a.start - b.start || a.duration - b.duration || a.key.localeCompare(b.key));
}

/** "JCF1, FI_IPL": the timetables an option comes from, by abbreviation (years merged). */
export function sourceNames(option: ReplacementOption): string {
  return [...new Set(option.sources.map((s) => s.short))].join(', ');
}
