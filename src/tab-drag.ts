import { enablePointerDrag } from './drag';

/** Horizontal extent of a tab in the tab bar, in the bar's own (scrolled) coordinates. */
export interface TabSlot {
  left: number;
  width: number;
}

export interface TabDragFrame {
  /** Where the dragged tab lands in the new order. */
  target: number;
  /** How far the dragged tab follows the pointer (kept inside the bar). */
  offset: number;
  /** How far each tab moves aside to open the gap (0 for the dragged tab). */
  shifts: number[];
}

/**
 * Layout of the tab bar while tab `index` is dragged `dx` pixels: the dragged
 * tab follows the pointer, and the tabs it passes move aside by its width.
 * With `inside` false (pointer far from the bar), the others close the gap
 * and the tab would go back where it was.
 */
export function tabDragFrame(slots: readonly TabSlot[], index: number, dx: number, gap: number, inside = true): TabDragFrame {
  const dragged = slots[index]!;
  const first = slots[0]!;
  const last = slots.at(-1)!;
  const offset = Math.min(last.left + last.width - dragged.left - dragged.width, Math.max(first.left - dragged.left, dx));
  // A tab is passed once the dragged tab's leading edge crosses its middle,
  // so the ends of the bar are reachable whatever the tabs' widths.
  const left = dragged.left + offset;
  const right = left + dragged.width;
  const middle = (slot: TabSlot) => slot.left + slot.width / 2;
  const passed = (slot: TabSlot, i: number) => (i > index ? right > middle(slot) : i < index && left < middle(slot));
  const target = !inside ? index : index + slots.filter((slot, i) => i > index && passed(slot, i)).length
    - slots.filter((slot, i) => i < index && passed(slot, i)).length;
  const step = dragged.width + gap;
  const shifts = slots.map((_, i) => (i < index && i >= target ? step : i > index && i <= target ? -step : 0));
  return { target, offset, shifts };
}

/** Pointer distance beyond the bar (on any side) at which letting go cancels. */
export const CANCEL_DISTANCE = 30;

/** Whether a drop at `point` still lands in the bar, rather than far from it. */
export function nearBar(point: { x: number; y: number }, bar: { left: number; right: number; top: number; bottom: number }): boolean {
  return point.x >= bar.left - CANCEL_DISTANCE && point.x <= bar.right + CANCEL_DISTANCE
    && point.y >= bar.top - CANCEL_DISTANCE && point.y <= bar.bottom + CANCEL_DISTANCE;
}

export interface TabDragOptions {
  /** The scrolling tab bar. */
  bar: HTMLElement;
  /** Every draggable tab item in the bar, in order. */
  items(): HTMLElement[];
  onStart(): void;
  /** Moves the dragged tab to `target`; the bar re-renders. Returns the item now standing for the dragged tab. */
  onDrop(target: number): HTMLElement | undefined;
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Slides `el` from its on-screen position `fromLeft` to where it is now laid out. */
function settle(el: HTMLElement, fromLeft: number): void {
  el.classList.remove('tab-item--dragging', 'tab-item--outside');
  el.style.transform = '';
  const delta = fromLeft - el.getBoundingClientRect().left;
  if (!delta || reducedMotion()) return;
  el.classList.add('tab-item--settling');
  el.style.transform = `translateX(${delta}px)`;
  void el.offsetWidth; // Start the transition from the drop position.
  el.style.transform = '';
  const done = () => el.classList.remove('tab-item--settling');
  el.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 300);
}

/**
 * Drags `item` (a tab and its ×) along the bar like a browser tab: it follows
 * the pointer and the other tabs slide aside to show where it will land.
 * Escape, or releasing far above or below the bar, slides it back.
 */
export function enableTabDrag(item: HTMLElement, handle: HTMLElement, options: TabDragOptions): void {
  const { bar } = options;
  let items: HTMLElement[] = [];
  let slots: TabSlot[] = [];
  let index = 0;
  let gap = 0;
  let originX = 0;
  let scroll = 0;
  let frame: TabDragFrame | null = null;

  /** The other tabs close the gap (animated by .tab-item--shifting while it lasts). */
  const reset = () => {
    const others = items.filter((el) => el !== item);
    for (const el of others) el.style.transform = '';
    // Leave a new drag's own animation alone if one started meanwhile.
    setTimeout(() => {
      if (!bar.querySelector('.tab-item--dragging')) others.forEach((el) => el.classList.remove('tab-item--shifting'));
    }, 300);
    frame = null;
  };

  enablePointerDrag(handle, {
    scrollHost: bar,
    onStart(point) {
      items = options.items();
      index = items.indexOf(item);
      // A previous drag's tabs may still be sliding home: measure where they
      // are laid out, not where the animation has got to.
      for (const el of items) {
        el.classList.remove('tab-item--shifting', 'tab-item--settling');
        el.style.transform = '';
      }
      const host = bar.getBoundingClientRect();
      slots = items.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left - host.left + bar.scrollLeft, width: r.width };
      });
      gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
      originX = point.x;
      scroll = bar.scrollLeft;
      item.classList.add('tab-item--dragging');
      for (const el of items) if (el !== item) el.classList.add('tab-item--shifting');
      options.onStart();
    },
    onMove(point) {
      if (index < 0) return;
      const host = bar.getBoundingClientRect();
      const inside = nearBar(point, host);
      frame = tabDragFrame(slots, index, point.x - originX + bar.scrollLeft - scroll, gap, inside);
      item.style.transform = `translateX(${frame.offset}px)`;
      item.classList.toggle('tab-item--outside', !inside);
      items.forEach((el, i) => {
        if (el !== item) el.style.transform = frame!.shifts[i] ? `translateX(${frame!.shifts[i]}px)` : '';
      });
    },
    onEnd() {
      const target = frame?.target ?? index;
      const fromLeft = item.getBoundingClientRect().left;
      reset();
      const landed = target === index ? item : options.onDrop(target);
      settle(landed ?? item, fromLeft);
    },
    onCancel() {
      const fromLeft = item.getBoundingClientRect().left;
      reset();
      settle(item, fromLeft);
    },
  });
}
