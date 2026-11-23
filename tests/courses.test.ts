import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCourseCatalogue } from '../scripts/fjfi-metadata.mjs';
import { createCourseMatcher } from '../src/import/courses';
import { cleanTitle, pickCourseReading, type OcrResult } from '../src/import/recognize';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/fjfi-courses.html'), 'utf8');
// Actual Tesseract.js 7 English readings of the reported blocks, rendered from
// the official PDFs at the app's 3200px width on 2026-11-23. No network in CI.
const reported = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/fjfi-course-ocr.json'), 'utf8')) as Array<{
  id: string;
  department: string;
  expected: string;
  readings: OcrResult[];
}>;

describe('official course dictionary', () => {
  it('takes unique regular courses offered in the catalogue academic year', () => {
    expect(parseCourseCatalogue(html)).toEqual({ academicYear: '2026/2027', codes: ['01MAN', '01MAN2', '02MECH'] });
  });

  it('uses the source academic year, rather than the machine date or a hardcoded semester', () => {
    expect(parseCourseCatalogue(html.replaceAll('2026/2027', '2027/2028').replaceAll('B261', 'B271').replaceAll('B262', 'B272')).codes)
      .toEqual(['01MAN', '01MAN2', '02MECH']);
  });

  it('rejects empty, missing or redesigned catalogue data instead of erasing the dictionary', () => {
    expect(() => parseCourseCatalogue('<html>Unavailable</html>')).toThrow(/academic year/);
    expect(() => parseCourseCatalogue(html.replace('seznam.predmetu', 'new-table'))).toThrow(/course table/);
    expect(() => parseCourseCatalogue(html.replace('Vypsán v&nbsp;semestru', 'New heading'))).toThrow(/columns/);
    expect(() => parseCourseCatalogue(html.replaceAll('B261', 'B251').replaceAll('B262', 'B252'))).toThrow(/No currently offered courses/);
    expect(() => parseCourseCatalogue(html.replace('<td>Mechanika</td>', ''))).toThrow(/row/);
  });
});

describe('conservative course matching', () => {
  const matcher = createCourseMatcher(['01MAN', '01MAN2', '01LAL', '02MECH', '12MECL', '11SPLA', '01TEST', '01TESTCV']);

  it.each([
    ['MECN', '02', 'MECH'],
    ['MECNcv', '02', 'MECHcv'],
    ['MECN.CV', '02', 'MECH.cv'],
    ['MECN.rez', '02', 'MECH.rez'],
    ['MAM2', '01', 'MAN2'],
    ['MECHcv', '02', 'MECHcv'],
    ['MAN', '01', 'MAN'],
    ['MAN2', '01', 'MAN2'],
    ['TESTCV', '01', 'TESTCV'],
    ['02MECH', '02', '02MECH'],
  ])('matches %s within department %s as %s', (text, department, expected) => {
    expect(matcher.snap(text, department)).toBe(expected);
  });

  it.each([
    ['MAM', '01'], // Short codes are too easy to confuse.
    ['MAN3', '01'], // Do not change a numeric course variant.
    ['MAN22', '01'],
    ['MECN', '01'], // No matching code in the detected department.
    ['MECN', '99'], // Unknown department.
    ['MECL', '02'], // Valid course in a different department: keep it.
    ['JAZ.2', '04'], // Generic timetable labels absent from the catalogue.
    ['MECN.extra', '02'], // Do not guess unknown suffixes.
    ['Unknown', '02'],
  ])('leaves uncertain reading %s unchanged', (text, department) => {
    expect(matcher.snap(text, department)).toBe(text);
  });

  it('does not search all departments when the colour is unknown', () => {
    expect(matcher.snap('MECN')).toBe('MECN');
  });

  it('refuses equally close course candidates', () => {
    const ambiguous = createCourseMatcher(['02MECH', '02MECL']);
    expect(ambiguous.snap('MECQcv', '02')).toBe('MECQcv');
  });

  it('corrects the real S081 and CHicv misreads using unique visual matches', () => {
    const actual = createCourseMatcher(['01SOS1', '01SOS2', '15CH1', '15CH2']);
    expect(actual.snap('S081', '01')).toBe('SOS1');
    expect(actual.snap('CHicv', '15')).toBe('CH1cv');
    expect(actual.snap('S082', '01')).toBe('SOS2');
    expect(actual.snap('CHicv', '01')).toBe('CHicv');
    expect(actual.snap('SOS2', '01')).toBe('SOS2');
    expect(actual.snap('CH3cv', '15')).toBe('CH3cv');
  });

  it('refuses ambiguous or excessive glyph substitutions and preserves valid codes', () => {
    const actual = createCourseMatcher(['01SOS1', '01SOB1', '01SOS2', '15CH1', '15CHI']);
    expect(actual.snap('S081', '01')).toBe('S081'); // SOS1 and SOB1 tie.
    expect(actual.snap('S08I', '01')).toBe('S08I'); // Three glyph substitutions.
    expect(actual.snap('CHicv', '15')).toBe('CHIcv'); // CHI is valid in this dictionary.
  });

  it('recognizes aliases, full codes and exercise/reservation suffixes', () => {
    expect(matcher.isKnown('MANcv', '01')).toBe(true);
    expect(matcher.isKnown('MAN.rez')).toBe(true);
    expect(matcher.isKnown('01MAN', '01')).toBe(true);
    expect(matcher.isKnown('01MAN', '02')).toBe(false);
    expect(matcher.isKnown('MAM2')).toBe(false);
  });

  it('lets several nearby OCR readings agree on the known course', () => {
    expect(pickCourseReading([
      { text: 'MECNcv', confidence: 94 },
      { text: 'MEGHcv', confidence: 91 },
      { text: 'MECHcv', confidence: 85 },
      { text: 'noise', confidence: 30 },
    ], '02', matcher)).toBe('MECHcv');
  });

  it('preserves a valid winning reading even when other passes resemble a different course', () => {
    expect(pickCourseReading([
      { text: 'MECL', confidence: 99 },
      { text: 'MECN', confidence: 90 },
      { text: 'MEGH', confidence: 85 },
      { text: 'MECH', confidence: 70 },
    ], '02', matcher)).toBe('MECL');
  });

  it.each(reported)('recovers $expected from the actual $id OCR readings', ({ department, expected, readings }) => {
    const actual = createCourseMatcher(['01SOS1', '01SOS2', '15CH1', '15CH2', '01FANA1', '01FAN2', '01FAN3', '18MAK1', '18MAK2']);
    const cleaned = readings.map((reading) => ({ ...reading, text: cleanTitle(reading.text) }));
    expect(pickCourseReading(cleaned, department, actual)).toBe(expected);
  });
});
