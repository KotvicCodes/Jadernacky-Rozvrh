import type { Raster } from './raster';
import type { OcrEngine, OcrResult, TextKind } from './recognize';
import { createOcrReader } from './ocr-reader';

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
  const read = createOcrReader(worker, PSM);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D není dostupný.');

  return {
    async read(image: Raster, kind: TextKind): Promise<OcrResult> {
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
      return read(canvas, kind);
    },
    async close() {
      await worker.terminate();
    },
  };
}
