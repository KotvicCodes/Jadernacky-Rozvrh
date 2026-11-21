/**
 * Pure parsing helpers for scripts/fetch-fjfi.mjs: reads the student
 * timetable pages of rozvrh.fjfi.cvut.cz and turns them into the manifest
 * the app's "Importovat z webu FJFI" dialog reads. No network or file
 * access here, so tests can feed it saved HTML. Types: fjfi-site.d.mts.
 */

export const SITE = 'https://rozvrh.fjfi.cvut.cz';
export const MANIFEST_VERSION = 1;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodes the few HTML entities the site uses and collapses whitespace. */
export function decodeText(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Student timetable pages linked from the site navigation, in nav order:
 * `<a href="/rozvrh/studenti/bs1">Rozvrh 1. ročníku bakalářského studia</a>`.
 */
export function parseNav(html) {
  const pages = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*\bhref="(?:https?:\/\/rozvrh\.fjfi\.cvut\.cz)?\/rozvrh\/studenti\/([a-z0-9_-]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const slug = m[1].toLowerCase();
    const title = decodeText(m[2]);
    if (seen.has(slug) || !title) continue;
    seen.add(slug);
    pages.push({ slug, title });
  }
  return pages;
}

/** "Rozvrh 1. ročníku bakalářského studia" → "1. ročník Bc." (falls back to the title without "Rozvrh"). */
const YEAR_TITLE = /(\d+)\.\s*ročník\S*\s+(bakalářsk|navazující\S*\s+magistersk|magistersk|doktorsk)/i;

export function shortYearLabel(title) {
  const m = YEAR_TITLE.exec(title);
  if (m) {
    const kind = m[2].toLowerCase();
    const suffix = kind.startsWith('bakal') ? 'Bc.' : kind.startsWith('navaz') ? 'NMS' : kind.startsWith('magist') ? 'Mgr.' : 'Ph.D.';
    return `${m[1]}. ročník ${suffix}`;
  }
  const rest = title.replace(/^rozvrh\s+/i, '').trim();
  return rest ? rest[0].toUpperCase() + rest.slice(1) : title;
}

/**
 * Timetable entries of one page. The table of contents
 * (`<a href="#Bc1JCF1">Jaderná a částicová fyzika 1. kruh</a>`) lists the
 * IDs; each `<div id="Bc1JCF1">` section holds the PDF and PNG links.
 * Entries without a timetable file (e.g. the language pages, which link
 * free-form documents) are skipped.
 */
export function parsePage(html) {
  const mainStart = html.search(/<main\b/i);
  const body = mainStart >= 0 ? html.slice(mainStart) : html;
  const toc = [];
  const seen = new Set();
  for (const m of body.matchAll(/<a\b[^>]*\bhref="#([A-Za-z0-9_]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    toc.push({ id: m[1], title: decodeText(m[2]) });
  }

  // Section start offsets, so a section ends where the next one starts.
  const starts = toc
    .map((t) => ({ ...t, at: body.search(new RegExp(`\\bid="${t.id}"`)) }))
    .filter((t) => t.at >= 0)
    .sort((a, b) => a.at - b.at);

  const entries = [];
  starts.forEach((t, i) => {
    const section = body.slice(t.at, starts[i + 1]?.at ?? body.length);
    const pdf = /\bhref="([^"]*\/uploads\/rozvrh\/pdf\/parts\/[^"/]+\.pdf)"/i.exec(section)?.[1];
    const png = /\bsrc="([^"]*\/uploads\/rozvrh\/parts\/[^"/]+\.png)"/i.exec(section)?.[1];
    if (!pdf && !png) return;
    const heading = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(section);
    const title = (heading && decodeText(heading[1])) || t.title;
    entries.push({ id: t.id, title, pdf: pdf ? absolute(pdf) : null, png: png ? absolute(png) : null });
  });
  return entries;
}

function absolute(href) {
  return new URL(href, SITE).href;
}

/** "Bc1JCF2" → { prefix: "Bc1", code: "JCF", digits: "2" }; "Ing1UciF" → code "UciF", digits "". */
export function splitId(id) {
  const m = /^([A-Za-z]+\d)([A-Za-z_]*?[A-Za-z_])(\d*)$/.exec(id);
  return m ? { prefix: m[1], code: m[2], digits: m[3] } : null;
}

/** Program name without the kruh/year suffix: "Jaderná a částicová fyzika 2. kruh" → "Jaderná a částicová fyzika". */
export function programName(title) {
  return title
    .replace(/\s*,?\s*\d+\.\s*kruh\s*$/i, '')
    .replace(/\s*,\s*\d+\.\s*ročník.*$/i, '')
    .trim();
}

function kruhNumber(title, digits) {
  const m = /(\d+)\.\s*kruh\s*$/i.exec(title);
  if (m) return Number(m[1]);
  return digits ? Number(digits) : null;
}

/**
 * Builds the manifest's year list from the parsed pages.
 *
 * A page whose entries all share one year prefix ("Bc1", "Ing2") is a year
 * of its own (bs1 … nms2). Entries of mixed pages (Děčín, učitelství span
 * several years) are filed under the year with their prefix, so the user
 * finds them by ročník; a mixed page with no matching year stays a group
 * of its own. Kruh is null when the program has a single timetable in that
 * year (the official timetable then shows no kruh), otherwise the number.
 *
 * `files(entry)` decides the downloaded file (name and source URL) for an
 * entry, or null to leave it out.
 *
 * @param {{ slug: string, title: string, entries: ReturnType<typeof parsePage> }[]} pages
 * @param {(entry: ReturnType<typeof parsePage>[number]) => { file: string, url: string } | null} pick
 */
export function buildYears(pages, pick) {
  const years = [];
  const byPrefix = new Map();
  const mixed = [];

  // Pages titled "N. ročník …" claim their year first, whatever the nav order.
  const ordered = [...pages.filter((p) => YEAR_TITLE.test(p.title)), ...pages.filter((p) => !YEAR_TITLE.test(p.title))];
  for (const page of ordered) {
    const prefixes = new Set(page.entries.map((e) => splitId(e.id)?.prefix ?? '?'));
    if (!page.entries.length) continue;
    if (prefixes.size === 1 && !prefixes.has('?') && !byPrefix.has([...prefixes][0])) {
      const prefix = [...prefixes][0];
      const year = { id: page.slug, label: shortYearLabel(page.title), title: page.title, url: `${SITE}/rozvrh/studenti/${page.slug}`, prefix, items: [] };
      for (const e of page.entries) year.items.push({ entry: e, page: page.slug });
      byPrefix.set(prefix, year);
      years.push(year);
    } else {
      mixed.push(page);
    }
  }
  for (const page of mixed) {
    let own = null;
    for (const e of page.entries) {
      const target = byPrefix.get(splitId(e.id)?.prefix ?? '');
      if (target) {
        target.items.push({ entry: e, page: page.slug });
        continue;
      }
      own ??= { id: page.slug, label: shortYearLabel(page.title), title: page.title, url: `${SITE}/rozvrh/studenti/${page.slug}`, prefix: null, items: [] };
      own.items.push({ entry: e, page: page.slug, keepTitle: true });
    }
    if (own) years.push(own);
  }

  const ids = new Set();
  const navOrder = (y) => pages.findIndex((p) => p.slug === y.id);
  return years
    .sort((a, b) => navOrder(a) - navOrder(b))
    .map((year) => {
      const programs = new Map();
      for (const { entry, page, keepTitle } of year.items) {
        if (ids.has(entry.id)) throw new Error(`Duplicate timetable ID ${entry.id}`);
        ids.add(entry.id);
        const file = pick(entry);
        if (!file) continue;
        const parts = splitId(entry.id);
        const code = keepTitle || !parts ? entry.id : parts.code;
        const key = `${page}\u0000${code}`;
        let program = programs.get(key);
        if (!program) {
          program = { code, name: keepTitle ? entry.title : programName(entry.title), page, kruhs: [] };
          programs.set(key, program);
        }
        program.kruhs.push({ kruh: kruhNumber(entry.title, parts?.digits ?? ''), id: entry.id, file: file.file, url: file.url });
      }
      const list = [...programs.values()];
      for (const p of list) {
        if (p.kruhs.length === 1) p.kruhs[0].kruh = null;
        else {
          p.kruhs.forEach((k, i) => (k.kruh ??= i + 1));
          p.kruhs.sort((a, b) => a.kruh - b.kruh);
        }
      }
      list.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
      return { id: year.id, label: year.label, title: year.title, url: year.url, prefix: year.prefix, programs: list };
    })
    .filter((y) => y.programs.length);
}

/**
 * Bachelor program codes as the app's PROGRAMS list uses them: programs of
 * the bachelor year pages themselves ("Bc<year>" prefix), not entries filed
 * there from other pages (Děčín).
 */
export function bachelorCodes(years) {
  const codes = new Set();
  for (const y of years) {
    if (!y.prefix || !/^bc/i.test(y.prefix)) continue;
    for (const p of y.programs) if (p.page === y.id) codes.add(p.code);
  }
  return [...codes].sort();
}

/** Program codes of `PROGRAMS` in src/config.ts, read from its source text. */
export function configProgramCodes(source) {
  const start = source.search(/export const PROGRAMS\b/);
  if (start < 0) throw new Error('PROGRAMS not found in src/config.ts');
  const end = source.indexOf('];', start);
  const block = source.slice(start, end < 0 ? undefined : end);
  return [...block.matchAll(/\bcode:\s*'([^']+)'/g)].map((m) => m[1]).sort();
}

/** Differences between the app's program codes and the website's. */
export function programDrift(appCodes, siteCodes) {
  const app = new Set(appCodes);
  const site = new Set(siteCodes);
  return {
    added: [...site].filter((c) => !app.has(c)).sort(),
    removed: [...app].filter((c) => !site.has(c)).sort(),
  };
}
