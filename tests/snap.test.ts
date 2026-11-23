import { describe, expect, it } from 'vitest';
import { closest, fold, levenshtein, snapLecturer, snapRoom } from '../src/import/snap';
import { KNOWN_ROOMS, KNOWN_TEACHERS } from '../src/import/known-names';

describe('helpers', () => {
  it('folds diacritics and case', () => {
    expect(fold('Petříčková')).toBe('petrickova');
  });

  it('computes edit distance', () => {
    expect(levenshtein('fuck', 'fucik')).toBe(1);
    expect(levenshtein('petrases', 'petrasek')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('refuses ties between different candidates', () => {
    expect(closest('T-200', ['T-201', 'T-204'], 1)).toBeNull();
    expect(closest('T-20l', ['T-201', 'T-301'], 1)).toBe('T-201');
  });
});

describe('snapLecturer', () => {
  // Real misreads from OCR of screenshots and published PNGs.
  it.each([
    ['Bree', 'Břeň'],
    ['Fuck', 'Fučík'],
    ['Heribar', 'Heriban'],
    ['Kinkovsky', 'Klinkovský'],
    ['Dreva', 'Dreval'],
    ['Petrases', 'Petrásek'],
    ['Babclcky', 'Babčický'],
    ['Stracnoa', 'Strachota'],
    ['Kovarowa', 'Kovářová'],
    ['Petrickova', 'Petříčková'],
  ])('%s → %s', (read, expected) => {
    expect(snapLecturer(read)).toBe(expected);
  });

  it('keeps initials, removes duplicate trailing initials and fixes the surname', () => {
    expect(snapLecturer('I. Jex')).toBe('I. Jex');
    expect(snapLecturer('P. Novotny P')).toBe('P. Novotný');
    expect(snapLecturer('P. Novotny P.')).toBe('P. Novotný');
    expect(snapLecturer('J. Novotny P')).toBe('J. Novotný P');
    expect(snapLecturer('Novotny P.')).toBe('Novotný P.');
    expect(snapLecturer('M. Sinor')).toBe('M. Šiňor');
  });

  it('leaves unknown, too-short or too-different names alone', () => {
    expect(snapLecturer('Wonderland')).toBe('Wonderland');
    expect(snapLecturer('cl')).toBe('cl');
    expect(snapLecturer('')).toBe('');
    expect(snapLecturer('Xyzab')).toBe('Xyzab');
  });
});

describe('snapRoom', () => {
  it('restores official spelling and fixes a single misread character', () => {
    expect(snapRoom('DC-P4')).toBe('Dc-P4');
    expect(snapRoom('KLFF-12l')).toBe('KLFF-121');
    expect(snapRoom('RUZNE')).toBe('různé');
    expect(snapRoom('B-103')).toBe('B-103');
  });

  it('does not guess between rooms that differ by one digit', () => {
    expect(snapRoom('T-200')).toBe('T-200');
    expect(snapRoom('T448')).toBe('T448');
  });
});

describe('known names', () => {
  it('were generated from the official site', () => {
    expect(KNOWN_TEACHERS.length).toBeGreaterThan(300);
    expect(KNOWN_TEACHERS).toContain('Strachota');
    expect(KNOWN_ROOMS).toEqual(expect.arrayContaining(['B-103', 'T-101', 'KLFF-121', 'Dc-P4']));
    expect(KNOWN_TEACHERS.some((t) => t.includes('(') || t.includes('▾'))).toBe(false);
  });
});
