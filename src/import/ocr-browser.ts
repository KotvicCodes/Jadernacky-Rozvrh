import type { Raster } from './raster';
import type { OcrEngine, OcrResult, TextKind } from './recognize';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

/** Characters each field may contain on the official timetables. */
const WHITELIST: Record<TextKind, string> = {
  title: `${LETTERS}${DIGITS}._-`,
  spec: `${LETTERS.slice(0, 26)}${DIGITS}_`,
  lecturer: `${LETTERS}. -`,
  // Upper case only reads best; snapping restores codes like "Dc-P4".
  room: `${LETTERS.slice(0, 26)}${DIGITS}-`,
};

export interface BrowserOcr extends OcrEngine {
  close(): Promise<void>;
}

/**
 * Tesseract.js OCR. The library, its WebAssembly core and the English model
 * (~4 MB) are only downloaded the first time someone imports an image.
 */
export async function createBrowserOcr(): Promise<BrowserOcr> {
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('eng');
  let current: TextKind | null = null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D není dostupný.');

  return {
    async read(image: Raster, kind: TextKind): Promise<OcrResult> {
      if (kind !== current) {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: WHITELIST[kind] });
        current = kind;
      }
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
      const first = (await worker.recognize(canvas)).data;
      if (kind !== 'title' || first.text.trim()) return { text: first.text, confidence: first.confidence };
      // Bold, tightly spaced course labels can be rejected as a single line.
      // Retry only empty titles as a single word; blank metadata stays blank.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD });
      try {
        const { data } = await worker.recognize(canvas);
        return { text: data.text, confidence: data.confidence };
      } finally {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
      }
    },
    async close() {
      await worker.terminate();
    },
  };
}
