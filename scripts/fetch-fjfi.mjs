#!/usr/bin/env node
/**
 * Mirrors the official student timetables of rozvrh.fjfi.cvut.cz into
 * public/fjfi/ for the "Importovat z webu FJFI" dialog. The site sends no
 * CORS headers, so the app cannot fetch them itself; Vite copies public/
 * into the build and the app loads them from its own origin.
 *
 *   npm run fetch-fjfi                    # manifest.json + one PDF per kruh
 *   npm run fetch-fjfi -- --check-programs # only compare src/config.ts PROGRAMS with the site
 *
 * The list of pages is read from the site's navigation, so new years and
 * programs appear without changes here. Exits non-zero when the pages
 * cannot be parsed or nothing is found, so a redesign fails the deploy
 * instead of publishing an empty list.
 *
 * Downloads are sequential and conditional (ETag / Last-Modified from the
 * previous manifest), so a run with a restored cache transfers almost
 * nothing when the timetables have not changed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_VERSION, SITE, bachelorCodes, buildYears, configProgramCodes, parseNav, parsePage, programDrift } from './fjfi-site.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public', 'fjfi');
const USER_AGENT = 'jaderka-rozvrh-sync';
const SAFE_FILE = /^[A-Za-z0-9_-]+\.(pdf|png)$/;
// PDFs: ~0.6 MB each, ~73 MB for all ~120 timetables (Nov 2026) — fine for
// GitHub Pages (1 GB site limit) and they OCR much better than the PNGs.
const PREFER = process.env.FJFI_FORMAT === 'png' ? 'png' : 'pdf';

const checkOnly = process.argv.includes('--check-programs');

class FatalError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with retries and exponential backoff on network errors, 429 and 5xx. */
async function get(url, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      if (attempt >= 4) throw new FatalError(`${url}: ${err.message}`);
    }
    if (res) {
      if (res.ok || res.status === 304) return res;
      if (res.status !== 429 && res.status < 500) throw new FatalError(`${url}: HTTP ${res.status}`);
      if (attempt >= 4) throw new FatalError(`${url}: HTTP ${res.status}`);
    }
    const wait = 1000 * 2 ** (attempt - 1);
    console.warn(`  retry ${attempt} for ${url} in ${wait / 1000} s`);
    await sleep(wait);
  }
}

async function text(url) {
  return (await get(url)).text();
}

async function crawl() {
  const nav = parseNav(await text(`${SITE}/`));
  if (!nav.length) throw new FatalError('No student timetable pages found in the site navigation (redesign?).');
  const pages = [];
  for (const page of nav) {
    const entries = parsePage(await text(`${SITE}/rozvrh/studenti/${page.slug}`));
    console.log(`${page.slug.padEnd(12)} ${String(entries.length).padStart(3)} timetables  ${page.title}`);
    if (!entries.length && /ročník/i.test(page.title)) {
      throw new FatalError(`No timetables found on /rozvrh/studenti/${page.slug} (redesign?).`);
    }
    pages.push({ ...page, entries });
  }
  const years = buildYears(pages, (entry) => {
    const url = (PREFER === 'pdf' ? entry.pdf ?? entry.png : entry.png ?? entry.pdf) ?? null;
    if (!url) return null;
    const file = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    if (!SAFE_FILE.test(file)) {
      console.warn(`  skipping ${entry.id}: unexpected file name ${file}`);
      return null;
    }
    return { file, url };
  });
  const count = years.reduce((n, y) => n + y.programs.reduce((m, p) => m + p.kruhs.length, 0), 0);
  if (!count) throw new FatalError('No timetables found on any page (redesign?).');
  return { years, count };
}

function checkPrograms(years) {
  const app = configProgramCodes(readFileSync(join(ROOT, 'src', 'config.ts'), 'utf8'));
  const site = bachelorCodes(years);
  if (!site.length) throw new FatalError('No bachelor programs found on the site (redesign?).');
  const { added, removed } = programDrift(app, site);
  if (!added.length && !removed.length) {
    console.log(`\nPROGRAMS in src/config.ts match the ${site.length} bachelor programs on the website.`);
    return true;
  }
  const names = new Map(years.flatMap((y) => y.programs.map((p) => [p.code, p.name])));
  console.error('\nPROGRAMS in src/config.ts no longer match the bachelor programs on the website:');
  for (const c of added) console.error(`  + ${c}  (${names.get(c) ?? '?'}) — on the website, missing in the app`);
  for (const c of removed) console.error(`  - ${c}  — in the app, no longer on the website`);
  console.error('Update PROGRAMS in src/config.ts.');
  return false;
}

function previousFiles() {
  try {
    const old = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
    const map = new Map();
    for (const y of old.years ?? []) for (const p of y.programs ?? []) for (const k of p.kruhs ?? []) map.set(k.file, k);
    return map;
  } catch {
    return new Map();
  }
}

const MAGIC = { pdf: '%PDF', png: '\x89PNG' };

async function download(years) {
  mkdirSync(OUT, { recursive: true });
  const old = previousFiles();
  let bytes = 0;
  let fetched = 0;
  let unchanged = 0;
  for (const year of years) {
    for (const program of year.programs) {
      for (const k of program.kruhs) {
        const path = join(OUT, k.file);
        const prev = old.get(k.file);
        const cached = prev && existsSync(path) && statSync(path).size === prev.size;
        const headers = {};
        if (cached && prev.etag) headers['If-None-Match'] = prev.etag;
        if (cached && prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;
        const res = await get(k.url, headers);
        if (res.status === 304 && cached) {
          Object.assign(k, { size: prev.size, etag: prev.etag ?? null, lastModified: prev.lastModified ?? null });
          unchanged++;
        } else {
          const data = Buffer.from(await res.arrayBuffer());
          const ext = k.file.slice(-3);
          if (data.subarray(0, 4).toString('latin1') !== MAGIC[ext]) throw new FatalError(`${k.url}: not a ${ext.toUpperCase()} file`);
          writeFileSync(path, data);
          Object.assign(k, { size: data.length, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') });
          fetched++;
        }
        bytes += k.size;
      }
    }
  }
  // Drop timetables that are no longer on the website.
  const keep = new Set(years.flatMap((y) => y.programs.flatMap((p) => p.kruhs.map((k) => k.file))));
  for (const name of readdirSync(OUT)) {
    if (SAFE_FILE.test(name) && !keep.has(name)) rmSync(join(OUT, name));
  }
  return { bytes, fetched, unchanged };
}

try {
  const { years, count } = await crawl();
  if (checkOnly) {
    process.exitCode = checkPrograms(years) ? 0 : 1;
  } else {
    const { bytes, fetched, unchanged } = await download(years);
    const manifest = {
      version: MANIFEST_VERSION,
      generatedAt: new Date().toISOString(),
      source: `${SITE}/rozvrh/studenti/`,
      years,
    };
    const tmp = join(OUT, 'manifest.json.tmp');
    writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(tmp, join(OUT, 'manifest.json'));
    const programs = years.reduce((n, y) => n + y.programs.length, 0);
    console.log(
      `\n${years.length} years, ${programs} programs, ${count} timetables (${(bytes / 1e6).toFixed(1)} MB; ${fetched} downloaded, ${unchanged} unchanged) → public/fjfi/`,
    );
  }
} catch (err) {
  console.error(`\nfetch-fjfi: ${err instanceof FatalError ? err.message : err.stack ?? err}`);
  process.exitCode = 1;
}
