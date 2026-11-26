import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { EMBED_KEY, encodePayload } from '../src/embed';
import { detectBlocks, detectGeometry, splitMetaStrip, type DetectedBlock } from '../src/import/fjfi';
import { guessSpecId, readEmbeddedSchedule } from '../src/import';
import type { Raster } from '../src/import/raster';
import { cleanLecturer, cleanRoom, cleanTitle, pickReading, recognizeOfficial, type OcrEngine } from '../src/import/recognize';
import { createSchedule, normalizeLesson } from '../src/model';
import { buildPdf } from '../src/pdf';
import { addTextChunk } from '../src/png';

function fixture(name: string): Raster {
  const png = PNG.sync.read(readFileSync(join(process.cwd(), 'tests/fixtures', `${name}.png`)));
  return { width: png.width, height: png.height, data: png.data };
}

/** Nearest-neighbour rescale plus white padding, like a zoomed screenshot. */
function screenshot(src: Raster, factor: number, padX: number, padY: number): Raster {
  const width = Math.round(src.width * factor) + 2 * padX;
  const height = Math.round(src.height * factor) + 2 * padY;
  const data = new Uint8Array(width * height * 4).fill(255);
  for (let y = padY; y < height - padY; y++) {
    for (let x = padX; x < width - padX; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x - padX) / factor));
      const sy = Math.min(src.height - 1, Math.floor((y - padY) / factor));
      const si = (sy * src.width + sx) * 4;
      data.set(src.data.subarray(si, si + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/**
 * Imitates a screenshot of the timetable in a browser/PDF viewer: colours
 * mixed with white, fractional upscaling and a blur.
 */
function blurryScreenshot(src: Raster, factor: number, paler: number): Raster {
  const big = screenshot(src, factor, 20, 30);
  const { width, height } = big;
  const tinted = new Uint8Array(big.data.length);
  for (let i = 0; i < big.data.length; i += 4) {
    for (let k = 0; k < 3; k++) tinted[i + k] = Math.round(big.data[i + k]! + (255 - big.data[i + k]!) * paler);
    tinted[i + 3] = 255;
  }
  const out = new Uint8Array(tinted.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 4; k++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(width - 1, Math.max(0, x + dx));
            const yy = Math.min(height - 1, Math.max(0, y + dy));
            sum += tinted[(yy * width + xx) * 4 + k]!;
            n++;
          }
        }
        out[(y * width + x) * 4 + k] = Math.round(sum / n);
      }
    }
  }
  return { width, height, data: out };
}

const summary = (blocks: DetectedBlock[]) =>
  blocks.map((b) => `${b.day} ${b.start}+${b.duration} ${b.color} ${b.lane}/${b.lanes}`).sort();

// Read off the published Bc1JCF1.png (1st year, Jaderná a částicová fyzika, 1st group).
const JCF1 = [
  '0 8+2 pink 0/1', '0 10+2 green 0/1', '0 12+2 tan 0/1', '0 15+3 yellow 0/1', '0 18+2 purple 0/1',
  '1 10+2 green 0/1', '1 12+2 pink 0/1', '1 18+2 green 0/1',
  '2 8+2 green 0/1', '2 10+2 green 0/1', '2 12+2 pink 0/1',
  '3 8+2 grey 0/1', '3 10+2 tan 0/1', '3 12+2 green 0/1', '3 14+2 green 0/1', '3 16+2 pink 0/1', '3 18+2 purple 0/1',
  '4 8+2 pink 0/1', '4 10+2 pink 0/1', '4 14+2 grey 0/2', '4 14+2 grey 1/2', '4 16+2 grey 0/1',
].sort();

describe('official timetable detection', () => {
  it('finds every lesson block, colour and parallel lane', () => {
    const r = fixture('Bc1JCF1');
    const g = detectGeometry(r)!;
    expect(g.left).toBe(14);
    expect(g.bottom).toBe(307);
    expect(summary(detectBlocks(r, g))).toEqual(JCF1);
  });

  it('separates adjacent blocks of the same colour', () => {
    const r = fixture('Bc1JCF1');
    const wednesdayGreen = detectBlocks(r, detectGeometry(r)!).filter((b) => b.day === 2 && b.color === 'green');
    expect(wednesdayGreen.map((b) => [b.start, b.duration])).toEqual([[8, 2], [10, 2]]);
  });

  it('handles overlapping blocks with different lengths', () => {
    const r = fixture('Bc2FI_IPL1');
    const blocks = summary(detectBlocks(r, detectGeometry(r)!));
    expect(blocks).toContain('2 16+3 orange 0/2'); // ZEL1
    expect(blocks).toContain('2 16+4 pink 1/2'); // FPRA1
    expect(blocks).toContain('1 8+2 red 0/2'); // SPLAcv
    expect(blocks).toContain('1 8+2 pink 1/2'); // SMF
  });

  it('works on zoomed, cropped screenshots', () => {
    const shot = screenshot(fixture('Bc1JCF1'), 2, 37, 23);
    const g = detectGeometry(shot)!;
    expect(g.s).toBeCloseTo(2, 1);
    expect(summary(detectBlocks(shot, g))).toEqual(JCF1);
  });

  it('works on paler, blurred screenshots at fractional zoom', () => {
    const shot = blurryScreenshot(fixture('Bc1JCF1'), 2.4, 0.2);
    const g = detectGeometry(shot)!;
    expect(g.s).toBeCloseTo(2.4, 1);
    expect(summary(detectBlocks(shot, g))).toEqual(JCF1);
  });

  it('rejects images that are not timetables', () => {
    const blank: Raster = { width: 300, height: 200, data: new Uint8Array(300 * 200 * 4).fill(255) };
    expect(detectGeometry(blank)).toBeNull();
  });

  it('splits the strip into lecturer (left) and room (right)', () => {
    const r = fixture('Bc1JCF1');
    const g = detectGeometry(r)!;
    const mech = detectBlocks(r, g).find((b) => b.day === 0 && b.start === 8)!;
    const { lecturer, room } = splitMetaStrip(r, mech.metaRect, g.s);
    expect(lecturer!.x).toBeLessThan(mech.metaRect.x + 10);
    expect(room!.x + room!.w).toBeGreaterThan(mech.metaRect.x + mech.metaRect.w - 10);
    expect(lecturer!.x + lecturer!.w).toBeLessThan(room!.x);
  });
});

describe('recognizeOfficial', () => {
  it('builds lessons from detected blocks and OCR text', async () => {
    const engine: OcrEngine = {
      read: async (_img, kind) => ({ text: { title: 'MECHey', lecturer: 'Bren', room: '8-103', spec: 'JCF1' }[kind], confidence: 90 }),
    };
    const progress: number[] = [];
    const result = (await recognizeOfficial(fixture('Bc1JCF1'), engine, (done) => progress.push(done)))!;
    expect(result.specText).toBe('JCF1');
    expect(result.lessons).toHaveLength(JCF1.length);
    expect(result.lessons[0]).toMatchObject({ day: 0, start: 8, duration: 2, color: 'pink', subject: 'MECHcv', lecturer: 'Břeň', room: 'B-103' });
    expect(progress.at(-1)).toBe(JCF1.length + 1);
  });

  it('uses department colour to correct a course title without applying course matching to the corner ID', async () => {
    const engine: OcrEngine = {
      read: async (_img, kind) => ({ text: { title: 'MECN', lecturer: 'Bren', room: 'B-103', spec: 'MECN' }[kind], confidence: 90 }),
    };
    const result = (await recognizeOfficial(fixture('Bc1JCF1'), engine))!;
    expect(result.specText).toBe('MECN');
    expect(result.lessons[0]).toMatchObject({ color: 'pink', subject: 'MECH' });
    expect(result.lessons.find((lesson) => lesson.color === 'green')!.subject).not.toBe('MECH');
  });
});

describe('recognizeOfficial language labels', () => {
  it('reads a language lesson as JAZ.n even when every zoom drops the dot', async () => {
    const titles = ['JAZ3', 'JAZ 3', 'JAZ3', 'JAZ.3'];
    let call = 0;
    const engine: OcrEngine = {
      read: async (_img, kind) => ({ text: kind === 'title' ? titles[call++ % titles.length]! : { lecturer: '', room: '', spec: 'JCF1' }[kind], confidence: 90 }),
    };
    const result = (await recognizeOfficial(fixture('Bc1JCF1'), engine))!;
    expect(new Set(result.lessons.map((lesson) => lesson.subject))).toEqual(new Set(['JAZ.3']));
  });
});

describe('pickReading', () => {
  it('prefers what several zooms agree on over one confident outlier', () => {
    expect(pickReading([{ text: '1', confidence: 96 }, { text: 'CH1', confidence: 85 }, { text: 'CH1', confidence: 92 }, { text: 'cl', confidence: 69 }])).toBe('CH1');
  });

  it('falls back to the most confident reading', () => {
    expect(pickReading([{ text: 'D', confidence: 66 }, { text: 'DIM1cv', confidence: 86 }, { text: '', confidence: 0 }])).toBe('DIM1cv');
    expect(pickReading([{ text: ' ', confidence: 90 }])).toBe('');
  });
});

describe('OCR clean-up', () => {
  it('fixes common misreads', () => {
    expect(cleanTitle(' MAN.rez ')).toBe('MAN.rez');
    expect(cleanTitle('LALey')).toBe('LALcv');
    expect(cleanTitle('MANCY')).toBe('MANcv');
    expect(cleanTitle('AMScv')).toBe('AMScv');
    expect(cleanTitle('FANA1cY')).toBe('FANA1cv');
    expect(cleanTitle('FANAlov')).toBe('FANAlcv');
    expect(cleanTitle('FANAlcy')).toBe('FANAlcv');
    expect(cleanTitle('BIOW')).toBe('BIOW'); // Upper-case course letters are not suffix errors.
    // Generic language labels keep the dot that small print loses.
    for (const read of ['JAZ3', 'JAZ.3', 'JAZ 3', ' jaz3 ']) expect(cleanTitle(read)).toBe('JAZ.3');
    expect(cleanTitle('JAZ2cv')).toBe('JAZ.2cv');
    expect(cleanTitle('JAZ2cY')).toBe('JAZ.2cv');
    expect(cleanTitle('JAZ')).toBe('JAZ');
    expect(cleanTitle('JAZK1')).toBe('JAZK1');
    expect(cleanRoom('8-103')).toBe('B-103');
    expect(cleanRoom('1-201')).toBe('T-201');
    expect(cleanRoom('klff-121')).toBe('KLFF-121');
    expect(cleanRoom('--')).toBe('');
    expect(cleanLecturer(' I. Jex ')).toBe('I. Jex');
    expect(cleanLecturer('--')).toBe('');
  });
});

describe('import helpers', () => {
  it('restores our own PNG and PDF exports exactly', () => {
    const s = createSchedule('Bc2JI_JR1');
    s.lessons.push(normalizeLesson({ day: 3, start: 9, duration: 3, subject: 'Řešené úlohy', room: 'T-105', lecturer: 'Kuchař', color: 'teal' }));
    const payload = encodePayload(s);
    const tinyPng = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0),
    );
    const pdf = buildPdf({ width: 1, height: 1, deflated: new Uint8Array([120, 156, 99, 0, 0, 0, 1, 0, 1]) }, { title: 'x', custom: { [EMBED_KEY]: payload } });
    for (const file of [addTextChunk(tinyPng, EMBED_KEY, payload), pdf]) {
      const back = readEmbeddedSchedule(file)!;
      expect(back.specId).toBe('JI_JR1');
      expect(back.lessons[0]).toMatchObject({ subject: 'Řešené úlohy', lecturer: 'Kuchař', start: 9, duration: 3, color: 'teal' });
    }
    expect(readEmbeddedSchedule(tinyPng)).toBeNull();
  });

  it('guesses the specialization ID from the file name or corner text', () => {
    expect(guessSpecId('Bc1JCF1.png', 'JCF1')).toBe('JCF1');
    expect(guessSpecId('Bc1JI_JR2 (1).pdf', '')).toBe('JI_JR2');
    expect(guessSpecId('Bc2FI_IPL1.png', 'FI_IPL')).toBe('FI_IPL'); // corner has no kruh
    expect(guessSpecId('Bc2FI_IPL1.png', '')).toBe('FI_IPL1'); // corner unreadable: keep the file's
    expect(guessSpecId('Bc1JCF2.png', 'RT')).toBe('JCF2'); // corner misread as another program
    expect(guessSpecId('screenshot.png', 'JCF1')).toBe('JCF1');
    expect(guessSpecId('screenshot.png', 'RT')).toBe('RT');
    expect(guessSpecId('report.png', 'Nav1XYZ')).toBe('Nav1XYZ'); // unknown: kept as read
    expect(guessSpecId('x.png', '')).toBe('');
  });
});
