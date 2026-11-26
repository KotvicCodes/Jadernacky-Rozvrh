/** Whole-surface pointer dragging shared by lessons and schedule tabs. */

/** Width of the zone at a scroll area's (or the window's) edge where dragging scrolls it. */
export const AUTO_SCROLL_EDGE = 36;
export interface DragPoint { x: number; y: number }

export function enablePointerDrag(el: HTMLElement, options: {
  scrollHost: HTMLElement;
  scrollPage?: boolean;
  onStart(point: DragPoint): void;
  onMove(point: DragPoint): void;
  onEnd(): void;
  onCancel(): void;
}): void {
  let origin: DragPoint | null = null;
  let point: DragPoint | null = null;
  let pointerId: number | null = null;
  let dragging = false;
  let frame = 0;
  let suppressClick = false;

  const stop = (cancelled: boolean) => {
    const wasDragging = dragging;
    const capturedId = pointerId;
    origin = point = null;
    pointerId = null;
    dragging = false;
    cancelAnimationFrame(frame);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onExtraPointer);
    if (capturedId !== null && el.hasPointerCapture(capturedId)) el.releasePointerCapture(capturedId);
    if (wasDragging) {
      // A click follows pointerup synchronously. Never swallow a later tap if
      // the browser omits that click (for example after pointercancel).
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (cancelled) options.onCancel();
      else options.onEnd();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    // A mere press (no drag yet) leaves Escape to the page.
    if (e.key === 'Escape' && dragging) {
      e.preventDefault();
      stop(true);
    }
  };
  const onExtraPointer = (e: PointerEvent) => {
    if (!e.isPrimary) stop(true);
  };
  const edgeSpeed = (value: number, min: number, max: number) => {
    const edge = Math.min(AUTO_SCROLL_EDGE, (max - min) / 4);
    if (value < min || value > max) return 0;
    if (value < min + edge) return -10 * (1 - (value - min) / edge);
    if (value > max - edge) return 10 * (1 - (max - value) / edge);
    return 0;
  };
  const tick = () => {
    if (!dragging || !point) return;
    if (!el.isConnected) { stop(true); return; }
    const host = options.scrollHost;
    const rect = host.getBoundingClientRect();
    if (point.y >= rect.top && point.y <= rect.bottom) {
      host.scrollLeft += edgeSpeed(point.x, Math.max(0, rect.left), Math.min(window.innerWidth, rect.right));
    }
    if (options.scrollPage) {
      const dy = edgeSpeed(point.y, 0, window.innerHeight);
      if (dy) window.scrollBy(0, dy);
    }
    options.onMove(point);
    frame = requestAnimationFrame(tick);
  };

  el.addEventListener('pointerdown', (e) => {
    if (pointerId !== null || !e.isPrimary || e.button !== 0) return;
    origin = point = { x: e.clientX, y: e.clientY };
    pointerId = e.pointerId;
    // Capture immediately: a quick move can leave a small lesson or tab before
    // its first pointermove. Waiting for the threshold loses those drags.
    el.setPointerCapture(e.pointerId);
    // Capture phase: Escape cancels the drag before page-level Escape handlers
    // (such as closing Nahradit hodinu) see it; they skip defaultPrevented keys.
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onExtraPointer);
  });
  el.addEventListener('pointermove', (e) => {
    if (!origin || e.pointerId !== pointerId) return;
    point = { x: e.clientX, y: e.clientY };
    if (!dragging) {
      if (Math.hypot(point.x - origin.x, point.y - origin.y) < 5) return;
      dragging = true;
      options.onStart(origin);
      frame = requestAnimationFrame(tick);
    }
    options.onMove(point);
  });
  el.addEventListener('pointerup', (e) => {
    if (e.pointerId !== pointerId) return;
    if (dragging) options.onMove({ x: e.clientX, y: e.clientY });
    stop(false);
  });
  el.addEventListener('pointercancel', (e) => { if (e.pointerId === pointerId) stop(true); });
  el.addEventListener('lostpointercapture', (e) => { if (e.pointerId === pointerId) stop(true); });
  el.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
  el.addEventListener('contextmenu', (e) => {
    if (origin) e.preventDefault();
  });
}
