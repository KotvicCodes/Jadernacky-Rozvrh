/**
 * Loads every official timetable listed in public/fjfi/manifest.json, for
 * the replacement finder. The JSON files are content-hashed, so a copy kept
 * in the browser's Cache Storage stays valid until the deploy publishes a new
 * name; entries the current manifest no longer lists are removed.
 */
import type { CatalogTimetable } from '../replacements';
import { parseOfficialTimetable } from './official-data';
import { loadManifest, manifestUrl, timetableLabel, type FjfiManifest } from './web';

export const CATALOG_CACHE = 'jaderka-rozvrh:fjfi-timetables';
const CONCURRENCY = 6;

export interface Catalog {
  generatedAt: Date;
  timetables: CatalogTimetable[];
  /** Timetables that could not be downloaded or were invalid. */
  failed: number;
}

/** Loaded timetables of this page visit, by file URL. */
const memory = new Map<string, CatalogTimetable>();

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CATALOG_CACHE);
  } catch {
    return null; // Not a secure context, or storage blocked.
  }
}

async function readJson(url: string, cache: Cache | null, signal?: AbortSignal): Promise<unknown> {
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) {
    try {
      return await hit.json();
    } catch {
      await cache?.delete(url).catch(() => false);
    }
  }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const copy = res.clone();
  const json: unknown = await res.json();
  await cache?.put(url, copy).catch(() => undefined);
  return json;
}

interface Entry {
  url: string;
  id: string;
  short: string;
  label: string;
}

function entries(manifest: FjfiManifest): Entry[] {
  const base = manifestUrl();
  return manifest.years.flatMap((year) => year.programs.flatMap((program) => program.kruhs.map((kruh) => ({
    url: new URL(kruh.file, base).href,
    id: kruh.id,
    short: `${program.code}${program.kruhs.length > 1 && kruh.kruh !== null ? kruh.kruh : ''}`,
    label: timetableLabel(year, program, kruh),
  }))));
}

/**
 * Downloads (or reads from the cache) every timetable of every year.
 * `onProgress` reports finished and total counts. Throws ManifestError when
 * the list itself is unavailable, or an Error when no timetable loaded.
 */
export async function loadCatalog(onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<Catalog> {
  const manifest = await loadManifest(signal);
  const list = entries(manifest);
  const cache = await openCache();
  const timetables: (CatalogTimetable | null)[] = new Array(list.length).fill(null);
  let done = 0;
  let next = 0;
  onProgress?.(0, list.length);

  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      const entry = list[index]!;
      try {
        let timetable = memory.get(entry.url);
        if (!timetable) {
          const data = parseOfficialTimetable(await readJson(entry.url, cache, signal), entry.id);
          timetable = { id: entry.id, short: entry.short, label: entry.label, lessons: data.lessons };
          memory.set(entry.url, timetable);
        }
        timetables[index] = timetable;
      } catch {
        if (signal?.aborted) throw signal.reason;
        await cache?.delete(entry.url).catch(() => false);
      }
      onProgress?.(++done, list.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  if (signal?.aborted) throw signal.reason;

  const loaded = timetables.filter((t): t is CatalogTimetable => t !== null);
  if (!loaded.length) throw new Error('Rozvrhy z webu FJFI se nepodařilo stáhnout. Zkontroluj připojení k internetu a zkus to znovu.');
  void pruneCache(cache, new Set(list.map((e) => e.url)));
  return { generatedAt: manifest.generatedAt, timetables: loaded, failed: list.length - loaded.length };
}

async function pruneCache(cache: Cache | null, keep: Set<string>): Promise<void> {
  if (!cache) return;
  try {
    for (const request of await cache.keys()) {
      if (!keep.has(request.url)) await cache.delete(request);
    }
  } catch {
    // Best effort: a stale entry only takes a little space.
  }
}
