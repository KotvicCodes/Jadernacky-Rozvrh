import { FIRST_HOUR, LAST_HOUR, PALETTE } from '../config';
import type { LessonDraft } from '../model';

export interface OfficialTimetable {
  version: 1;
  id: string;
  specId: string;
  lessons: LessonDraft[];
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 80;

/** Validate generated data strictly: malformed data must not become a partial timetable. */
export function parseOfficialTimetable(value: unknown, expectedId: string): OfficialTimetable {
  const fail = (): never => { throw new Error('Neplatná data rozvrhu z webu FJFI.'); };
  if (!object(value) || value.version !== 1 || value.id !== expectedId || !text(value.specId) || !value.specId.trim()
    || !Array.isArray(value.lessons) || !value.lessons.length || value.lessons.length > 500) return fail();
  const lessons = value.lessons.map((lesson): LessonDraft => {
    if (!object(lesson)) return fail();
    const { day, start, duration, subject, lecturer, room, color } = lesson;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 4
      || typeof start !== 'number' || !Number.isInteger(start) || start < FIRST_HOUR
      || typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 || start + duration > LAST_HOUR
      || !text(subject) || !text(lecturer) || !text(room) || typeof color !== 'string' || !PALETTE.some((p) => p.id === color)) return fail();
    return { day, start, duration, subject, lecturer, room, color };
  });
  if (!lessons.some((lesson) => lesson.subject.trim())) return fail();
  return { version: 1, id: expectedId, specId: value.specId, lessons };
}
