import { describe, expect, it } from 'vitest';
import { applyCorrections, parseCorrections } from '../src/corrections';
import { normalizeLesson } from '../src/model';

describe('applyCorrections', () => {
  const corrections = parseCorrections({
    version: 1,
    corrections: [
      { day: 2, start: 14, duration: 2, lecturer: 'Masáková', room: 'T-101', from: 'D', to: 'DIM1' },
      { day: 2, start: 10, duration: 2, lecturer: 'Mihóková', room: 'T-204', from: '4', to: 'ZFP' },
      { day: 'x', start: 10, duration: 2, lecturer: 'X', room: 'T-1', from: 'A', to: 'B' },
      { day: 1, start: 10, duration: 2, lecturer: 'X', room: 'T-1', from: 'A', to: '<b>' },
    ],
  });

  it('drops malformed entries from the generated list', () => {
    expect(corrections.map((c) => c.to)).toEqual(['DIM1', 'ZFP']);
    expect(parseCorrections(undefined)).toEqual([]);
    expect(parseCorrections({ corrections: 'nope' })).toEqual([]);
  });

  it('fixes a saved lesson only when its time, lecturer, room and misread code all match', () => {
    const saved = (subject: string, day = 2, start = 14, lecturer = 'Masáková', room = 'T-101') =>
      normalizeLesson({ id: `${subject}-${day}-${start}-${lecturer}-${room}`, day, start, duration: 2, subject, lecturer, room, color: 'green' });
    const lessons = [saved('D'), saved('D', 3), saved('D', 2, 14, 'Kůs'), saved('D', 2, 14, 'Masáková', 'T-201'), saved('DIM1'), saved('4', 2, 10, ' mihóková', 't-204')];
    expect(applyCorrections(lessons, corrections).map((l) => l.subject)).toEqual(['DIM1', 'D', 'D', 'D', 'DIM1', 'ZFP']);
    expect(applyCorrections(lessons, [])).toBe(lessons);
  });
});
