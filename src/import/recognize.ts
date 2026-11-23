import { normalizeLesson, type Lesson } from '../model';
import { PALETTE } from '../config';
import { courseMatcher, type CourseMatcher } from './courses';
import { detectBlocks, detectGeometry, specIdRect, splitMetaStrip } from './fjfi';
import { dominantColor, inkBounds, prepareForOcr, type Raster, type Rect } from './raster';
import { snapLecturer, snapRoom } from './snap';

export type TextKind = 'title' | 'lecturer' | 'room' | 'spec';

export interface OcrResult {
  text: string;
  /** 0–100, as reported by the OCR engine. */
  confidence: number;
}

/** Reads one line of text from a prepared (dark on white) image. */
export interface OcrEngine {
  read(image: Raster, kind: TextKind): Promise<OcrResult>;
}

export interface Recognized {
  /** Text from the top-left corner, e.g. "JCF1" or "FI_FPTF". */
  specText: string;
  lessons: Lesson[];
}

/**
 * Zoom applied to text crops (relative to the 800 px official PNG). Small
 * print is read at three zooms, too. Bold titles are read at several zooms because no
 * single zoom reads every title correctly; the reading most zooms agree on
 * wins, otherwise the most confident one.
 */
const META_SCALES = [3, 4, 6];
const TITLE_SCALES = [2, 3, 4, 6];

/** Chooses among readings of the same text: majority first, then confidence. */
export function pickReading(readings: OcrResult[]): string {
  const tally = new Map<string, { count: number; confidence: number }>();
  for (const { text, confidence } of readings) {
    const key = text.trim();
    if (!key) continue;
    const t = tally.get(key) ?? { count: 0, confidence: 0 };
    tally.set(key, { count: t.count + 1, confidence: t.confidence + confidence });
  }
  let best = '';
  let bestScore = [-1, -1];
  for (const [text, { count, confidence }] of tally) {
    // A single reading is ranked by its own confidence; agreement beats it.
    const score = [count >= 2 ? count : 1, count >= 2 ? confidence / count : confidence];
    if (score[0]! > bestScore[0]! || (score[0] === bestScore[0] && score[1]! > bestScore[1]!)) {
      best = text;
      bestScore = score;
    }
  }
  return best;
}

/** Let nearby readings agree on a known course without overriding a valid winner. */
export function pickCourseReading(readings: OcrResult[], department?: string, matcher: CourseMatcher = courseMatcher): string {
  const winner = pickReading(readings);
  if (matcher.isKnown(winner)) return winner;
  return pickReading(readings.map((reading) => ({ ...reading, text: matcher.snap(reading.text, department) })));
}

/** Cleans OCR output for a subject code such as "MAN.rez", "JAZ.3" or "LALcv". */
export function cleanTitle(text: string): string {
  const t = text.replace(/\s+/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.)]+$/gu, '');
  // Exercise codes end in "cv" (cvičení), which OCR often misreads.
  return t.replace(/^([A-Za-z0-9.]{2,})(?:[ceoa][vVyYwW]|i[eE][wW]|CV|CY)$/, '$1cv');
}

/** Cleans OCR output for a lecturer name; "--" means none. */
export function cleanLecturer(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim().replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, '');
  return /^[-–—.]*$/.test(t) ? '' : t;
}

/** Cleans OCR output for a room such as "B-103" or "KLFF-121"; "--" means none. */
export function cleanRoom(text: string): string {
  let t = text.replace(/\s+/g, '').replace(/[—–]/g, '-').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (/^[-.]*$/.test(t)) return '';
  t = t.toUpperCase();
  // FJFI buildings are letters (B-103, T-201, KLFF-121); small print often
  // reads "B" as "8" and "T" as "1", "7" or "I".
  return t.replace(/^8(?=-)/, 'B').replace(/^[17I](?=-)/, 'T');
}

/**
 * Turns an official FJFI timetable image into lessons. Returns null when the
 * image is not recognised as one.
 */
export async function recognizeOfficial(
  r: Raster,
  engine: OcrEngine,
  onProgress?: (done: number, total: number) => void,
): Promise<Recognized | null> {
  const g = detectGeometry(r);
  if (!g) return null;
  const blocks = detectBlocks(r, g);
  if (blocks.length === 0) return null;
  const read = async (rect: Rect | null, kind: TextKind, scales: number[] = META_SCALES, department?: string): Promise<string> => {
    if (!rect || rect.w < 2 || rect.h < 2) return '';
    const text = inkBounds(r, rect, Math.max(1, g.s));
    if (!text) return '';
    // The background comes from the whole area; the tight crop is mostly text.
    const bg = dominantColor(r, rect);
    // Lecturers and rooms are snapped to the official lists before voting,
    // so near-misses at different zooms agree on the same name.
    const clean = {
      title: cleanTitle,
      spec: cleanTitle,
      lecturer: (t: string) => snapLecturer(cleanLecturer(t)),
      room: (t: string) => snapRoom(cleanRoom(t)),
    }[kind];
    const readings: OcrResult[] = [];
    for (const scale of scales) {
      const result = await engine.read(prepareForOcr(r, text, scale / g.s, bg), kind);
      readings.push({ text: clean(result.text), confidence: result.confidence });
    }
    return kind === 'title' ? pickCourseReading(readings, department) : pickReading(readings);
  };

  const total = blocks.length + 1;
  let done = 0;
  const specText = cleanTitle(await read(specIdRect(g), 'spec', TITLE_SCALES));
  onProgress?.(++done, total);

  const lessons: Lesson[] = [];
  for (const b of blocks) {
    const parts = splitMetaStrip(r, b.metaRect, g.s);
    const [subject, lecturer, room] = [
      cleanTitle(await read(b.titleRect, 'title', TITLE_SCALES, PALETTE.find((color) => color.id === b.color)?.code)),
      await read(parts.lecturer, 'lecturer'),
      await read(parts.room, 'room'),
    ];
    lessons.push(normalizeLesson({ day: b.day, start: b.start, duration: b.duration, color: b.color, subject, lecturer, room }));
    onProgress?.(++done, total);
  }
  return { specText, lessons };
}
