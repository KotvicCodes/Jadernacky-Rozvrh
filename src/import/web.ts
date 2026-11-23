/**
 * "Importovat z webu FJFI": picks an official timetable from the copy of
 * rozvrh.fjfi.cvut.cz that scripts/preprocess-fjfi.mjs puts next to the app
 * (public/fjfi/). The site itself sends no CORS headers, so the app cannot
 * fetch from it directly.
 */
import { closeOnBackdropClick } from '../dialog';
import { h } from '../dom';
import { createSchedule, normalizeLesson, type Schedule } from '../model';
import { parseOfficialTimetable } from './official-data';
import '../web-import.css';

export interface FjfiKruh {
  /** Kruh number, or null when the program has a single timetable that year. */
  kruh: number | null;
  /** Official ID, e.g. "Bc1JCF2". */
  id: string;
  /** Preprocessed JSON path relative to manifest.json. */
  file: string;
}

export interface FjfiProgram {
  code: string;
  name: string;
  kruhs: FjfiKruh[];
}

export interface FjfiYear {
  id: string;
  /** Short label, e.g. "1. ročník Bc.". */
  label: string;
  programs: FjfiProgram[];
}

export interface FjfiManifest {
  generatedAt: Date;
  source: string;
  years: FjfiYear[];
}

export interface FjfiProgramGroup {
  name: string;
  programs: FjfiProgram[];
}

/** Split the faculty's labels without guessing relationships from program codes. */
export function splitProgramName(name: string): { program: string; specialization: string | null } {
  const parts = /^(.*?),\s*(?:spec\.|specializace)\s+(.+)$/i.exec(name);
  return parts
    ? { program: parts[1]!.trim(), specialization: parts[2]!.trim() }
    : { program: name, specialization: null };
}

/** Keep the individual timetable entries under their shared program name. */
export function groupPrograms(programs: FjfiProgram[]): FjfiProgramGroup[] {
  const groups = new Map<string, FjfiProgramGroup>();
  for (const program of programs) {
    const { program: name } = splitProgramName(program.name);
    let group = groups.get(name);
    if (!group) {
      group = { name, programs: [] };
      groups.set(name, group);
    }
    group.programs.push(program);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
}

export const MANIFEST_PATH = 'fjfi/manifest.json';
const SAFE_FILE = /^[A-Za-z0-9_-]+\.json$/;

export class ManifestError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Validates manifest.json (written by scripts/preprocess-fjfi.mjs) and keeps only the fields the dialog uses. */
export function parseManifest(json: unknown): FjfiManifest {
  const fail = (what: string): never => {
    throw new ManifestError(`Neplatný seznam rozvrhů (${what}).`);
  };
  if (!isObject(json)) return fail('není objekt');
  if (json.version !== 2) fail(`neznámá verze ${String(json.version)}`);
  const generatedAt = new Date(typeof json.generatedAt === 'string' ? json.generatedAt : NaN);
  if (Number.isNaN(generatedAt.getTime())) fail('chybí datum');
  if (!Array.isArray(json.years) || json.years.length === 0) return fail('žádné ročníky');

  const years = json.years.map((y, yi): FjfiYear => {
    if (!isObject(y) || !nonEmpty(y.id) || !nonEmpty(y.label) || !Array.isArray(y.programs) || !y.programs.length) {
      return fail(`ročník ${yi + 1}`);
    }
    const programs = y.programs.map((p, pi): FjfiProgram => {
      if (!isObject(p) || !nonEmpty(p.code) || !nonEmpty(p.name) || !Array.isArray(p.kruhs) || !p.kruhs.length) {
        return fail(`${y.label}, obor ${pi + 1}`);
      }
      const kruhs = p.kruhs.map((k): FjfiKruh => {
        if (!isObject(k) || !nonEmpty(k.id) || typeof k.file !== 'string' || !SAFE_FILE.test(k.file)) return fail(`${p.name}: soubor`);
        const kruh = k.kruh === null ? null : Number.isInteger(k.kruh) && (k.kruh as number) >= 1 ? (k.kruh as number) : fail(`${p.name}: kruh`);
        return { kruh, id: k.id, file: k.file };
      });
      if (kruhs.length > 1 && kruhs.some((k) => k.kruh === null)) fail(`${p.name}: chybí číslo kruhu`);
      if (kruhs.length === 1 && kruhs[0]!.kruh !== null) kruhs[0]!.kruh = null;
      return { code: p.code, name: p.name, kruhs };
    });
    return { id: y.id, label: y.label, programs };
  });
  return { generatedAt, source: typeof json.source === 'string' ? json.source : 'https://rozvrh.fjfi.cvut.cz/', years };
}

/** Kruh choice for a program: hidden when it has a single timetable that year. */
export function kruhChoices(program: FjfiProgram): { visible: boolean; options: { value: string; label: string }[] } {
  const options = program.kruhs.map((k, i) => ({ value: String(i), label: k.kruh === null ? 'jediný kruh' : `${k.kruh}. kruh` }));
  return { visible: program.kruhs.length > 1, options };
}

/** "1. ročník Bc. – Jaderná a částicová fyzika, 2. kruh" (no kruh for single-kruh programs). */
export function timetableLabel(year: FjfiYear, program: FjfiProgram, kruh: FjfiKruh): string {
  const base = `${year.label} – ${program.name}`;
  return program.kruhs.length > 1 && kruh.kruh !== null ? `${base}, ${kruh.kruh}. kruh` : base;
}

/** Short name for the timetable's tab: "1. ročník Bc. – JCF2" ("… – FI_IPL" for a single kruh). */
export function timetableShortLabel(year: FjfiYear, program: FjfiProgram, kruh: FjfiKruh): string {
  return `${year.label} – ${program.code}${program.kruhs.length > 1 && kruh.kruh !== null ? kruh.kruh : ''}`;
}

/** "21. 11. 2026 5:17" */
export function formatSyncDate(date: Date): string {
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(date);
}

export function manifestUrl(): URL {
  return new URL(import.meta.env.BASE_URL + MANIFEST_PATH, window.location.href);
}

/** Loads and validates the manifest. Throws ManifestError with a Czech, user-facing message. */
export async function loadManifest(signal?: AbortSignal): Promise<FjfiManifest> {
  let res: Response;
  try {
    res = await fetch(manifestUrl(), { cache: 'no-cache', signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ManifestError('Seznam rozvrhů se nepodařilo načíst. Zkontroluj připojení k internetu a zkus to znovu.');
  }
  if (res.status === 404) {
    throw new ManifestError(
      import.meta.env.DEV
        ? 'Seznam rozvrhů z webu FJFI tu zatím není. Spusť npm run sync-fjfi a npm run preprocess-fjfi a obnov stránku.'
        : 'Seznam rozvrhů z webu FJFI tu zatím není. Zkus to prosím později, nebo rozvrh stáhni z rozvrh.fjfi.cvut.cz a importuj ho ze zařízení.',
    );
  }
  if (!res.ok) throw new ManifestError(`Seznam rozvrhů se nepodařilo načíst (HTTP ${res.status}).`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ManifestError('Seznam rozvrhů je poškozený.');
  }
  return parseManifest(json);
}

const LAST_CHOICE_KEY = 'jaderka-rozvrh:fjfi-import';

function readLastChoice(): { year?: string; program?: string; kruh?: number | null } {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LAST_CHOICE_KEY) ?? 'null');
    return isObject(v) ? (v as { year?: string; program?: string; kruh?: number | null }) : {};
  } catch {
    return {};
  }
}

function saveLastChoice(year: FjfiYear, program: FjfiProgram, kruh: FjfiKruh): void {
  try {
    localStorage.setItem(LAST_CHOICE_KEY, JSON.stringify({ year: year.id, program: program.code, kruh: kruh.kruh }));
  } catch {
    // Storage unavailable (private mode): just don't remember.
  }
}

export interface PickedTimetable {
  schedule: Schedule;
  label: string;
  /** Compact name for the tab, see timetableShortLabel. */
  shortLabel: string;
}

/** Opens the "Import from FJFI website" dialog. Resolves with the chosen preprocessed schedule, or null if cancelled. */
export async function pickFjfiTimetable(): Promise<PickedTimetable | null> {
  return new Promise((resolve) => {
    const abort = new AbortController();
    let result: PickedTimetable | null = null;

    const yearSelect = h('select', { name: 'year' });
    const programSelect = h('select', { name: 'program' });
    const specializationSelect = h('select', { name: 'specialization' });
    const kruhSelect = h('select', { name: 'kruh' });
    const field = (label: string, control: HTMLElement) => h('label', { class: 'field' }, h('span', {}, label), control);
    const specializationField = field('Specializace', specializationSelect);
    const kruhField = field('Kruh', kruhSelect);
    const fields = h(
      'div',
      { class: 'web-import-fields', hidden: true },
      field('Ročník', yearSelect),
      field('Obor', programSelect),
      specializationField,
      kruhField,
    );
    const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, 'Načítám seznam rozvrhů…');
    const synced = h('p', { class: 'hint web-import-synced', hidden: true });
    const cancelBtn = h('button', { type: 'button', class: 'btn' }, 'Zrušit');
    const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary', disabled: true }, 'Importovat');

    const form = h(
      'form',
      { method: 'dialog', class: 'lesson-form web-import-form' },
      h('h2', {}, 'Importovat z webu FJFI'),
      h('p', { class: 'hint' }, 'Web může dělat mírné chyby v rozpoznání textu'),
      fields,
      synced,
      status,
      h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }), cancelBtn, submitBtn),
    );
    const dialog = h('dialog', { class: 'lesson-dialog web-import-dialog', 'aria-label': 'Importovat z webu FJFI' }, form);

    let manifest: FjfiManifest | null = null;
    // Keep identities from the displayed choices: indices refer to different
    // programs/kruhs as soon as a parent select changes.
    let selectedProgram: string | undefined;
    let selectedKruh: number | null | undefined;
    let groups: FjfiProgramGroup[] = [];
    const currentYear = () => manifest?.years[Number(yearSelect.value)];
    const currentGroup = () => groups.find((group) => group.name === programSelect.value);
    const currentProgram = () => currentGroup()?.programs.find((program) => program.code === specializationSelect.value);
    const currentKruh = () => currentProgram()?.kruhs[Number(kruhSelect.value)];

    const fillKruhs = (wanted: number | null | undefined) => {
      const program = currentProgram();
      if (!program) return;
      const { visible, options } = kruhChoices(program);
      const index = Math.max(0, program.kruhs.findIndex((k) => k.kruh === wanted));
      kruhSelect.replaceChildren(...options.map((o, i) => h('option', { value: o.value, selected: i === index }, o.label)));
      kruhField.hidden = !visible;
      kruhSelect.disabled = !visible;
      selectedProgram = program.code;
      selectedKruh = program.kruhs[index]?.kruh;
    };
    const fillSpecializations = (wantedCode: string | undefined, wantedKruh: number | null | undefined) => {
      const group = currentGroup();
      if (!group) return;
      const chosen = group.programs.find((program) => program.code === wantedCode) ?? group.programs[0]!;
      specializationSelect.replaceChildren(...group.programs.map((program) => h('option', {
        value: program.code,
        selected: program === chosen,
      }, splitProgramName(program.name).specialization ?? 'Bez specializace')));
      specializationField.hidden = group.programs.every((program) => splitProgramName(program.name).specialization === null);
      specializationSelect.disabled = specializationField.hidden;
      fillKruhs(wantedKruh);
    };
    const fillPrograms = (wantedCode: string | undefined, wantedKruh: number | null | undefined) => {
      const year = currentYear();
      if (!year) return;
      groups = groupPrograms(year.programs);
      const chosen = groups.find((group) => group.programs.some((program) => program.code === wantedCode))
        ?? groups.find((group) => group.name === programSelect.value) ?? groups[0]!;
      programSelect.replaceChildren(...groups.map((group) => h('option', {
        value: group.name,
        selected: group === chosen,
      }, group.name)));
      fillSpecializations(wantedCode, wantedKruh);
    };
    yearSelect.addEventListener('change', () => fillPrograms(selectedProgram, selectedKruh));
    programSelect.addEventListener('change', () => fillSpecializations(selectedProgram, selectedKruh));
    specializationSelect.addEventListener('change', () => fillKruhs(selectedKruh));
    kruhSelect.addEventListener('change', () => {
      selectedKruh = currentKruh()?.kruh;
    });

    const busy = (on: boolean) => {
      for (const el of [yearSelect, programSelect, submitBtn]) el.disabled = on;
      specializationSelect.disabled = on || specializationField.hidden !== false;
      kruhSelect.disabled = on || kruhField.hidden !== false;
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const year = currentYear();
      const program = currentProgram();
      const kruh = currentKruh();
      if (!manifest || !year || !program || !kruh) return;
      busy(true);
      status.textContent = 'Stahuji rozvrh…';
      void (async () => {
        try {
          const res = await fetch(new URL(kruh.file, manifestUrl()), { signal: abort.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = parseOfficialTimetable(await res.json(), kruh.id);
          const shortLabel = timetableShortLabel(year, program, kruh);
          const schedule = createSchedule(data.specId, shortLabel);
          schedule.lessons = data.lessons.map((lesson) => normalizeLesson(lesson));
          saveLastChoice(year, program, kruh);
          result = {
            schedule,
            label: timetableLabel(year, program, kruh),
            shortLabel,
          };
          dialog.close();
        } catch {
          if (abort.signal.aborted) return;
          status.textContent = 'Rozvrh se nepodařilo stáhnout. Zkontroluj připojení k internetu a zkus to znovu.';
          busy(false);
        }
      })();
    });
    cancelBtn.addEventListener('click', () => dialog.close());
    closeOnBackdropClick(dialog);
    dialog.addEventListener('close', () => {
      abort.abort();
      dialog.remove();
      resolve(result);
    });

    document.body.append(dialog);
    dialog.showModal();

    loadManifest(abort.signal).then(
      (loaded) => {
        manifest = loaded;
        const last = readLastChoice();
        const yearIndex = Math.max(0, loaded.years.findIndex((y) => y.id === last.year));
        yearSelect.replaceChildren(...loaded.years.map((y, i) => h('option', { value: i, selected: i === yearIndex }, y.label)));
        fillPrograms(last.program, last.kruh);
        synced.textContent = `Aktualizováno: ${formatSyncDate(loaded.generatedAt)}`;
        synced.hidden = false;
        fields.hidden = false;
        status.textContent = '';
        submitBtn.disabled = false;
        yearSelect.focus();
      },
      (err: unknown) => {
        if (abort.signal.aborted) return;
        status.textContent = err instanceof ManifestError ? err.message : 'Seznam rozvrhů se nepodařilo načíst.';
        status.classList.add('web-import-error');
        submitBtn.hidden = true;
        cancelBtn.textContent = 'Zavřít';
        cancelBtn.focus();
      },
    );
  });
}
