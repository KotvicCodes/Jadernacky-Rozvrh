import { EMBED_KEY, encodePayload } from './embed';
import type { Schedule } from './model';
import { buildPdf, deflate } from './pdf';
import { addTextChunk } from './png';
import { renderToCanvas } from './render';

/** Pixel density of exports: sharp when printed, still small files. */
const PDF_SCALE = 3;
const PNG_SCALE = 2;

export function exportFileName(schedule: Schedule, ext: 'pdf' | 'png'): string {
  const base = schedule.specId.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `rozvrh${base ? `-${base}` : ''}.${ext}`;
}

function download(bytes: Uint8Array, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function canvasRgb(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D není dostupný.');
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!;
    rgb[j + 1] = rgba[i + 1]!;
    rgb[j + 2] = rgba[i + 2]!;
  }
  return rgb;
}

export async function schedulePdf(schedule: Schedule): Promise<Uint8Array> {
  // Rendering and compression are asynchronous. Keep the image and embedded
  // timetable consistent if a lesson is edited before the download finishes.
  schedule = structuredClone(schedule);
  const canvas = renderToCanvas(schedule, PDF_SCALE);
  return buildPdf(
    { width: canvas.width, height: canvas.height, deflated: await deflate(canvasRgb(canvas)) },
    { title: `Rozvrh ${schedule.specId}`.trim(), custom: { [EMBED_KEY]: encodePayload(schedule) } },
  );
}

export async function schedulePng(schedule: Schedule): Promise<Uint8Array> {
  schedule = structuredClone(schedule);
  const canvas = renderToCanvas(schedule, PNG_SCALE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG se nepodařilo vytvořit.');
  return addTextChunk(new Uint8Array(await blob.arrayBuffer()), EMBED_KEY, encodePayload(schedule));
}

export async function downloadPdf(schedule: Schedule): Promise<void> {
  const name = exportFileName(schedule, 'pdf');
  download(await schedulePdf(schedule), 'application/pdf', name);
}

export async function downloadPng(schedule: Schedule): Promise<void> {
  const name = exportFileName(schedule, 'png');
  download(await schedulePng(schedule), 'image/png', name);
}
