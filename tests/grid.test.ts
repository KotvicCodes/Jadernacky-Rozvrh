import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOUR_COUNT } from '../src/config';
import { DELETE_DISTANCE, dropStart, isOutside, renderGrid } from '../src/grid';
import { createSchedule, normalizeLesson } from '../src/model';

describe('renderGrid', () => {
  it('renders one clickable slot per whole hour per day', () => {
    const onSlotClick = vi.fn();
    const grid = renderGrid(createSchedule('Bc1JCF1'), { onSlotClick, onLessonClick: vi.fn(), onLessonMove: vi.fn() });
    const slots = grid.querySelectorAll<HTMLButtonElement>('.slot');
    expect(slots).toHaveLength(5 * HOUR_COUNT);
    slots[HOUR_COUNT + 2]!.click();
    expect(onSlotClick).toHaveBeenCalledWith(1, 10);
    expect(grid.querySelector('.corner')?.textContent).toBe('JCF1');
  });

  it('positions lessons by start and duration and shows their details as text', () => {
    const schedule = createSchedule();
    const lesson = normalizeLesson({ day: 2, start: 12, duration: 3, subject: '<b>MAN</b>', room: 'B-103', lecturer: 'Strachota', color: 'pink' });
    schedule.lessons.push(lesson);
    const onLessonClick = vi.fn();
    const grid = renderGrid(schedule, { onSlotClick: vi.fn(), onLessonClick, onLessonMove: vi.fn() });
    const el = grid.querySelector<HTMLElement>('.track[data-day="2"] .lesson')!;
    expect(el.style.left).toBe(`${(4 / HOUR_COUNT) * 100}%`);
    expect(el.style.width).toBe(`${(3 / HOUR_COUNT) * 100}%`);
    expect(el.querySelector('.lesson-title')?.textContent).toBe('<b>MAN</b>');
    expect(el.querySelector('b')).toBeNull();
    expect(el.querySelector('.lesson-room')?.textContent).toBe('B-103');
    el.click();
    expect(onLessonClick).toHaveBeenCalledWith(lesson);
  });
});

describe('dropStart', () => {
  // Track 1200px wide → 100px per hour starting at 8:00.
  it('snaps to the whole hour under the pointer', () => {
    expect(dropStart(250, 0, 1200, 0, 1)).toBe(10);
    expect(dropStart(299, 0, 1200, 0, 1)).toBe(10);
    expect(dropStart(300, 0, 1200, 0, 1)).toBe(11);
  });

  it('keeps the grabbed hour under the pointer', () => {
    expect(dropStart(450, 0, 1200, 1, 2)).toBe(11);
  });

  it('never moves a lesson outside the grid', () => {
    expect(dropStart(-50, 0, 1200, 0, 2)).toBe(8);
    expect(dropStart(1190, 0, 1200, 0, 3)).toBe(17);
  });
});

describe('keyboard moves', () => {
  it('moves a lesson with Alt+arrows, clamped to the grid', () => {
    const schedule = createSchedule();
    const lesson = normalizeLesson({ day: 0, start: 18, duration: 2 });
    schedule.lessons.push(lesson);
    const onLessonMove = vi.fn();
    const grid = renderGrid(schedule, { onSlotClick: vi.fn(), onLessonClick: vi.fn(), onLessonMove });
    const el = grid.querySelector<HTMLElement>('.lesson')!;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true }));
    expect(onLessonMove).not.toHaveBeenCalled();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true }));
    expect(onLessonMove).toHaveBeenCalledWith(lesson, 1, 18);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true }));
    expect(onLessonMove).toHaveBeenLastCalledWith(lesson, 0, 17);
  });
});

describe('deleting a lesson by dragging it off the timetable', () => {
  const box = { left: 100, right: 900, top: 100, bottom: 500 };

  it('counts only drops clearly outside the timetable', () => {
    expect(isOutside({ x: 500, y: 300 }, box)).toBe(false);
    // Near the edge (where dragging auto-scrolls) is not outside yet.
    expect(isOutside({ x: 100 - DELETE_DISTANCE, y: 300 }, box)).toBe(false);
    expect(isOutside({ x: 900 + DELETE_DISTANCE, y: 520 }, box)).toBe(false);
    expect(isOutside({ x: 99 - DELETE_DISTANCE, y: 300 }, box)).toBe(true);
    expect(isOutside({ x: 500, y: 501 + DELETE_DISTANCE }, box)).toBe(true);
    expect(isOutside({ x: 500, y: 99 - DELETE_DISTANCE }, box)).toBe(true);
  });

  function setup() {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const schedule = createSchedule();
    const lesson = normalizeLesson({ day: 1, start: 10, duration: 2, subject: 'MAN' });
    schedule.lessons.push(lesson);
    const handlers = { onSlotClick: vi.fn(), onLessonClick: vi.fn(), onLessonMove: vi.fn(), onLessonDelete: vi.fn() };
    const grid = renderGrid(schedule, handlers);
    document.body.replaceChildren(grid);
    grid.getBoundingClientRect = () => ({ ...box, width: 800, height: 400 }) as DOMRect;
    grid.querySelectorAll<HTMLElement>('.track').forEach((track, day) => {
      track.getBoundingClientRect = () => ({ left: 220, right: 900, top: 140 + day * 64, bottom: 204 + day * 64, width: 680, height: 64 }) as DOMRect;
    });
    const el = grid.querySelector<HTMLElement>('.lesson')!;
    el.getBoundingClientRect = () => ({ left: 333, right: 446, top: 204, bottom: 268, width: 113, height: 64 }) as DOMRect;
    Object.assign(el, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true });
      Object.entries({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y }).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
      el.dispatchEvent(event);
    };
    return { grid, el, lesson, handlers, pointer };
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('shows "Pustit = smazat" instead of a drop preview outside, and deletes on release', () => {
    const { grid, el, lesson, handlers, pointer } = setup();
    pointer('pointerdown', 350, 230);
    pointer('pointermove', 500, 230);
    expect(grid.querySelector('.drop-preview')).not.toBeNull();
    expect(el.classList.contains('lesson--deleting')).toBe(false);
    pointer('pointermove', 500, 600);
    expect(grid.querySelector('.drop-preview')).toBeNull();
    expect(el.classList.contains('lesson--deleting')).toBe(true);
    // The copy under the pointer says what letting go does.
    const float = document.querySelector<HTMLElement>('body > .lesson-float')!;
    expect(float.classList.contains('lesson-float--deleting')).toBe(true);
    expect(float.querySelector('.lesson-delete-hint')!.textContent).toBe('Pustit = smazat');
    expect([float.style.left, float.style.top, float.style.width]).toEqual(['483px', '574px', '113px']);
    pointer('pointerup', 500, 600);
    expect(handlers.onLessonDelete).toHaveBeenCalledWith(lesson);
    expect(handlers.onLessonMove).not.toHaveBeenCalled();
    expect(el.classList.contains('lesson--deleting')).toBe(false);
    expect(document.querySelector('.lesson-float')).toBeNull();
  });

  it('moves a copy outside the timetable and leaves the lesson itself in place', () => {
    const { grid, el, pointer } = setup();
    pointer('pointerdown', 350, 230);
    pointer('pointermove', 900, 230);
    // Nothing inside the scrolling timetable moves, so it cannot clip the lesson or grow its scroll width.
    expect(el.style.transform).toBe('');
    expect(el.classList.contains('lesson--dragging')).toBe(true);
    const float = document.querySelector<HTMLElement>('body > .lesson-float')!;
    expect(grid.contains(float)).toBe(false);
    expect([float.style.left, float.style.top, float.style.height]).toEqual(['883px', '204px', '64px']);
    expect(float.getAttribute('aria-hidden')).toBe('true');
    expect(float.querySelector('.lesson-title')!.textContent).toBe('MAN');
    expect(float.hasAttribute('data-lesson-id')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.lesson-float')).toBeNull();
    expect(el.classList.contains('lesson--dragging')).toBe(false);
  });

  it('draws the copy at the zoomed-out size on phones', () => {
    const { grid, pointer } = setup();
    grid.querySelector<HTMLElement>('.board')!.style.zoom = '0.5';
    pointer('pointerdown', 350, 230);
    pointer('pointermove', 400, 230);
    const float = document.querySelector<HTMLElement>('body > .lesson-float')!;
    expect([float.style.width, float.style.height, float.style.transform]).toEqual(['226px', '128px', 'scale(0.5)']);
    pointer('pointerup', 400, 230);
  });

  it('cancels the delete when dragged back over the grid', () => {
    const { el, handlers, pointer } = setup();
    pointer('pointerdown', 350, 230);
    pointer('pointermove', 500, 600);
    pointer('pointermove', 500, 300);
    expect(el.classList.contains('lesson--deleting')).toBe(false);
    expect(document.querySelector('.lesson-float')!.classList.contains('lesson-float--deleting')).toBe(false);
    pointer('pointerup', 500, 300);
    expect(handlers.onLessonDelete).not.toHaveBeenCalled();
    expect(handlers.onLessonMove).toHaveBeenCalled();
  });

  it('does nothing when released just past the edge, or after Escape', () => {
    const { handlers, pointer } = setup();
    pointer('pointerdown', 350, 230);
    pointer('pointermove', 500, 520);
    pointer('pointerup', 500, 520);
    pointer('pointerdown', 350, 230);
    pointer('pointermove', 500, 600);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(handlers.onLessonDelete).not.toHaveBeenCalled();
    expect(handlers.onLessonMove).not.toHaveBeenCalled();
  });

  it('never deletes at the window\'s bottom edge while the page can still scroll down', () => {
    const page = document.documentElement;
    Object.defineProperty(page, 'scrollHeight', { configurable: true, value: 2000 });
    try {
      const { el, handlers, pointer } = setup();
      pointer('pointerdown', 350, 230);
      // Far below the timetable, but inside the bottom auto-scroll zone of the 768 px window.
      pointer('pointermove', 500, window.innerHeight - 10);
      expect(el.classList.contains('lesson--deleting')).toBe(false);
      pointer('pointerup', 500, window.innerHeight - 10);
      expect(handlers.onLessonDelete).not.toHaveBeenCalled();
    } finally {
      delete (page as unknown as Record<string, unknown>).scrollHeight;
    }
  });

  it('does delete at the window\'s edge once the page cannot scroll that way', () => {
    const { el, handlers, pointer } = setup();
    // jsdom's page is not scrollable, like a page already scrolled to its end.
    pointer('pointerdown', 350, 230);
    pointer('pointermove', 500, window.innerHeight - 10);
    expect(el.classList.contains('lesson--deleting')).toBe(true);
    pointer('pointerup', 500, window.innerHeight - 10);
    expect(handlers.onLessonDelete).toHaveBeenCalled();
  });

  it('deletes with Delete or Backspace on a focused lesson', () => {
    const { el, lesson, handlers } = setup();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(handlers.onLessonDelete).toHaveBeenCalledTimes(2);
    expect(handlers.onLessonDelete).toHaveBeenCalledWith(lesson);
    expect(el.getAttribute('aria-keyshortcuts')).toContain('Delete');
  });
});
