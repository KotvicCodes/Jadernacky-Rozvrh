import { describe, expect, it } from 'vitest';
import { FIRST_HOUR, KRUH_OPTIONS, LAST_HOUR, PALETTE, PROGRAMS, canonicalSpecId, formatSpecId, parseSpecId } from '../src/config';
import { createSchedule, layoutDay, maxDuration, normalizeLesson, normalizeSchedule, scheduleLabel, type Lesson } from '../src/model';

const lesson = (id: string, start: number, duration: number, day = 0): Lesson => ({
  id,
  day,
  start,
  duration,
  subject: id,
  room: '',
  lecturer: '',
  color: 'green',
});

describe('normalizeLesson', () => {
  it('forces lessons to start on a whole hour', () => {
    expect(normalizeLesson({ start: 12.5, duration: 2 }).start).toBe(12);
    expect(normalizeLesson({ start: '10' as unknown as number }).start).toBe(10);
  });

  it('keeps the start inside the visible grid', () => {
    expect(normalizeLesson({ start: 3 }).start).toBe(FIRST_HOUR);
    expect(normalizeLesson({ start: 23 }).start).toBe(LAST_HOUR - 1);
    expect(normalizeLesson({ start: Number.NaN }).start).toBe(FIRST_HOUR);
  });

  it('clamps the duration so the lesson ends by the last hour', () => {
    expect(normalizeLesson({ start: 18, duration: 5 }).duration).toBe(2);
    expect(normalizeLesson({ start: 9, duration: 0 }).duration).toBe(1);
    expect(normalizeLesson({ start: 9, duration: 2.9 }).duration).toBe(2);
    expect(maxDuration(19)).toBe(1);
  });

  it('falls back to a palette colour and trims text', () => {
    const l = normalizeLesson({ color: 'hotpink', subject: '  MAN  ', room: 'x'.repeat(200) });
    expect(PALETTE.some((c) => c.id === l.color)).toBe(true);
    expect(l.subject).toBe('MAN');
    expect(l.room).toHaveLength(80);
  });

  it('clamps the day to Monday–Friday', () => {
    expect(normalizeLesson({ day: 7 }).day).toBe(4);
    expect(normalizeLesson({ day: -1 }).day).toBe(0);
  });

  it('normalizes duplicate lecturer initials for all lesson views without dropping distinct initials', () => {
    expect(normalizeLesson({ lecturer: ' P. Novotný P. ' }).lecturer).toBe('P. Novotný');
    expect(normalizeLesson({ lecturer: 'P. Novotný P P' }).lecturer).toBe('P. Novotný');
    expect(normalizeLesson({ lecturer: 'P. J. Novotný' }).lecturer).toBe('P. J. Novotný');
    expect(normalizeLesson({ lecturer: 'P. Novotný J.' }).lecturer).toBe('P. Novotný J.');
    expect(normalizeLesson({ lecturer: 'Novotný P.' }).lecturer).toBe('Novotný P.');
    expect(normalizeLesson({ lecturer: 'P. J. P' }).lecturer).toBe('P. J. P');
    expect(normalizeLesson({ lecturer: 'Pavel Novotný P' }).lecturer).toBe('Pavel Novotný P');
  });
});

describe('normalizeSchedule', () => {
  it('rejects non-objects and repairs lessons', () => {
    expect(normalizeSchedule(null)).toBeNull();
    expect(normalizeSchedule('x')).toBeNull();
    const s = normalizeSchedule({ specId: 'Bc1JCF1', lessons: [{ start: 10.5, duration: 1 }, 'junk', null] });
    expect(s?.specId).toBe('JCF1'); // year dropped, as on the official timetable
    expect(s?.lessons).toHaveLength(1);
    expect(s?.lessons[0]?.start).toBe(10);
  });
});

describe('schedule names', () => {
  it('keeps a trimmed name and labels unnamed schedules by ID or position', () => {
    expect(normalizeSchedule({ name: '  ZS 2026 ', lessons: [] })?.name).toBe('ZS 2026');
    expect(normalizeSchedule({ lessons: [] })?.name).toBe('');
    expect(scheduleLabel(createSchedule('JCF1', 'LS 2027'), 0)).toBe('LS 2027');
    expect(scheduleLabel(createSchedule('JCF1'), 0)).toBe('JCF1');
    expect(scheduleLabel(createSchedule(), 2)).toBe('Rozvrh 3');
  });
});

describe('program and kruh IDs', () => {
  it('lists programs alphabetically, with valid codes', () => {
    const names = PROGRAMS.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'cs')));
    for (const p of PROGRAMS) {
      expect(p.code).toMatch(/^[A-Z_]+$/);
      expect(p.name).not.toMatch(/kruh|ročník/i);
    }
  });

  it('offers the same kruhy for every program, including none', () => {
    expect(KRUH_OPTIONS).toEqual([null, 1, 2, 3]);
  });

  it('parses official, short and kruh-less IDs', () => {
    expect(parseSpecId('Bc1JCF2')).toMatchObject({ program: { code: 'JCF' }, group: 2 });
    expect(parseSpecId('jcf3')).toMatchObject({ program: { code: 'JCF' }, group: 3 });
    expect(parseSpecId('FI_IPL')).toMatchObject({ program: { code: 'FI_IPL' }, group: null });
    expect(parseSpecId('Bc2FI_IPL1')).toMatchObject({ program: { code: 'FI_IPL' }, group: 1 });
    // Kruh counts are not hardcoded per program.
    expect(parseSpecId('RT2')).toMatchObject({ program: { code: 'RT' }, group: 2 });
    expect(parseSpecId('JI_JR4')).toMatchObject({ program: { code: 'JI_JR' }, group: 4 });
    expect(parseSpecId('JCF0')).toBeNull();
    expect(parseSpecId('FI')).toBeNull();
    expect(parseSpecId('')).toBeNull();
  });

  it('formats the ID like the official timetable corner', () => {
    const jcf = PROGRAMS.find((p) => p.code === 'JCF')!;
    const ipl = PROGRAMS.find((p) => p.code === 'FI_IPL')!;
    expect(formatSpecId(jcf, 1)).toBe('JCF1');
    expect(formatSpecId(jcf, null)).toBe('JCF');
    expect(formatSpecId(ipl, null)).toBe('FI_IPL');
    expect(formatSpecId(ipl, 2)).toBe('FI_IPL2');
    expect(canonicalSpecId('Bc1JI_JR4')).toBe('JI_JR4');
    expect(canonicalSpecId('FI_IPL')).toBe('FI_IPL');
    expect(canonicalSpecId(' vlastní ')).toBe('vlastní');
  });
});

describe('layoutDay', () => {
  it('keeps non-overlapping lessons in a single lane', () => {
    const placed = layoutDay([lesson('a', 8, 2), lesson('b', 10, 2)]);
    expect(placed.map((p) => [p.lesson.id, p.lane, p.lanes])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
    ]);
  });

  it('stacks parallel lessons into lanes', () => {
    const placed = layoutDay([lesson('a', 14, 2), lesson('b', 14, 2), lesson('c', 16, 2)]);
    const byId = Object.fromEntries(placed.map((p) => [p.lesson.id, p]));
    expect(byId.a?.lanes).toBe(2);
    expect(byId.b?.lanes).toBe(2);
    expect(new Set([byId.a?.lane, byId.b?.lane])).toEqual(new Set([0, 1]));
    expect(byId.c?.lanes).toBe(1);
  });

  it('reuses freed lanes inside one overlap group', () => {
    const placed = layoutDay([lesson('long', 8, 4), lesson('x', 8, 1), lesson('y', 9, 1)]);
    const byId = Object.fromEntries(placed.map((p) => [p.lesson.id, p]));
    expect(byId.long?.lanes).toBe(2);
    expect(byId.x?.lane).toBe(byId.y?.lane);
  });
});

describe('palette', () => {
  it('has one colour per FJFI department, with unique abbreviations and code prefixes', () => {
    expect(PALETTE.map((c) => c.dept)).toEqual(['KM', 'KF', 'KHVJ', 'KIPL', 'KLFF', 'KMAT', 'KJCH', 'KDAIZ', 'KJR', 'KSI']);
    expect(new Set(PALETTE.map((c) => c.code)).size).toBe(PALETTE.length);
    expect(new Set(PALETTE.map((c) => c.id)).size).toBe(PALETTE.length);
  });
});
