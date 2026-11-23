import { KNOWN_ROOMS, KNOWN_TEACHERS } from './known-names';
import { normalizeLecturerInitials } from '../lecturer';

/** Lower-case and strip diacritics: "Petříčková" → "petrickova". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Edit distance (insertions, deletions, substitutions). */
export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * The single candidate within `maxEdits` of `text` (compared folded), or
 * null when there is none or several are equally close.
 */
export function closest(text: string, candidates: readonly string[], maxEdits: number): string | null {
  const key = fold(text);
  let best: string | null = null;
  let bestDistance = Infinity;
  let tie = false;
  for (const candidate of candidates) {
    const d = levenshtein(key, fold(candidate));
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
      tie = false;
    } else if (d === bestDistance && fold(candidate) !== fold(best!)) {
      tie = true;
    }
  }
  return best !== null && bestDistance <= maxEdits && !tie ? best : null;
}

/** How many misread letters a name of this length may have. */
function allowedEdits(length: number): number {
  if (length < 4) return 0;
  if (length < 7) return 1;
  return 2;
}

/** Teachers' surnames ("Jex Igor" → "Jex", "Novotný P." → "Novotný"). */
const SURNAMES = [...new Set(KNOWN_TEACHERS.map((t) => t.split(' ')[0]!))];

/**
 * Replaces a misread surname with the closest known teacher's surname, with
 * its proper diacritics ("Petrases" → "Petrásek", "Bree" → "Břeň").
 * Distinct initials are kept; a repeated trailing copy of the leading
 * initial is removed. Unknown or ambiguous surnames are left as read.
 */
export function snapLecturer(text: string, surnames: readonly string[] = SURNAMES): string {
  const words = text.split(/\s+/).filter(Boolean);
  // The surname is the longest word; the others are initials ("I. Jex").
  let index = -1;
  for (let i = 0; i < words.length; i++) {
    if (/^\p{L}{2,}$/u.test(words[i]!) && (index < 0 || words[i]!.length > words[index]!.length)) index = i;
  }
  if (index < 0) return normalizeLecturerInitials(text);
  const match = closest(words[index]!, surnames, allowedEdits(words[index]!.length));
  if (!match) return normalizeLecturerInitials(text);
  words[index] = match;
  return normalizeLecturerInitials(words.join(' '));
}

/**
 * Replaces a misread room code with the known one at most one character
 * away ("Dc-P4" from "DC-P4", "KLFF-121" from "KLFF-12l"). Codes like T-201
 * and T-204 differ by one digit, so ambiguous readings are left as read.
 */
export function snapRoom(text: string, rooms: readonly string[] = KNOWN_ROOMS): string {
  if (!text) return text;
  return closest(text, rooms, text.length < 4 ? 0 : 1) ?? text;
}
