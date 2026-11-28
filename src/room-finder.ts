/**
 * UI of "Volné učebny": a teacher picks the weekday, start and length, and
 * sees which rooms are free for the whole time. Nothing in the timetable
 * changes.
 */
import { DAYS } from './config';
import { closeOnBackdropClick } from './dialog';
import { h } from './dom';
import { slotLabel } from './finder';
import { formatHour, maxDuration, startHours, type Lesson } from './model';
import type { CatalogTimetable } from './replacements';
import { capacityLabel, findFreeRooms, groupByBuilding, ownClashes, roomDescription, type KnownRoom } from './rooms';
import './finder.css';
import './room-finder.css';

function countLabel(n: number, one: string, few: string, many: string): string {
  return `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
}

/** Opens the dialog; resolves when it is closed. */
export function openRoomFinder(lessons: readonly Lesson[]): Promise<void> {
  return new Promise((resolve) => {
    const abort = new AbortController();
    let catalog: { timetables: CatalogTimetable[]; failed: number } | null = null;
    let loadError = '';
    let progress = '';
    /** Whether the teacher unfolded the busy rooms; kept while the time changes. */
    let busyOpen = false;

    const day = h('select', { name: 'day' }, ...DAYS.map((d, i) => h('option', { value: i, selected: i === 0 }, d)));
    const start = h('select', { name: 'start' }, ...startHours().map((hour) => h('option', { value: hour, selected: hour === 10 }, formatHour(hour))));
    const duration = h('select', { name: 'duration' });
    const fillDurations = (selected: number) => {
      const max = maxDuration(Number(start.value));
      duration.replaceChildren();
      for (let d = 1; d <= max; d++) duration.append(h('option', { value: d, selected: d === Math.min(selected, max) }, `${d} h`));
    };
    fillDurations(2);

    const slot = () => ({ day: Number(day.value), start: Number(start.value), duration: Number(duration.value) });

    const field = (label: string, control: HTMLElement) => h('label', { class: 'field' }, h('span', {}, label), control);
    const clash = h('p', { class: 'rooms-clash', hidden: true });
    const results = h('div', { class: 'rooms-results' });
    // One short line for screen readers instead of re-reading the whole list on every change.
    const announce = h('p', { class: 'rooms-announce', role: 'status', 'aria-live': 'polite' });
    const closeBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Zavřít');

    const roomItem = (room: KnownRoom) => h(
      'li',
      { class: 'rooms-item', 'data-room': room.code },
      h('span', { class: 'rooms-code' }, room.code),
      h('span', { class: 'rooms-line' }, roomDescription(room)),
      room.capacity ? h('span', { class: 'rooms-line rooms-meta' }, capacityLabel(room.capacity)) : null,
    );

    const render = () => {
      const s = slot();
      const mine = ownClashes(lessons, s);
      clash.hidden = !mine.length;
      clash.textContent = mine.length
        ? `V tomto čase máš v rozvrhu ${[...new Set(mine.map((l) => l.subject || 'jinou hodinu'))].join(', ')}`
        : '';

      if (!catalog) {
        const retry = loadError ? h('button', { type: 'button', class: 'btn' }, 'Zkusit znovu') : null;
        retry?.addEventListener('click', () => void load());
        const message = loadError || progress || 'Načítám rozvrhy…';
        results.replaceChildren(h('p', { class: `status${loadError ? ' finder-error' : ''}` }, message), retry ?? '');
        if (!progress || loadError) announce.textContent = message;
        return;
      }

      const { free, busy } = findFreeRooms(s, catalog.timetables);
      const heading = h(
        'h3',
        { class: 'rooms-head' },
        free.length ? countLabel(free.length, 'volná učebna', 'volné učebny', 'volných učeben') : 'Žádná volná učebna',
        h('span', { class: 'rooms-when' }, slotLabel(s)),
      );
      const freeSection = free.length
        ? h(
          'div',
          { class: 'rooms-groups' },
          ...groupByBuilding(free).map((group) => h(
            'section',
            { class: 'rooms-group', 'aria-label': group.building },
            h('h4', {}, group.building),
            h('ul', { class: 'rooms-list' }, ...group.rooms.map(roomItem)),
          )),
        )
        : h('p', { class: 'finder-empty rooms-empty' }, 'V tomto čase jsou všechny učebny obsazené. Zkus jiný den, začátek nebo kratší délku.');

      let busySection: HTMLDetailsElement | null = null;
      if (busy.length) {
        const details = h(
          'details',
          { class: 'finder-clashes rooms-busy', open: busyOpen || !free.length },
          h('summary', {}, countLabel(busy.length, 'obsazená učebna', 'obsazené učebny', 'obsazených učeben')),
          h(
            'ul',
            { class: 'rooms-busy-list' },
            ...busy.map(({ room, uses }) => h(
              'li',
              { 'data-room': room.code },
              h('strong', {}, room.code),
              ' ',
              uses.map((u) => `${u.subject || 'hodina'} ${formatHour(u.start)}–${formatHour(u.start + u.duration)}${u.sources.length ? ` (${u.sources.join(', ')})` : ''}`).join('; '),
            )),
          ),
        );
        details.addEventListener('toggle', () => { if (free.length) busyOpen = details.open; });
        busySection = details;
      }
      announce.textContent = `${heading.firstChild?.textContent ?? ''}, ${slotLabel(s)}`;
      results.replaceChildren(
        heading,
        freeSection,
        busySection ?? '',
        catalog.failed ? h('p', { class: 'finder-note' }, `${countLabel(catalog.failed, 'rozvrh se nepodařilo načíst', 'rozvrhy se nepodařilo načíst', 'rozvrhů se nepodařilo načíst')}, některé obsazené učebny proto mohou vypadat volně.`) : '',
      );
    };

    const load = async () => {
      loadError = '';
      progress = '';
      render();
      try {
        const { loadCatalog } = await import('./import/catalog');
        catalog = await loadCatalog((done, total) => {
          progress = `Načítám rozvrhy… ${done}/${total}`;
          if (!catalog) render();
        }, abort.signal);
      } catch (err) {
        if (abort.signal.aborted) return;
        loadError = err instanceof Error ? err.message : 'Rozvrhy se nepodařilo načíst.';
      }
      render();
    };

    day.addEventListener('change', render);
    start.addEventListener('change', () => {
      fillDurations(Number(duration.value));
      render();
    });
    duration.addEventListener('change', render);

    const form = h(
      'form',
      { method: 'dialog', class: 'lesson-form finder-form rooms-form' },
      h('h2', {}, 'Volné učebny'),
      h('div', { class: 'field-row field-row--3' }, field('Den', day), field('Začátek', start), field('Délka', duration)),
      clash,
      results,
      announce,
      h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }), closeBtn),
    );
    form.addEventListener('submit', (event) => event.preventDefault());
    const dialog = h('dialog', { class: 'lesson-dialog finder-dialog rooms-dialog', 'aria-label': 'Volné učebny' }, form);
    closeBtn.addEventListener('click', () => dialog.close());
    closeOnBackdropClick(dialog);
    dialog.addEventListener('close', () => {
      abort.abort();
      dialog.remove();
      resolve();
    });

    document.body.append(dialog);
    dialog.showModal();
    day.focus();
    void load();
  });
}
