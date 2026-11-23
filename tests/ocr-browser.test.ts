import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { createBrowserOcr } from '../src/import/ocr-browser';

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(),
  PSM: { SINGLE_LINE: '7', SINGLE_WORD: '8' },
}));

describe('course OCR fallback', () => {
  const image = { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) };
  let worker: { setParameters: ReturnType<typeof vi.fn>; recognize: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    worker = { setParameters: vi.fn(), recognize: vi.fn(), terminate: vi.fn() };
    vi.mocked(createWorker).mockResolvedValue(worker as unknown as Worker);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal('ImageData', class {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries an empty title as a word, then restores line mode for the next title', async () => {
    worker.recognize
      .mockResolvedValueOnce({ data: { text: '', confidence: 0 } })
      .mockResolvedValueOnce({ data: { text: 'FANAlov', confidence: 24 } })
      .mockResolvedValueOnce({ data: { text: 'MECH', confidence: 95 } });
    const ocr = await createBrowserOcr();
    expect(await ocr.read(image, 'title')).toEqual({ text: 'FANAlov', confidence: 24 });
    expect(await ocr.read(image, 'title')).toEqual({ text: 'MECH', confidence: 95 });
    expect(worker.setParameters.mock.calls.map(([params]) => params.tessedit_pageseg_mode))
      .toEqual([PSM.SINGLE_LINE, PSM.SINGLE_WORD, PSM.SINGLE_LINE]);
    expect(worker.recognize).toHaveBeenCalledTimes(3);
    await ocr.close();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not retry an empty lecturer field', async () => {
    worker.recognize.mockResolvedValue({ data: { text: '', confidence: 0 } });
    const ocr = await createBrowserOcr();
    expect(await ocr.read(image, 'lecturer')).toEqual({ text: '', confidence: 0 });
    expect(worker.recognize).toHaveBeenCalledOnce();
    expect(worker.setParameters.mock.calls.map(([params]) => params.tessedit_pageseg_mode)).toEqual([PSM.SINGLE_LINE]);
    await ocr.close();
  });
});
