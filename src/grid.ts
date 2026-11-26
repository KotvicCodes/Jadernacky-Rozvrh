import { DAYS, FIRST_HOUR, HOUR_COUNT, LAST_HOUR, paletteColor } from './config';
import { h } from './dom';
import { enablePointerDrag, type DragPoint } from './drag';
import { startInlineEdit } from './inline-edit';
import { formatHour, layoutDay, type Lesson, type Schedule } from './model';
import { sourceNames, type ReplacementOption } from './replacements';

export interface GridHandlers {
  onSlotClick(day: number, hour: number): void;
  onLessonClick(lesson: Lesson): void;
  /** Called when a lesson is dragged (or moved with Alt+arrows) to a new slot. */
  onLessonMove(lesson: Lesson, day: number, start: number): void;
  /** Called when a lesson is dropped clearly outside the timetable, or Delete is pressed on it. */
  onLessonDelete?(lesson: Lesson): void;
  /** Called with the text typed into the timetable's ID (the top-left corner). */
  onSpecIdEdit?(value: string): void;
}

/** Replacement finder overlay: the skipped lesson, and the same course in other timetables. */
export interface GridOverlay {
  skippedId: string;
  options: readonly ReplacementOption[];
  selectedKey: string | null;
  onSelect(key: string): void;
}

/**
 * How far (in screen pixels) beyond the timetable's visible box a lesson must
 * be dropped to delete it. Dragging near the edge only scrolls; between the
 * two, letting go does nothing.
 */
export const DELETE_DISTANCE = 40;

/**
 * After the timetable moves under the pointer (page auto-scroll, layout shift,
 * a mobile toolbar appearing), how far in screen pixels the pointer must move
 * by itself before letting go off the timetable deletes. Larger than the
 * jitter of a finger or hand held still.
 */
export const REARM_DISTANCE = 8;

/** Whether `point` is clearly outside `box`, so a lesson dropped there is deleted. */
export function isOutside(point: DragPoint, box: { left: number; right: number; top: number; bottom: number }): boolean {
  return point.x < box.left - DELETE_DISTANCE || point.x > box.right + DELETE_DISTANCE
    || point.y < box.top - DELETE_DISTANCE || point.y > box.bottom + DELETE_DISTANCE;
}

const BASE_ROW_HEIGHT = 64;
const LANE_MIN_HEIGHT = 32;
/** Height of one lane in the replacement strip under a day's own lessons. */
const ALT_LANE_HEIGHT = 38;
const ALT_STRIP_PADDING = 6;

function pct(hours: number): string {
  return `${(hours / HOUR_COUNT) * 100}%`;
}

export function lessonLabel(lesson: Lesson): string {
  const parts = [
    lesson.subject || 'Bez názvu',
    `${DAYS[lesson.day]} ${formatHour(lesson.start)}–${formatHour(lesson.start + lesson.duration)}`,
    lesson.room && `učebna ${lesson.room}`,
    lesson.lecturer && `vyučující ${lesson.lecturer}`,
  ];
  return parts.filter(Boolean).join(', ');
}

/**
 * Whole-hour start for a lesson dropped at `pointerX` on a track, keeping the
 * grabbed hour under the pointer and the lesson inside the grid.
 */
export function dropStart(pointerX: number, trackLeft: number, trackWidth: number, grabOffset: number, duration: number): number {
  const hourUnderPointer = FIRST_HOUR + Math.floor(((pointerX - trackLeft) / trackWidth) * HOUR_COUNT);
  return Math.min(LAST_HOUR - duration, Math.max(FIRST_HOUR, hourUnderPointer - grabOffset));
}

function enableDrag(el: HTMLElement, lesson: Lesson, handlers: GridHandlers, scrollHost: HTMLElement): void {
  let origin: DragPoint = { x: 0, y: 0 };
  let grab = 0;
  let sourceRect: DOMRect;
  let target: { day: number; start: number } | null = null;
  let preview: HTMLElement | null = null;
  let deleting = false;
  // Only the pointer's own movement may take a lesson off the timetable. If the
  // timetable itself moves on screen (edge auto-scroll, layout shift, mobile
  // toolbar), nothing is armed until the pointer has moved REARM_DISTANCE by
  // itself; a delete armed earlier is dropped too, so the safe outcome wins.
  let boardAt: { left: number; top: number } | null = null;
  let shiftedAt: DragPoint | null = null;
  // The timetable scrolls and clips what leaves it, so the lesson itself stays
  // put (faded) and a copy outside the timetable follows the pointer. Moving
  // the lesson inside the scroll box would clip it at the edges and widen the
  // scrollable area, which made edge auto-scrolling run away.
  let float: HTMLElement | null = null;
  const place = (point: DragPoint) => {
    if (!float) return;
    float.style.left = `${sourceRect.left + point.x - origin.x}px`;
    float.style.top = `${sourceRect.top + point.y - origin.y}px`;
  };
  const setDeleting = (value: boolean) => {
    deleting = value && Boolean(handlers.onLessonDelete);
    el.classList.toggle('lesson--deleting', deleting);
    float?.classList.toggle('lesson-float--deleting', deleting);
  };
  const cleanup = () => {
    el.classList.remove('lesson--dragging');
    setDeleting(false);
    float?.remove();
    float = null;
    boardAt = shiftedAt = null;
    preview?.remove();
    preview = null;
    target = null;
  };
  enablePointerDrag(el, {
    scrollHost,
    scrollPage: true,
    onStart(point) {
      origin = point;
      sourceRect = el.getBoundingClientRect();
      // On phones the board is zoomed out to fit; the copy is drawn the same size.
      const scale = Number(scrollHost.querySelector<HTMLElement>('.board')?.style.zoom) || 1;
      const rect = el.closest<HTMLElement>('.track')!.getBoundingClientRect();
      grab = Math.max(0, FIRST_HOUR + Math.floor(((point.x - rect.left) / rect.width) * HOUR_COUNT) - lesson.start);
      float = h(
        'div',
        { class: `${el.className} lesson-float`, style: el.getAttribute('style'), 'aria-hidden': 'true' },
        ...[...el.childNodes].map((node) => node.cloneNode(true)),
        h('span', { class: 'lesson-delete-hint' }, 'Pustit = smazat'),
      );
      Object.assign(float.style, {
        width: `${sourceRect.width / scale}px`,
        height: `${sourceRect.height / scale}px`,
        transform: scale === 1 ? '' : `scale(${scale})`,
      });
      place(point);
      document.body.append(float);
      el.classList.add('lesson--dragging');
    },
    onMove(point) {
      place(point);
      // Restrict hit testing to the visible part of this timetable.
      const track = [...scrollHost.querySelectorAll<HTMLElement>('.track')].find((track) => {
        const r = track.getBoundingClientRect();
        const visible = scrollHost.getBoundingClientRect();
        const labelRight = track.previousElementSibling?.getBoundingClientRect().right ?? r.left;
        return point.x >= Math.max(r.left, visible.left, labelRight) && point.x <= Math.min(r.right, visible.right)
          && point.y >= r.top && point.y < r.bottom;
      });
      const board = scrollHost.getBoundingClientRect();
      const boardMoved = boardAt !== null && (board.left !== boardAt.left || board.top !== boardAt.top);
      boardAt = { left: board.left, top: board.top };
      if (boardMoved) shiftedAt = point;
      else if (shiftedAt && Math.hypot(point.x - shiftedAt.x, point.y - shiftedAt.y) >= REARM_DISTANCE) shiftedAt = null;
      setDeleting(!track && !shiftedAt && isOutside(point, board));
      if (!track) {
        preview?.remove();
        preview = null;
        target = null;
        return;
      }
      const rect = track.getBoundingClientRect();
      const start = dropStart(point.x, rect.left, rect.width, grab, lesson.duration);
      target = { day: Number(track.dataset.day), start };
      if (!preview) preview = h('div', { class: 'drop-preview', 'aria-hidden': 'true' });
      preview.style.left = pct(start - FIRST_HOUR);
      preview.style.width = pct(lesson.duration);
      if (preview.parentElement !== track) track.append(preview);
    },
    onEnd() {
      const moved = target;
      const remove = deleting;
      cleanup();
      if (remove) handlers.onLessonDelete?.(lesson);
      else if (moved && (moved.day !== lesson.day || moved.start !== lesson.start)) handlers.onLessonMove(lesson, moved.day, moved.start);
    },
    onCancel: cleanup,
  });

  // Keyboard alternative: Alt+←/→ moves by an hour, Alt+↑/↓ by a day;
  // Delete (⌫ on a Mac) deletes, like dropping the lesson off the timetable.
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.altKey && !e.ctrlKey && !e.metaKey && handlers.onLessonDelete) {
      e.preventDefault();
      handlers.onLessonDelete(lesson);
      return;
    }
    if (!e.altKey) return;
    const moves: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    const day = Math.min(DAYS.length - 1, Math.max(0, lesson.day + move[0]));
    const start = Math.min(LAST_HOUR - lesson.duration, Math.max(FIRST_HOUR, lesson.start + move[1]));
    if (day !== lesson.day || start !== lesson.start) handlers.onLessonMove(lesson, day, start);
  });
}

/** Vertical band of a track that a group of lanes is laid out in, as fractions of the track height. */
interface Band {
  top: number;
  height: number;
}

const FULL: Band = { top: 0, height: 1 };

function laneStyle(lane: number, lanes: number, band: Band): string {
  return `top:${(band.top + (lane / lanes) * band.height) * 100}%;height:${(band.height / lanes) * 100}%`;
}

function renderLesson(
  lesson: Lesson, lane: number, lanes: number, handlers: GridHandlers, scrollHost: HTMLElement, band = FULL, state = '',
): HTMLElement {
  const color = paletteColor(lesson.color);
  const el = h(
    'button',
    {
      type: 'button',
      class: `lesson${lanes > 1 ? ' lesson--compact' : ''}${state}`,
      'data-lesson-id': lesson.id,
      'aria-label': `Upravit: ${lessonLabel(lesson)}`,
      'aria-keyshortcuts': `Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown${handlers.onLessonDelete ? ' Delete' : ''}`,
      title: lessonLabel(lesson),
      style: [
        `left:${pct(lesson.start - FIRST_HOUR)}`,
        `width:${pct(lesson.duration)}`,
        laneStyle(lane, lanes, band),
        `--fill:${color.fill}`,
        `--border:${color.border}`,
      ].join(';'),
    },
    h('span', { class: 'lesson-title' }, lesson.subject || '—'),
    h(
      'span',
      { class: 'lesson-meta' },
      // The lesson being replaced says so where its lecturer would be.
      state.includes('lesson--skipped')
        ? h('span', { class: 'lesson-skip-tag' }, 'vynecháš')
        : h('span', { class: 'lesson-lecturer' }, lesson.lecturer),
      h('span', { class: 'lesson-room' }, lesson.room),
    ),
  );
  enableDrag(el, lesson, handlers, scrollHost);
  el.addEventListener('click', () => handlers.onLessonClick(lesson));
  return el;
}

function optionLabel(option: ReplacementOption): string {
  const parts = [
    `Náhrada ${option.subject}`,
    `${DAYS[option.day]} ${formatHour(option.start)}–${formatHour(option.start + option.duration)}`,
    option.room && `učebna ${option.room}`,
    option.lecturer && `vyučující ${option.lecturer}`,
    `rozvrhy ${sourceNames(option)}`,
    option.clashes.length ? `koliduje s ${option.clashes.map((c) => c.subject || 'hodinou').join(', ')}` : 'máš volno',
  ];
  return parts.filter(Boolean).join(', ');
}

function renderOption(option: ReplacementOption, lane: number, lanes: number, band: Band, overlay: GridOverlay, order: number): HTMLElement {
  const color = paletteColor(option.color);
  const busy = option.clashes.length > 0;
  const el = h(
    'button',
    {
      type: 'button',
      class: `alt ${busy ? 'alt--clash' : 'alt--free'}${lanes > 1 ? ' alt--compact' : ''}`,
      'data-option-key': option.key,
      'aria-pressed': option.key === overlay.selectedKey ? 'true' : 'false',
      'aria-label': optionLabel(option),
      title: optionLabel(option),
      style: [
        `left:${pct(option.start - FIRST_HOUR)}`,
        `width:${pct(option.duration)}`,
        laneStyle(lane, lanes, band),
        `--fill:${color.fill}`,
        `--border:${color.border}`,
        `--order:${order}`,
      ].join(';'),
    },
    h('span', { class: 'alt-title' }, option.subject),
    // Teacher and room, laid out like the lessons of the official timetable.
    h('span', { class: 'alt-meta' }, h('span', { class: 'alt-lecturer' }, option.lecturer), h('span', { class: 'alt-room' }, option.room)),
  );
  el.addEventListener('click', () => overlay.onSelect(option.key));
  return el;
}

/** The timetable's ID in the top-left corner; click it to type a new one. */
function renderCorner(schedule: Schedule, handlers: GridHandlers): HTMLElement {
  const text = schedule.specId || '—';
  const onEdit = handlers.onSpecIdEdit;
  if (!onEdit) return h('div', { class: 'corner', role: 'columnheader' }, text);
  const button = h(
    'button',
    { type: 'button', class: 'corner-edit', title: 'Klikni a napiš vlastní ID rozvrhu', 'aria-label': `ID rozvrhu: ${text}. Upravit` },
    text,
  );
  button.addEventListener('click', () =>
    startInlineEdit(button, {
      value: schedule.specId,
      label: 'ID rozvrhu',
      placeholder: 'např. FI_PF',
      className: 'corner-input',
      onCommit: (value) => {
        if (value !== schedule.specId) onEdit(value);
      },
    }),
  );
  return h('div', { class: 'corner', role: 'columnheader' }, button);
}

export function renderGrid(schedule: Schedule, handlers: GridHandlers, overlay?: GridOverlay): HTMLElement {
  const scrollHost = h('div', { class: 'board-scroll', tabindex: 0, role: 'region', 'aria-label': 'Týdenní rozvrh' });
  const hourLabels: HTMLElement[] = [];
  for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour++) {
    hourLabels.push(h('span', { class: 'hour-label', style: `left:${pct(hour - FIRST_HOUR)}` }, formatHour(hour)));
  }

  const board = h(
    'div',
    { class: `board${overlay ? ' board--finder' : ''}`, role: 'grid', 'aria-label': 'Rozvrh' },
    h(
      'div',
      { class: 'board-head', role: 'row' },
      renderCorner(schedule, handlers),
      h('div', { class: 'hours', 'aria-hidden': 'true' }, ...hourLabels),
    ),
  );

  let order = 0;
  DAYS.forEach((dayName, day) => {
    const placed = layoutDay(schedule.lessons.filter((l) => l.day === day));
    const maxLanes = placed.reduce((m, p) => Math.max(m, p.lanes), 1);
    const ownHeight = Math.max(BASE_ROW_HEIGHT, maxLanes * LANE_MIN_HEIGHT);

    // With the finder open, the same course from other timetables gets its
    // own strip under the day's lessons, so a clash sits right below the
    // lesson it clashes with.
    const dayOptions = overlay?.options.filter((o) => o.day === day) ?? [];
    const byId = new Map(dayOptions.map((o) => [o.key, o]));
    const altPlaced = layoutDay(dayOptions.map((o) => ({ ...o, id: o.key })));
    const altLanes = altPlaced.reduce((m, p) => Math.max(m, p.lanes), 0);
    const altHeight = altLanes ? altLanes * ALT_LANE_HEIGHT + ALT_STRIP_PADDING : 0;
    const height = ownHeight + altHeight;
    const ownBand: Band = { top: 0, height: ownHeight / height };
    const altBand: Band = { top: (ownHeight + ALT_STRIP_PADDING / 2) / height, height: (altHeight - ALT_STRIP_PADDING) / height };

    const track = h('div', { class: 'track', 'data-day': day, style: `--cols:${HOUR_COUNT}` });
    for (let hour = FIRST_HOUR; hour < LAST_HOUR; hour++) {
      const slot = h(
        'button',
        {
          type: 'button',
          class: 'slot',
          'data-day': day,
          'data-hour': hour,
          'aria-label': `Přidat hodinu: ${dayName} ${formatHour(hour)}`,
        },
        h('span', { 'aria-hidden': 'true' }, '+'),
      );
      slot.addEventListener('click', () => handlers.onSlotClick(day, hour));
      track.append(slot);
    }
    if (overlay && altLanes) {
      track.append(h('div', { class: 'alt-strip', 'aria-hidden': 'true', style: `top:${ownBand.height * 100}%` }));
      // The selected option lights up its hours across the whole row.
      const selected = dayOptions.find((o) => o.key === overlay.selectedKey);
      if (selected) {
        track.append(h('div', {
          class: 'alt-window',
          'aria-hidden': 'true',
          style: `left:${pct(selected.start - FIRST_HOUR)};width:${pct(selected.duration)}`,
        }));
      }
    }
    for (const p of placed) {
      const state = !overlay ? '' : p.lesson.id === overlay.skippedId ? ' lesson--skipped' : ' lesson--muted';
      track.append(renderLesson(p.lesson, p.lane, p.lanes, handlers, scrollHost, ownBand, state));
    }
    if (overlay) {
      for (const p of altPlaced) track.append(renderOption(byId.get(p.lesson.id)!, p.lane, p.lanes, altBand, overlay, order++));
    }

    board.append(
      h(
        'div',
        { class: 'day-row', role: 'row', style: `height:${height}px` },
        h('div', { class: 'day-label', role: 'rowheader' }, dayName),
        track,
      ),
    );
  });

  scrollHost.append(board);
  return scrollHost;
}
