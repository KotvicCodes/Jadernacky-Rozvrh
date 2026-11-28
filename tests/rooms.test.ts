import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { normalizeLesson, type Lesson, type LessonDraft } from '../src/model';
import type { CatalogTimetable } from '../src/replacements';
import { FINDER_ROOMS, capacityLabel, findFreeRooms, groupByBuilding, ownClashes, roomDescription, roomKey, type KnownRoom } from '../src/rooms';
import { loadState, saveState } from '../src/storage';

const draft = (day: number, start: number, duration: number, subject: string, room = '', lecturer = ''): LessonDraft =>
  ({ day, start, duration, subject, room, lecturer, color: 'green' });
const lesson = (id: string, ...args: Parameters<typeof draft>): Lesson => normalizeLesson({ id, ...draft(...args) });
const room = (code: string, building = 'Trojanova', capacity = '30'): KnownRoom => ({ code, description: 'učebna', building, capacity });

const ROOMS = [room('T-201', 'Trojanova', '155'), room('T-209'), room('B-103', 'Břehová', '180'), room('B-115', 'Břehová')];
const codes = (rooms: readonly KnownRoom[]) => rooms.map((r) => r.code);

describe('findFreeRooms', () => {
  const catalog: CatalogTimetable[] = [
    { id: 'Bc1JCF1', short: 'JCF1', label: 'JCF1', lessons: [draft(0, 10, 2, 'MAN1', 'T-201', 'Kůs'), draft(0, 13, 1, 'FY1cv', 'b-103')] },
    { id: 'Bc1JCF2', short: 'JCF2', label: 'JCF2', lessons: [draft(0, 10, 2, 'MAN1', 'T-201', 'Kůs'), draft(1, 10, 2, 'LAL1', 'T-209')] },
  ];

  it('treats a room as busy when any lesson overlaps any part of the requested time', () => {
    // Monday 11–13 overlaps MAN1 (10–12) by its first hour; FY1cv starts right when it ends.
    const result = findFreeRooms({ day: 0, start: 11, duration: 2 }, catalog, ROOMS);
    expect(codes(result.free)).toEqual(['T-209', 'B-103', 'B-115']);
    expect(result.busy.map((b) => [b.room.code, b.uses.map((u) => [u.subject, u.start, u.sources])])).toEqual([
      ['T-201', [['MAN1', 10, ['JCF1', 'JCF2']]]],
    ]);
    // A lesson that only touches the requested time does not block it.
    expect(codes(findFreeRooms({ day: 0, start: 12, duration: 1 }, catalog, ROOMS).free)).toEqual(codes(ROOMS));
    // Another weekday is independent.
    expect(codes(findFreeRooms({ day: 1, start: 8, duration: 4 }, catalog, ROOMS).free)).toEqual(['T-201', 'B-103', 'B-115']);
  });

  it('matches room codes regardless of case, spaces and dashes, and reads lessons held in two rooms', () => {
    expect(roomKey(' t 209 ')).toBe(roomKey('T-209'));
    const shared: CatalogTimetable[] = [{ id: 'x', short: 'X', label: 'X', lessons: [draft(2, 9, 2, 'PRA', 'T 209, B-115')] }];
    const result = findFreeRooms({ day: 2, start: 9, duration: 1 }, shared, ROOMS);
    expect(codes(result.busy.map((b) => b.room))).toEqual(['T-209', 'B-115']);
  });

  it('reports every room busy when nothing is free', () => {
    const full: CatalogTimetable[] = [{ id: 'x', short: 'X', label: 'X', lessons: ROOMS.map((r) => draft(3, 8, 4, 'X', r.code)) }];
    const result = findFreeRooms({ day: 3, start: 9, duration: 1 }, full, ROOMS);
    expect(result.free).toEqual([]);
    expect(result.busy).toHaveLength(ROOMS.length);
  });

  it('offers FJFI rooms in Prague only', () => {
    expect(codes(FINDER_ROOMS)).toEqual(expect.arrayContaining(['T-209', 'B-103', 'KJR-L144']));
    expect(FINDER_ROOMS.some((r) => /děčín/i.test(r.building))).toBe(false);
    // Rooms of other faculties cannot be booked and their use is not on our timetables.
    expect(codes(FINDER_ROOMS)).not.toContain('CH1');
  });
});

describe('room helpers', () => {
  it('labels capacities and groups rooms by building in list order', () => {
    expect(capacityLabel('40')).toBe('40 míst');
    expect(capacityLabel('cca 20')).toBe('cca 20 míst');
    expect(capacityLabel('17-20')).toBe('17-20 míst');
    expect(capacityLabel('20 míst, 16 PC')).toBe('20 míst, 16 PC');
    expect(capacityLabel('')).toBe('');
    expect(groupByBuilding(ROOMS).map((g) => [g.building, codes(g.rooms)])).toEqual([
      ['Trojanova', ['T-201', 'T-209']],
      ['Břehová', ['B-103', 'B-115']],
    ]);
  });

  it('drops the room number a description repeats from the code, and keeps other numbers', () => {
    const text = (code: string, description: string) => roomDescription({ code, description });
    expect(text('B-114', 'učebna 114')).toBe('učebna');
    expect(text('B-10', 'učebna 010')).toBe('učebna');
    expect(text('B-009', 'počítačová učebna 009')).toBe('počítačová učebna');
    expect(text('B-115', 'Aula reserva (učebna 115)')).toBe('Aula reserva');
    expect(text('B-103', 'Aula maxima (velká posluchárna)')).toBe('Aula maxima (velká posluchárna)');
    expect(text('KMAT-L', 'laboratoř zkoušení kovů KMAT, T-023')).toBe('laboratoř zkoušení kovů KMAT, T-023');
    expect(text('T-209', 'učebna 210')).toBe('učebna 210');
    // A description that is only the number stays as published.
    expect(text('T-014', '014')).toBe('014');
  });

  it('finds the own lessons at that time', () => {
    const own = [lesson('a', 0, 10, 2, 'MAN1'), lesson('b', 0, 12, 2, 'FY1'), lesson('c', 1, 10, 2, 'LAL1')];
    expect(ownClashes(own, { day: 0, start: 11, duration: 2 }).map((l) => l.id)).toEqual(['a', 'b']);
  });
});

describe('Volné učebny dialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubCatalog(file: string, lessons: LessonDraft[]) {
    vi.stubGlobal('fetch', vi.fn(async (url: URL | string) => {
      const path = String(url);
      if (path.endsWith('manifest.json')) {
        return Response.json({
          version: 2,
          generatedAt: '2026-11-24T05:17:00Z',
          years: [{ id: 'bs1', label: '1. ročník Bc.', programs: [{ code: 'JCF', name: 'Jaderná a částicová fyzika', kruhs: [{ kruh: null, id: 'Bc1JCF', file }] }] }],
        });
      }
      return Response.json({ version: 1, id: 'Bc1JCF', specId: 'JCF', lessons });
    }));
  }

  async function open(file: string, catalogLessons: LessonDraft[], own: Lesson[]) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
    stubCatalog(file, catalogLessons);
    localStorage.clear();
    saveState({ schedules: [{ id: 's1', name: '', specId: 'JCF1', lessons: own, updatedAt: 0 }], activeId: 's1' });
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.append(root);
    new App(root);
    root.querySelector<HTMLButtonElement>('.btn-rooms')!.click();
    await vi.waitFor(() => expect(document.querySelector('.rooms-dialog .rooms-head')).not.toBeNull());
    const dialog = document.querySelector<HTMLDialogElement>('.rooms-dialog')!;
    const select = (name: string, value: string | number) => {
      const el = dialog.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
      el.value = String(value);
      el.dispatchEvent(new Event('change'));
    };
    const free = () => [...dialog.querySelectorAll<HTMLElement>('.rooms-list .rooms-item')].map((el) => el.dataset.room);
    const busy = () => [...dialog.querySelectorAll<HTMLElement>('.rooms-busy-list li')].map((el) => el.dataset.room);
    return { root, dialog, select, free, busy };
  }

  it('lists free rooms for the whole chosen time, leaves out busy ones, and keeps the timetable unchanged', async () => {
    const own = [lesson('man', 0, 10, 2, 'MAN1', 'T-201', 'Kůs'), lesson('fy', 1, 12, 2, 'FY1')];
    const { dialog, select, free, busy } = await open('rooms-a.json', [
      draft(0, 10, 2, 'MAN1', 'T-201', 'Kůs'),
      draft(2, 9, 2, 'LAL1', 'T-209'),
      draft(2, 12, 1, 'FY1cv', 'B-103'),
    ], own);
    expect(dialog.querySelector('.hint, .finder-note')).toBeNull();
    expect(dialog.querySelector('select[name="lesson"]')).toBeNull();

    // Wednesday 10–12: LAL1 (9–11) blocks T-209 for the first hour; FY1cv starts after.
    select('day', 2);
    select('start', 10);
    select('duration', 2);
    expect(free()).not.toContain('T-209');
    expect(free()).toEqual(expect.arrayContaining(['T-201', 'B-103']));
    expect(busy()).toEqual(['T-209']);
    expect(dialog.querySelector('.rooms-busy-list li')!.textContent).toBe('T-209 LAL1 9:00–11:00 (JCF)');
    expect(dialog.querySelector('.rooms-head')!.textContent).toContain('Středa 10:00–12:00');
    // Three hours reach FY1cv in B-103 too.
    select('duration', 3);
    expect(busy()).toEqual(['B-103', 'T-209']);

    // A time that clashes with another own lesson is pointed out.
    select('day', 1);
    select('start', 12);
    expect(dialog.querySelector<HTMLElement>('.rooms-clash')!.hidden).toBe(false);
    expect(dialog.querySelector('.rooms-clash')!.textContent).toBe('V tomto čase máš v rozvrhu FY1');

    [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Zavřít')!.click();
    expect(document.querySelector('.rooms-dialog')).toBeNull();
    expect(loadState().schedules[0]!.lessons).toEqual(own);
  });

  it('says so when no room is free and lets the teacher choose another time', async () => {
    const { dialog, select, free } = await open('rooms-b.json', FINDER_ROOMS.map((r) => draft(4, 8, 4, 'X', r.code)), []);
    select('day', 4);
    select('start', 9);
    select('duration', 1);
    expect(free()).toEqual([]);
    expect(dialog.querySelector('.rooms-head')!.textContent).toContain('Žádná volná učebna');
    expect(dialog.querySelector('.rooms-empty')!.textContent).toMatch(/Zkus jiný den/);
    expect(dialog.querySelector<HTMLDetailsElement>('.rooms-busy')!.open).toBe(true);
    select('start', 12);
    expect(free()).toHaveLength(FINDER_ROOMS.length);
  });
});
