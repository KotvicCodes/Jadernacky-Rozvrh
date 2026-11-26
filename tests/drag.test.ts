import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enablePointerDrag, type DragPoint } from '../src/drag';

function pointer(el: Element, type: string, values: Record<string, unknown> = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.entries({ pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: 50, clientY: 50, ...values })
    .forEach(([key, value]) => Object.defineProperty(event, key, { value }));
  el.dispatchEvent(event);
}

describe('pointer dragging', () => {
  let button: HTMLButtonElement;
  let text: HTMLElement;
  let onStart = vi.fn<(point: DragPoint) => void>();
  let onMove = vi.fn<(point: DragPoint) => void>();
  let onEnd = vi.fn<() => void>();
  let onCancel = vi.fn<() => void>();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    button = document.createElement('button');
    text = document.createElement('span');
    text.textContent = 'Lesson';
    button.append(text);
    document.body.replaceChildren(button);
    button.setPointerCapture = vi.fn();
    button.hasPointerCapture = vi.fn(() => true);
    button.releasePointerCapture = vi.fn();
    onStart = vi.fn(); onMove = vi.fn(); onEnd = vi.fn(); onCancel = vi.fn();
    enablePointerDrag(button, { scrollHost: button, onStart, onMove, onEnd, onCancel });
  });
  afterEach(() => {
    pointer(button, 'pointercancel');
    vi.useRealTimers(); vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('captures on press and starts only after enough movement', () => {
    pointer(button, 'pointerdown');
    expect(button.setPointerCapture).toHaveBeenCalledWith(1);
    pointer(button, 'pointermove', { clientX: 52 });
    expect(onStart).not.toHaveBeenCalled();
    pointer(button, 'pointermove', { clientX: 100 });
    expect(onStart).toHaveBeenCalledWith({ x: 50, y: 50 });
    pointer(button, 'pointerup', { clientX: 110 });
    expect(onMove).toHaveBeenLastCalledWith({ x: 110, y: 50 });
    expect(onEnd).toHaveBeenCalledOnce();
    expect(button.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('drags from nested lesson text on a touch target', () => {
    pointer(text, 'pointerdown', { pointerType: 'touch' });
    pointer(button, 'pointermove', { pointerType: 'touch', clientX: 100 });
    expect(onStart).toHaveBeenCalledOnce();
    pointer(button, 'pointerup', { pointerType: 'touch', clientX: 100 });
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('handles Escape before page-level Escape handlers, and marks it handled', () => {
    const seen: boolean[] = [];
    const pageHandler = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
    document.addEventListener('keydown', pageHandler); // registered before the drag starts
    pointer(button, 'pointerdown');
    pointer(button, 'pointermove', { clientX: 100 });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.removeEventListener('keydown', pageHandler);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(seen).toEqual([true]);
  });

  it('leaves Escape alone while the pointer is only pressed, not dragging', () => {
    pointer(button, 'pointerdown');
    pointer(button, 'pointermove', { clientX: 52 });
    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
    // The press is released, so moving on does not start a drag...
    expect(button.releasePointerCapture).toHaveBeenCalled();
    pointer(button, 'pointermove', { clientX: 120 });
    expect(onStart).not.toHaveBeenCalled();
    // ...and releasing does not click it either.
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    // The next press clicks normally.
    pointer(button, 'pointerdown');
    pointer(button, 'pointerup');
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not swallow a later click when the cancelled press ends elsewhere', () => {
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    pointer(button, 'pointerdown');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    // Released off the button: no click on it follows.
    pointer(document.body, 'pointerup');
    vi.runAllTimers();
    // A later keyboard activation (Enter/Space) still clicks.
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('ignores secondary pointers and cancels on Escape', () => {
    pointer(button, 'pointerdown', { isPrimary: false });
    expect(button.setPointerCapture).not.toHaveBeenCalled();
    pointer(button, 'pointerdown');
    pointer(button, 'pointermove', { pointerId: 2, clientX: 100 });
    expect(onStart).not.toHaveBeenCalled();
    pointer(button, 'pointermove', { clientX: 100 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    pointer(button, 'pointerup');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('suppresses only the click immediately following a drag', () => {
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    pointer(button, 'pointerdown');
    pointer(button, 'pointermove', { clientX: 100 });
    pointer(button, 'pointerup');
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    vi.runAllTimers();
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
    pointer(button, 'pointerdown');
    pointer(button, 'pointermove', { clientX: 100 });
    pointer(button, 'pointercancel');
    vi.runAllTimers();
    button.click();
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('cancels a drag when a second finger starts a pinch gesture', () => {
    pointer(button, 'pointerdown', { pointerType: 'touch' });
    pointer(button, 'pointermove', { pointerType: 'touch', clientX: 100 });
    pointer(text, 'pointerdown', { pointerType: 'touch', pointerId: 2, isPrimary: false });
    pointer(button, 'pointerup', { pointerType: 'touch' });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
