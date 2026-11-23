import { describe, expect, it } from 'vitest';
import { parseOfficialTimetable } from '../src/import/official-data';

const lesson = { day: 0, start: 8, duration: 2, subject: 'MAN.rez', lecturer: '', room: '', color: 'green' };
const data = () => ({ version: 1, id: 'Bc1JCF1', specId: 'JCF1', lessons: [{ ...lesson }] });

describe('preprocessed official timetable validation', () => {
  it('preserves empty teacher/room fields and removes persistent IDs', () => {
    const input = { ...data(), lessons: [{ ...lesson, id: 'shared-id' }] };
    expect(parseOfficialTimetable(input, input.id).lessons).toEqual([lesson]);
  });

  it.each([
    { version: 2 }, { id: 'Bc1JCF2' }, { specId: '' }, { lessons: [] },
    { lessons: [null] }, { lessons: [{ ...lesson, subject: '' }] },
    { lessons: [{ ...lesson, day: 5 }] }, { lessons: [{ ...lesson, start: 7 }] },
    { lessons: [{ ...lesson, start: 19, duration: 2 }] },
    { lessons: [{ ...lesson, duration: 1.5 }] }, { lessons: [{ ...lesson, color: 'bogus' }] },
    { lessons: [{ ...lesson, room: null }] }, { lessons: [{ ...lesson, subject: 'X'.repeat(81) }] },
  ])('rejects malformed or mismatched data: %j', (change) => {
    expect(() => parseOfficialTimetable({ ...data(), ...change }, 'Bc1JCF1')).toThrow();
  });

  it('rejects the whole timetable when a later lesson is invalid', () => {
    expect(() => parseOfficialTimetable({ ...data(), lessons: [lesson, { ...lesson, day: -1 }] }, 'Bc1JCF1')).toThrow();
  });
});
