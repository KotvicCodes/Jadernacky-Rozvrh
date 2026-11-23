import { DAYS, FIRST_HOUR, HOUR_COUNT, LAST_HOUR, paletteColor } from './config';
import { h } from './dom';
import { enablePointerDrag, type DragPoint } from './drag';
import { startInlineEdit } from './inline-edit';
import { formatHour, layoutDay, type Lesson, type Schedule } from './model';

export interface GridHandlers {
  onSlotClick(day: number, hour: number): void;
  onLessonClick(lesson: Lesson): void;
  /** Called when a lesson is dragged (or moved with Alt+arrows) to a new slot. */
  onLessonMove(lesson: Lesson, day: number, start: number): void;
  /** Called with the text typed into the timetable's ID (the top-left corner). */
  onSpecIdEdit?(value: string): void;
}

const BASE_ROW_HEIGHT = 64;
const LANE_MIN_HEIGHT = 32;

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
  let tx = 0;
  let ty = 0;
  let scale = 1;
  let target: { day: number; start: number } | null = null;
  let preview: HTMLElement | null = null;
  const cleanup = () => {
    el.classList.remove('lesson--dragging');
    el.style.transform = '';
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
      scale = Number(scrollHost.querySelector<HTMLElement>('.board')?.style.zoom) || 1;
      tx = ty = 0;
      const rect = el.closest<HTMLElement>('.track')!.getBoundingClientRect();
      grab = Math.max(0, FIRST_HOUR + Math.floor(((point.x - rect.left) / rect.width) * HOUR_COUNT) - lesson.start);
      el.classList.add('lesson--dragging');
    },
    onMove(point) {
      const current = el.getBoundingClientRect();
      tx = (point.x - origin.x + sourceRect.left - (current.left - tx * scale)) / scale;
      ty = (point.y - origin.y + sourceRect.top - (current.top - ty * scale)) / scale;
      el.style.transform = `translate(${tx}px, ${ty}px)`;
      // Restrict hit testing to this timetable and ignore the floating lesson.
      const track = [...scrollHost.querySelectorAll<HTMLElement>('.track')].find((track) => {
        const r = track.getBoundingClientRect();
        const visible = scrollHost.getBoundingClientRect();
        const labelRight = track.previousElementSibling?.getBoundingClientRect().right ?? r.left;
        return point.x >= Math.max(r.left, visible.left, labelRight) && point.x <= Math.min(r.right, visible.right)
          && point.y >= r.top && point.y < r.bottom;
      });
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
      cleanup();
      if (moved && (moved.day !== lesson.day || moved.start !== lesson.start)) handlers.onLessonMove(lesson, moved.day, moved.start);
    },
    onCancel: cleanup,
  });

  // Keyboard alternative: Alt+←/→ moves by an hour, Alt+↑/↓ by a day.
  el.addEventListener('keydown', (e) => {
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

function renderLesson(lesson: Lesson, lane: number, lanes: number, handlers: GridHandlers, scrollHost: HTMLElement): HTMLElement {
  const color = paletteColor(lesson.color);
  const el = h(
    'button',
    {
      type: 'button',
      class: `lesson${lanes > 1 ? ' lesson--compact' : ''}`,
      'data-lesson-id': lesson.id,
      'aria-label': `Upravit: ${lessonLabel(lesson)}`,
      'aria-keyshortcuts': 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown',
      title: lessonLabel(lesson),
      style: [
        `left:${pct(lesson.start - FIRST_HOUR)}`,
        `width:${pct(lesson.duration)}`,
        `top:${(lane / lanes) * 100}%`,
        `height:${100 / lanes}%`,
        `--fill:${color.fill}`,
        `--border:${color.border}`,
      ].join(';'),
    },
    h('span', { class: 'lesson-title' }, lesson.subject || '—'),
    h(
      'span',
      { class: 'lesson-meta' },
      h('span', { class: 'lesson-lecturer' }, lesson.lecturer),
      h('span', { class: 'lesson-room' }, lesson.room),
    ),
  );
  enableDrag(el, lesson, handlers, scrollHost);
  el.addEventListener('click', () => handlers.onLessonClick(lesson));
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

export function renderGrid(schedule: Schedule, handlers: GridHandlers): HTMLElement {
  const scrollHost = h('div', { class: 'board-scroll', tabindex: 0, role: 'region', 'aria-label': 'Týdenní rozvrh' });
  const hourLabels: HTMLElement[] = [];
  for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour++) {
    hourLabels.push(h('span', { class: 'hour-label', style: `left:${pct(hour - FIRST_HOUR)}` }, formatHour(hour)));
  }

  const board = h(
    'div',
    { class: 'board', role: 'grid', 'aria-label': 'Rozvrh' },
    h(
      'div',
      { class: 'board-head', role: 'row' },
      renderCorner(schedule, handlers),
      h('div', { class: 'hours', 'aria-hidden': 'true' }, ...hourLabels),
    ),
  );

  DAYS.forEach((dayName, day) => {
    const placed = layoutDay(schedule.lessons.filter((l) => l.day === day));
    const maxLanes = placed.reduce((m, p) => Math.max(m, p.lanes), 1);
    const height = Math.max(BASE_ROW_HEIGHT, maxLanes * LANE_MIN_HEIGHT);

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
    for (const p of placed) track.append(renderLesson(p.lesson, p.lane, p.lanes, handlers, scrollHost));

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
