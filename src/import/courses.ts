import { KNOWN_COURSES } from './known-courses';
import { levenshtein } from './snap';

export interface CourseMatcher {
  isKnown(text: string, department?: string): boolean;
  snap(text: string, department?: string): string;
  /** A known code as the catalogue writes it ("DiM1cv" → "DIM1cv"); other text unchanged. */
  canonical(text: string): string;
}

interface CourseTitle {
  base: string;
  suffix: string;
}

/** Visual OCR confusions, never a digit-to-different-digit substitution. */
const GLYPHS: Readonly<Record<string, string>> = {
  '0': 'O', O: '0',
  '1': 'IL', I: '1L', L: '1I',
  '5': 'S', S: '58',
  '8': 'BS', B: '8',
};

function glyphDistance(read: string, code: string): number {
  if (read.length < 3 || read.length !== code.length) return Infinity;
  let edits = 0;
  for (let i = 0; i < read.length; i++) {
    if (read[i] === code[i]) continue;
    if (!GLYPHS[read[i]!]?.includes(code[i]!) || ++edits > 2) return Infinity;
  }
  return edits;
}

/** Index by department once, instead of searching the whole catalogue per OCR pass. */
export function createCourseMatcher(codes: readonly string[]): CourseMatcher {
  const all = new Set<string>();
  const fullCodes = new Set<string>();
  const departments = new Map<string, Set<string>>();
  for (const code of codes) {
    const parts = /^(\d{2})([A-Z][A-Z0-9_]*)$/.exec(code);
    if (!parts) continue;
    const department = parts[1]!;
    const alias = parts[2]!;
    fullCodes.add(code);
    all.add(alias);
    if (!departments.has(department)) departments.set(department, new Set());
    departments.get(department)!.add(alias);
  }
  const split = (text: string): CourseTitle => {
    // A real code ending in CV takes priority over interpreting CV as a suffix.
    if (all.has(text.toUpperCase()) || fullCodes.has(text.toUpperCase())) return { base: text.toUpperCase(), suffix: '' };
    const match = /^(.*?)(\.?cv|\.rez)$/i.exec(text);
    return match
      ? { base: match[1]!.toUpperCase(), suffix: match[2]!.toLowerCase() }
      : { base: text.toUpperCase(), suffix: '' };
  };
  const isKnown = (text: string, department?: string): boolean => {
    const { base } = split(text);
    if (fullCodes.has(base)) return department === undefined || base.startsWith(department);
    return (department === undefined ? all : departments.get(department))?.has(base) ?? false;
  };
  return {
    isKnown,
    canonical(text) {
      if (!isKnown(text)) return text;
      const { base, suffix } = split(text);
      return base + suffix;
    },
    snap(text, department) {
      const { base, suffix } = split(text);
      // Never redirect a valid course, even if its colour was misdetected.
      if (all.has(base) || fullCodes.has(base)) return base + suffix;
      const candidates = department === undefined ? undefined : departments.get(department);
      if (!candidates || !/^[A-Z][A-Z0-9_]*$/.test(base)) return text;
      // Ordinary edits preserve numbers and separators. A separate visual
      // check can restore SOS1 from S081 or CH1 from CHI, without ever
      // changing a numeric variant such as MAN2 into MAN3.
      const structure = base.replace(/[A-Z]/g, '');
      let best: string | null = null;
      let distance = Infinity;
      let tied = false;
      for (const code of candidates) {
        let score = glyphDistance(base, code);
        if (base.length >= 4 && code.length >= 4 && Math.abs(base.length - code.length) <= 1 && code.replace(/[A-Z]/g, '') === structure) {
          const letters = levenshtein(base, code);
          if (letters <= 1) score = Math.min(score, letters);
        }
        if (!Number.isFinite(score)) continue;
        if (score < distance) {
          best = code;
          distance = score;
          tied = false;
        } else if (score === distance) {
          tied = true;
        }
      }
      return best && !tied ? best + suffix : text;
    },
  };
}

export const courseMatcher = createCourseMatcher(KNOWN_COURSES);
