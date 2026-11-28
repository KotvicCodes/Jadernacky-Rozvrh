import { describe, expect, it } from 'vitest';
import { createCourseMatcher } from '../src/import/courses';
import { reconcileSharedLessons } from '../src/import/reconcile';
import { pickCourseReading } from '../src/import/recognize';
import type { LessonDraft } from '../src/model';

const matcher = createCourseMatcher(['01DIM1', '01DIM2', '01DIMA3', '02ZFP', '02SOP', '01ZEL1', '01ZELD']);
const lesson = (day: number, start: number, duration: number, subject: string, lecturer: string, room: string): LessonDraft =>
  ({ day, start, duration, subject, lecturer, room, color: 'green' });
const subjects = (result: ReturnType<typeof reconcileSharedLessons>) =>
  Object.fromEntries(result.timetables.map((t) => [t.id, t.lessons.map((l) => l.subject)]));

describe('reconcileSharedLessons', () => {
  it('takes DIM1 for the Bc1AIPV1 lecture OCR read as "D" from the other programs sharing it', () => {
    // Actual readings of the AIPV1 title at the four zooms: no two agree, so the most confident wins.
    expect(pickCourseReading([
      { text: 'D', confidence: 78 },
      { text: 'DIMM', confidence: 45 },
      { text: 'DIMA', confidence: 65 },
      { text: 'DIM', confidence: 27 },
    ], '01', matcher)).toBe('D');
    // The same lecture in other first-year timetables, where an exercise also shares the slot.
    const result = reconcileSharedLessons([
      { id: 'Bc1AIPV1', lessons: [lesson(2, 14, 2, 'D', 'Masáková', 'T-101'), lesson(2, 12, 2, 'DIM1cv', 'Pelantová', 'T-301')] },
      { id: 'Bc1AAA1', lessons: [lesson(2, 14, 2, 'DIM1', 'Masáková', 'T-101'), lesson(2, 14, 2, 'DIM1cv', 'Masáková', 'T-101')] },
      { id: 'Bc1MI_MM1', lessons: [lesson(2, 14, 2, 'DIM1', 'Masáková', 'T-101')] },
    ], matcher);
    expect(subjects(result)).toEqual({
      Bc1AIPV1: ['DIM1', 'DIM1cv'],
      Bc1AAA1: ['DIM1', 'DIM1cv'],
      Bc1MI_MM1: ['DIM1'],
    });
    expect(result.corrections).toEqual([
      { id: 'Bc1AIPV1', day: 2, start: 14, from: 'D', to: 'DIM1', lesson: lesson(2, 14, 2, 'D', 'Masáková', 'T-101') },
    ]);
  });

  it('fills unknown and empty readings, and keeps to exercises when the reading is one', () => {
    const result = reconcileSharedLessons([
      { id: 'a', lessons: [lesson(2, 10, 2, '4', 'Mihóková', 'T-204'), lesson(1, 10, 2, 'SOF', 'I. Richter', 'KLFF-121'), lesson(3, 8, 2, '', 'Kůs', 'T-201')] },
      { id: 'b', lessons: [lesson(2, 10, 2, 'ZFP', 'Mihóková', 't-204 '), lesson(1, 10, 2, 'SOP', 'I. Richter', 'KLFF-121'), lesson(3, 8, 2, 'DIM2', 'Kůs', 'T-201')] },
      { id: 'c', lessons: [lesson(0, 8, 2, 'DIMcv', 'Novák', 'T-105')] },
      { id: 'd', lessons: [lesson(0, 8, 2, 'DIM1', 'Novák', 'T-105'), lesson(0, 8, 2, 'DIM2cv', 'Novák', 'T-105')] },
    ], matcher);
    expect(subjects(result)).toEqual({ a: ['ZFP', 'SOP', 'DIM2'], b: ['ZFP', 'SOP', 'DIM2'], c: ['DIM2cv'], d: ['DIM1', 'DIM2cv'] });
  });

  it('never turns a reading that ends in cv or .rez into another kind', () => {
    const result = reconcileSharedLessons([
      { id: 'a', lessons: [lesson(0, 8, 2, 'DIMcv', 'Novák', 'T-105'), lesson(1, 8, 2, 'XYcv', 'Kůs', 'T-201'), lesson(2, 8, 2, 'QQ.rez', 'Kůs', 'T-201'), lesson(3, 8, 2, '', 'Kůs', 'T-201')] },
      { id: 'b', lessons: [lesson(0, 8, 2, 'DIM1', 'Novák', 'T-105'), lesson(1, 8, 2, 'DIM1cv', 'Kůs', 'T-201'), lesson(2, 8, 2, 'DIM1', 'Kůs', 'T-201'), lesson(3, 8, 2, 'DIM1cv', 'Kůs', 'T-201')] },
    ], matcher);
    // An exercise sharing its slot only with a lecture stays as read; a bare or empty reading takes the only code.
    expect(subjects(result)).toEqual({ a: ['DIMcv', 'DIM1cv', 'QQ.rez', 'DIM1cv'], b: ['DIM1', 'DIM1cv', 'DIM1', 'DIM1cv'] });
  });

  it('leaves valid readings, ambiguous slots and lessons without a lecturer or room alone', () => {
    const timetables = [
      // Both readings are valid courses: no way to tell which copy is wrong.
      { id: 'a', lessons: [lesson(2, 16, 3, 'ZELD', 'J. Pavel', 'T-201'), lesson(4, 8, 2, 'X', '', 'T-101'), lesson(4, 10, 2, 'Y', 'Kůs', '')] },
      { id: 'b', lessons: [lesson(2, 16, 3, 'ZEL1', 'J. Pavel', 'T-201'), lesson(4, 8, 2, 'DIM1', '', 'T-101'), lesson(4, 10, 2, 'DIM1', 'Kůs', '')] },
      // Two different lectures in the same slot: the unknown reading stays.
      { id: 'c', lessons: [lesson(1, 8, 2, 'Q', 'Novák', 'B-103')] },
      { id: 'd', lessons: [lesson(1, 8, 2, 'DIM1', 'Novák', 'B-103')] },
      { id: 'e', lessons: [lesson(1, 8, 2, 'ZFP', 'Novák', 'B-103')] },
      // A different time, lecturer or room is a different lesson.
      { id: 'f', lessons: [lesson(0, 9, 2, 'D', 'Masáková', 'T-101'), lesson(0, 8, 3, 'D', 'Masáková', 'T-101'), lesson(0, 8, 2, 'D', 'Masáková', 'T-201')] },
      { id: 'g', lessons: [lesson(0, 8, 2, 'DIM1', 'Masáková', 'T-101')] },
    ];
    const result = reconcileSharedLessons(timetables, matcher);
    expect(result.corrections).toEqual([]);
    expect(result.timetables).toEqual(timetables);
  });
});
