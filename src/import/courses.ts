import { KNOWN_COURSES } from './known-courses';
import { closest } from './snap';

export interface CourseMatcher {
  isKnown(text: string, department?: string): boolean;
  snap(text: string, department?: string): string;
}

interface CourseTitle {
  base: string;
  suffix: string;
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
    snap(text, department) {
      const { base, suffix } = split(text);
      // Never redirect a valid course, even if its colour was misdetected.
      if (all.has(base) || fullCodes.has(base)) return base + suffix;
      const candidates = department === undefined ? undefined : departments.get(department);
      if (!candidates || base.length < 4 || !/^[A-Z][A-Z0-9_]*$/.test(base)) return text;
      // Preserve numbers and separators. MAN, MAN2 and MAN3 are distinct
      // courses, not spelling variants. Only one letter edit is allowed.
      const structure = base.replace(/[A-Z]/g, '');
      const eligible = [...candidates].filter((code) => code.length >= 4 && code.replace(/[A-Z]/g, '') === structure);
      const match = closest(base, eligible, 1);
      return match ? match + suffix : text;
    },
  };
}

export const courseMatcher = createCourseMatcher(KNOWN_COURSES);
