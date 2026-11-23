import type { ImageLike, PSM, Worker } from 'tesseract.js';
import type { OcrResult, TextKind } from './recognize';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const WHITELIST: Record<TextKind, string> = {
  title: `${LETTERS}${DIGITS}._-`,
  spec: `${LETTERS.slice(0, 26)}${DIGITS}_`,
  lecturer: `${LETTERS}. -`,
  room: `${LETTERS.slice(0, 26)}${DIGITS}-`,
};

/** The same OCR settings and empty-title fallback in the browser and deploy job. */
export function createOcrReader(worker: Pick<Worker, 'recognize' | 'setParameters'>, modes: { SINGLE_LINE: PSM; SINGLE_WORD: PSM }) {
  let current: TextKind | null = null;
  return async (image: ImageLike, kind: TextKind): Promise<OcrResult> => {
    if (kind !== current) {
      await worker.setParameters({ tessedit_pageseg_mode: modes.SINGLE_LINE, tessedit_char_whitelist: WHITELIST[kind] });
      current = kind;
    }
    const first = (await worker.recognize(image)).data;
    if (kind !== 'title' || first.text.trim()) return { text: first.text, confidence: first.confidence };
    await worker.setParameters({ tessedit_pageseg_mode: modes.SINGLE_WORD });
    try {
      const { data } = await worker.recognize(image);
      return { text: data.text, confidence: data.confidence };
    } finally {
      await worker.setParameters({ tessedit_pageseg_mode: modes.SINGLE_LINE });
    }
  };
}
