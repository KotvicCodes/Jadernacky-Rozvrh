#!/usr/bin/env node
/** Recognize official PDFs once, cache the results, and publish only JSON. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { availableParallelism } from 'node:os';
import { build } from 'vite';
import { PNG } from 'pngjs';
import { createWorker, OEM, PSM } from 'tesseract.js';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = join(ROOT, '.cache', 'fjfi');
const SOURCE = join(CACHE, 'source');
const OUT = join(ROOT, 'public', 'fjfi');
const RECOGNIZED = join(CACHE, 'recognized');
const MODEL = join(CACHE, 'tesseract');
const WIDTH = 3200;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const atomicJson = (path, value) => {
  writeFileSync(`${path}.tmp`, JSON.stringify(value));
  renameSync(`${path}.tmp`, path);
};

async function main() {
  for (const dir of [CACHE, OUT, RECOGNIZED, MODEL]) mkdirSync(dir, { recursive: true });
  const source = JSON.parse(readFileSync(join(SOURCE, 'manifest.json'), 'utf8'));
  if (source.version !== 1 || !Array.isArray(source.years) || !source.years.length) throw new Error('Missing source manifest; run npm run sync-fjfi first.');
  const built = await build({
    configFile: false, logLevel: 'error',
    build: { ssr: join(ROOT, 'scripts', 'fjfi-runtime.ts'), write: false, minify: true },
  });
  const code = (Array.isArray(built) ? built[0] : built).output.find((entry) => entry.type === 'chunk').code;
  const runtimeHash = sha(code);
  const runtimeFile = join(CACHE, `runtime-${runtimeHash}.mjs`);
  writeFileSync(runtimeFile, code);
  const runtime = await import(pathToFileURL(runtimeFile).href);
  const implementation = sha([runtimeHash, sha(readFileSync(join(ROOT, 'package-lock.json'))), String(WIDTH), process.platform, process.arch].join('\0'));
  const published = { version: 2, generatedAt: source.generatedAt, source: source.source, years: [] };
  const jobs = [];
  const ids = new Set();
  for (const year of source.years) {
    const nextYear = { id: year.id, label: year.label, programs: [] };
    for (const program of year.programs) {
      const nextProgram = { code: program.code, name: program.name, kruhs: [] };
      for (const kruh of program.kruhs) {
        if (!/^[A-Za-z0-9_]+$/.test(kruh.id) || !/^[A-Za-z0-9_-]+\.(pdf|png)$/.test(kruh.file) || ids.has(kruh.id)) throw new Error('Invalid or duplicate source timetable');
        ids.add(kruh.id);
        if (program.kruhs.length > 1 && (!Number.isInteger(kruh.kruh) || kruh.kruh < 1)) throw new Error(`Invalid kruh for ${kruh.id}`);
        const specId = program.code + (program.kruhs.length > 1 ? kruh.kruh : '');
        const entry = { kruh: kruh.kruh, id: kruh.id, file: '' };
        nextProgram.kruhs.push(entry);
        const bytes = readFileSync(join(SOURCE, kruh.file));
        const fingerprint = sha([implementation, sha(bytes), specId].join('\0'));
        const cacheFile = join(RECOGNIZED, `${kruh.id}.json`);
        let data;
        try {
          const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
          if (cached.fingerprint === fingerprint) {
            data = runtime.parseOfficialTimetable(cached.data, kruh.id);
            if (data.specId !== specId) data = undefined;
          }
        } catch { /* A missing or corrupt cache is recomputed. */ }
        jobs.push({ id: kruh.id, sourceFile: kruh.file, bytes, specId, fingerprint, cacheFile, entry, data });
      }
      nextYear.programs.push(nextProgram);
    }
    published.years.push(nextYear);
  }
  if (!jobs.length) throw new Error('No source timetables');
  const pending = jobs.filter((job) => !job.data);
  console.log(`${jobs.length} timetables: ${jobs.length - pending.length} cached, ${pending.length} need OCR`);
  const requested = Number(process.env.FJFI_OCR_WORKERS ?? Math.min(2, availableParallelism()));
  if (!Number.isInteger(requested) || requested < 1 || requested > 4) throw new Error('FJFI_OCR_WORKERS must be between 1 and 4');
  const engines = [];
  let cursor = 0;
  let completed = 0;
  let failed = false;
  if (pending.length) {
    Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    try {
      // Initialize sequentially so model-cache downloads cannot race.
      for (let i = 0; i < Math.min(requested, pending.length); i++) {
        const worker = await createWorker('eng', OEM.LSTM_ONLY, { cachePath: MODEL });
        engines.push({ worker, read: runtime.createOcrReader(worker, PSM) });
      }
      const outcomes = await Promise.allSettled(engines.map(async (engine) => {
        while (!failed && cursor < pending.length) {
          const job = pending[cursor++];
          try {
            let image;
            if (job.sourceFile.endsWith('.png')) {
              const png = PNG.sync.read(job.bytes);
              image = { width: png.width, height: png.height, data: png.data };
            } else {
              const task = getDocument({ data: new Uint8Array(job.bytes), useSystemFonts: true, disableFontFace: true, verbosity: 0 });
              try {
                const doc = await task.promise;
                const page = await doc.getPage(1);
                const viewport = page.getViewport({ scale: WIDTH / page.getViewport({ scale: 1 }).width });
                const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvas, canvasContext: ctx, viewport }).promise;
                const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
                image = { width: pixels.width, height: pixels.height, data: pixels.data };
              } finally { await task.destroy(); }
            }
            const recognized = await runtime.recognizeOfficial(image, {
              read: (crop, kind) => engine.read(PNG.sync.write({ width: crop.width, height: crop.height, data: Buffer.from(crop.data) }), kind),
            });
            if (!recognized) throw new Error('Timetable geometry or lessons could not be recognized');
            job.data = runtime.parseOfficialTimetable({
              version: 1, id: job.id, specId: job.specId,
              lessons: recognized.lessons.map(({ id: _id, ...lesson }) => lesson),
            }, job.id);
            atomicJson(job.cacheFile, { fingerprint: job.fingerprint, data: job.data });
            console.log(`[${++completed}/${pending.length}] ${job.id}: ${job.data.lessons.length} lessons`);
          } catch (error) {
            failed = true;
            throw new Error(`${job.id}: ${error.message}`, { cause: error });
          }
        }
      }));
      const failure = outcomes.find((outcome) => outcome.status === 'rejected');
      if (failure) throw failure.reason;
    } finally { await Promise.allSettled(engines.map(({ worker }) => worker.terminate())); }
  }
  // Lectures shared by several programs are printed the same in each timetable;
  // a copy OCR misread takes the code the other copies agree on.
  const missing = jobs.find((job) => !job.data);
  if (missing) throw new Error(`Missing recognition result for ${missing.id}`);
  const reconciled = runtime.reconcileSharedLessons(jobs.map((job) => ({ id: job.id, lessons: job.data.lessons })));
  reconciled.timetables.forEach((timetable, index) => {
    jobs[index].data = runtime.parseOfficialTimetable({ ...jobs[index].data, lessons: timetable.lessons }, jobs[index].id);
  });
  for (const fix of reconciled.corrections) console.log(`${fix.id} day ${fix.day} ${fix.start}:00: ${JSON.stringify(fix.from)} → ${fix.to} (shared lesson)`);
  const keep = new Set(['manifest.json']);
  let bytes = 0;
  let lessons = 0;
  let unnamed = 0;
  for (const job of jobs) {
    if (!job.data) throw new Error(`Missing recognition result for ${job.id}`);
    const json = JSON.stringify(job.data);
    const file = `${job.id}-${sha(json).slice(0, 16)}.json`;
    job.entry.file = file;
    keep.add(file);
    atomicJson(join(OUT, file), job.data);
    bytes += Buffer.byteLength(json);
    lessons += job.data.lessons.length;
    unnamed += job.data.lessons.filter((lesson) => !lesson.subject.trim()).length;
  }
  // Publish the manifest only once every timetable is complete and valid.
  atomicJson(join(OUT, 'manifest.json'), published);
  for (const file of readdirSync(OUT)) if (!keep.has(file) && /\.(json|pdf|png|tmp)$/.test(file)) rmSync(join(OUT, file));
  console.log(`Published ${jobs.length} timetables, ${lessons} lessons, ${bytes} bytes of JSON; ${unnamed} unnamed lessons to review; ${reconciled.corrections.length} codes taken from shared lessons.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Timetable preprocessing: ${jobs.length} files, ${lessons} lessons, ${bytes} bytes of JSON, ${jobs.length - pending.length} reused results, ${unnamed} unnamed lessons, ${reconciled.corrections.length} codes taken from shared lessons.\n`);
  }
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
