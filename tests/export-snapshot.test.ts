import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBED_KEY, decodePayload } from '../src/embed';
import { schedulePdf, schedulePng } from '../src/export';
import { createSchedule, normalizeLesson } from '../src/model';
import { readPdfInfoValue } from '../src/pdf';
import { readTextChunk } from '../src/png';
import { renderToCanvas } from '../src/render';

vi.mock('../src/render', () => ({ renderToCanvas: vi.fn() }));

describe('export snapshots', () => {
  afterEach(() => vi.clearAllMocks());

  it.each(['png', 'pdf'] as const)('keeps %s metadata consistent with the image when the schedule changes during export', async (kind) => {
    const schedule = createSchedule('JCF1', 'Original');
    schedule.lessons.push(normalizeLesson({ subject: 'MAN', day: 0, start: 8, duration: 2 }));
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    vi.mocked(renderToCanvas).mockImplementation((snapshot) => {
      expect(snapshot.lessons[0]!.subject).toBe('MAN');
      expect(snapshot.specId).toBe('JCF1');
      // Edits occur after drawing but before toBlob/compression completes.
      schedule.lessons[0]!.subject = 'CHANGED';
      schedule.specId = 'JI_JR2';
      return {
        width: 1, height: 1,
        getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }) }),
        toBlob: (callback: BlobCallback) => callback({ arrayBuffer: async () => png.buffer } as Blob),
      } as unknown as HTMLCanvasElement;
    });
    const bytes = await (kind === 'png' ? schedulePng(schedule) : schedulePdf(schedule));
    const restored = decodePayload((kind === 'png' ? readTextChunk(bytes, EMBED_KEY) : readPdfInfoValue(bytes, EMBED_KEY))!)!;
    expect(restored.specId).toBe('JCF1');
    expect(restored.lessons[0]!.subject).toBe('MAN');
    expect(schedule.lessons[0]!.subject).toBe('CHANGED');
  });
});
