import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { loadCatalog } from '../src/import/catalog';
import { normalizeLesson, type Lesson, type LessonDraft } from '../src/model';
import { findReplacements, sourceNames, subjectKey, type CatalogTimetable } from '../src/replacements';
import { saveState } from '../src/storage';

const draft = (day: number, start: number, duration: number, subject: string, room = '', lecturer = ''): LessonDraft =>
  ({ day, start, duration, subject, room, lecturer, color: 'green' });
const lesson = (id: string, ...args: Parameters<typeof draft>): Lesson => normalizeLesson({ id, ...draft(...args) });

describe('findReplacements', () => {
  const own = [
    lesson('man-cv', 0, 10, 2, 'MAN1cv', 'T-201'),
    lesson('fy', 3, 14, 2, 'FY1'),
    lesson('lal', 1, 8, 2, 'LAL1'),
  ];
  const skipped = own[0]!;

  it('matches the very same course code, ignoring spaces and case but not suffixes', () => {
    expect(subjectKey(' MAN1 cv ')).toBe(subjectKey('man1cv'));
    const catalog: CatalogTimetable[] = [{ id: 'Bc1JCF2', short: 'JCF2', label: 'JCF2', lessons: [
      draft(2, 12, 2, 'man1 CV', 'B-111', 'R. Šíma'),
      draft(2, 8, 2, 'MAN1'),
      draft(2, 16, 2, 'MAN1cv.rez'),
    ] }];
    expect(findReplacements(own, skipped, catalog).map((o) => [o.subject, o.room])).toEqual([['man1 CV', 'B-111']]);
  });

  it('marks clashes with own lessons, the skipped one included, and merges timetables sharing a lesson', () => {
    const catalog: CatalogTimetable[] = [
      { id: 'Bc1JCF1', short: 'JCF1', label: '1. ročník Bc. – JCF, 1. kruh', lessons: [draft(0, 10, 2, 'MAN1cv', 'T-201'), draft(3, 15, 2, 'MAN1cv', 'B-111')] },
      { id: 'Bc1JCF2', short: 'JCF2', label: '1. ročník Bc. – JCF, 2. kruh', lessons: [draft(0, 11, 2, 'MAN1cv', 'B-111'), draft(4, 8, 2, 'MAN1cv', 'B-111', 'R. Šíma')] },
      { id: 'Bc2JCF', short: 'JCF', label: '2. ročník Bc. – JCF', lessons: [draft(4, 8, 2, 'MAN1cv', 'b-111 ', 'R. Šíma')] },
    ];
    const options = findReplacements(own, skipped, catalog);
    // Monday 10–12 is the student's own lesson and is left out.
    expect(options.map((o) => [o.day, o.start, o.clashes.map((c) => c.id), o.sources.map((s) => s.id)])).toEqual([
      [0, 11, ['man-cv'], ['Bc1JCF2']],
      [3, 15, ['fy'], ['Bc1JCF1']],
      [4, 8, [], ['Bc1JCF2', 'Bc2JCF']],
    ]);
    expect(sourceNames(options[2]!)).toBe('JCF2, JCF');
  });

  it('finds nothing for an untitled lesson', () => {
    expect(findReplacements(own, lesson('x', 0, 8, 1, ''), [{ id: 'a', short: 'a', label: 'a', lessons: [draft(1, 8, 1, '')] }])).toEqual([]);
  });
});

const manifest = (files: string[]) => ({
  version: 2,
  generatedAt: '2026-11-24T05:17:00Z',
  years: [
    { id: 'bs1', label: '1. ročník Bc.', programs: [{ code: 'JCF', name: 'Jaderná a částicová fyzika', kruhs: [
      { kruh: 1, id: 'Bc1JCF1', file: files[0] },
      { kruh: 2, id: 'Bc1JCF2', file: files[1] },
    ] }] },
    { id: 'bs2', label: '2. ročník Bc.', programs: [{ code: 'JCF', name: 'Jaderná a částicová fyzika', kruhs: [
      { kruh: null, id: 'Bc2JCF', file: files[2] },
    ] }] },
  ],
});

function stubCatalog(files: string[], broken = new Set<string>()) {
  const lessons: Record<string, LessonDraft[]> = {
    Bc1JCF1: [draft(0, 10, 2, 'MAN1cv', 'T-201')],
    Bc1JCF2: [draft(2, 12, 2, 'MAN1cv', 'B-111', 'R. Šíma'), draft(0, 8, 2, 'MAN1')],
    Bc2JCF: [draft(1, 8, 2, 'MAN1cv', 'B-111')],
  };
  const ids = ['Bc1JCF1', 'Bc1JCF2', 'Bc2JCF'];
  const fetcher = vi.fn(async (url: URL | string) => {
    const path = String(url);
    if (path.endsWith('manifest.json')) return Response.json(manifest(files));
    const index = files.findIndex((f) => path.endsWith(`/${f}`));
    if (broken.has(files[index]!)) return new Response('nope', { status: 500 });
    return Response.json({ version: 1, id: ids[index], specId: 'JCF', lessons: lessons[ids[index]!] });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('loadCatalog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads every timetable of every year, reports progress and keeps them for the page visit', async () => {
    const files = ['c1-a.json', 'c2-a.json', 'c3-a.json'];
    const fetcher = stubCatalog(files, new Set(['c3-a.json']));
    const progress: string[] = [];
    const catalog = await loadCatalog((done, total) => progress.push(`${done}/${total}`));
    expect(catalog.timetables.map((t) => [t.id, t.label])).toEqual([
      ['Bc1JCF1', '1. ročník Bc. – Jaderná a částicová fyzika, 1. kruh'],
      ['Bc1JCF2', '1. ročník Bc. – Jaderná a částicová fyzika, 2. kruh'],
    ]);
    expect(catalog.failed).toBe(1);
    expect(progress[0]).toBe('0/3');
    expect(progress.at(-1)).toBe('3/3');

    fetcher.mockClear();
    await loadCatalog();
    // Only the manifest and the file that failed before are requested again.
    expect(fetcher.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual(['manifest.json', 'c3-a.json']);
  });

  it('fails when no timetable can be loaded', async () => {
    const files = ['d1-a.json', 'd2-a.json', 'd3-a.json'];
    stubCatalog(files, new Set(files));
    await expect(loadCatalog()).rejects.toThrow(/nepodařilo stáhnout/);
  });
});

describe('Nahradit hodinu', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('highlights the same course from other timetables over the active timetable', async () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.dispatchEvent(new Event('close')); };
    stubCatalog(['e1-a.json', 'e2-a.json', 'e3-a.json']);
    localStorage.clear();
    const own = [lesson('cv', 0, 10, 2, 'MAN1cv', 'T-201'), lesson('lal', 1, 8, 2, 'LAL1')];
    saveState({ schedules: [{ id: 's1', name: '', specId: 'JCF1', lessons: own, updatedAt: 0 }], activeId: 's1' });
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.append(root);
    new App(root);

    [...root.querySelectorAll<HTMLButtonElement>('.toolbar button')].find((b) => b.textContent === 'Nahradit hodinu')!.click();
    await vi.waitFor(() => expect(document.querySelector('dialog .finder-choices')).not.toBeNull());
    // Only lessons with a subject are offered, by day and time.
    expect([...document.querySelectorAll('.finder-choice-code')].map((el) => el.textContent)).toEqual(['MAN1cv', 'LAL1']);
    document.querySelector<HTMLFormElement>('dialog form')!.requestSubmit();
    await vi.waitFor(() => expect(root.querySelector('.finder-panel')).not.toBeNull());
    expect(document.querySelector('dialog')).toBeNull();

    const alts = [...root.querySelectorAll<HTMLElement>('.alt')];
    expect(alts.map((el) => [el.closest<HTMLElement>('.track')!.dataset.day, el.className.includes('alt--free')])).toEqual([
      ['1', false], // Tuesday 8–10 clashes with LAL1.
      ['2', true],
    ]);
    expect(root.querySelector('[data-lesson-id="cv"]')!.className).toContain('lesson--skipped');
    expect(root.querySelector('[data-lesson-id="lal"]')!.className).toContain('lesson--muted');
    expect(root.querySelector('.finder-subhead')!.textContent).toBe('1 volný termín');
    // The block shows the teacher and room; the list names timetables by abbreviation, without the year.
    expect(alts[1]!.querySelector('.alt-meta')!.textContent).toBe('R. ŠímaB-111');
    expect([...root.querySelectorAll('.finder-list:not(.finder-clashes *) .finder-item-line')].map((el) => el.textContent))
      .toEqual(['R. Šíma · B-111', 'JCF2']);
    // Clashes are folded away until asked for.
    const clashes = root.querySelector<HTMLDetailsElement>('.finder-clashes')!;
    expect(clashes.open).toBe(false);
    expect(clashes.querySelector('summary')!.textContent).toBe('1 termín v kolizi');
    expect(clashes.querySelector('.finder-item-clash')!.textContent).toBe('Koliduje s LAL1');
    expect(root.querySelectorAll('.alt-window')).toHaveLength(0);

    // Selecting on the timetable highlights the entry in the list.
    alts[1]!.click();
    const key = root.querySelector<HTMLElement>('.alt[aria-pressed="true"]')!.dataset.optionKey;
    const item = [...root.querySelectorAll<HTMLElement>('.finder-item')].find((el) => el.dataset.optionKey === key)!;
    expect(item.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('.finder-item[aria-pressed="true"]')).toHaveLength(1);
    expect(root.querySelectorAll('.alt-window')).toHaveLength(1);
    // Selecting a clash on the timetable unfolds the clash list.
    root.querySelectorAll<HTMLElement>('.alt')[0]!.click();
    expect(root.querySelector<HTMLDetailsElement>('.finder-clashes')!.open).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('.finder-panel')).toBeNull();
    expect(root.querySelector('.alt')).toBeNull();
    expect(root.querySelector('.board--finder')).toBeNull();
  });
});
