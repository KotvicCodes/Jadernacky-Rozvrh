import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openLessonDialog } from '../src/dialog';

// jsdom has no modal dialogs; a minimal stand-in with the same open/close events.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close ??= function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const draft = { day: 0, start: 10, duration: 2, subject: '', room: '', lecturer: '', color: 'green' };

function press(target: EventTarget, x: number, y: number): void {
  // jsdom has no PointerEvent; the handler only reads target and coordinates.
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
}

/** jsdom lays nothing out: give the dialog a box so "outside" means something. */
function placeDialog(): HTMLDialogElement {
  const dialog = document.querySelector('dialog')!;
  dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300, x: 100, y: 100, toJSON() {} }) as DOMRect;
  return dialog;
}

describe('lesson dialog', () => {
  afterEach(() => document.body.replaceChildren());

  it('closes as a cancel when clicking outside it', async () => {
    const result = openLessonDialog(draft);
    press(placeDialog(), 20, 20);
    await expect(result).resolves.toEqual({ action: 'cancel' });
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('stays open for clicks inside it', () => {
    void openLessonDialog(draft);
    const dialog = placeDialog();
    press(dialog.querySelector('input[name="subject"]')!, 200, 200);
    press(dialog, 200, 200); // on the dialog itself, but within its box
    expect(dialog.open).toBe(true);
  });

  it('does not close when a press inside ends outside (e.g. selecting text)', () => {
    void openLessonDialog(draft);
    const dialog = placeDialog();
    dialog.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 200 }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
    expect(dialog.open).toBe(true);
  });

  it('rejects a subject consisting only of spaces and saves once corrected', async () => {
    const result = openLessonDialog(draft);
    const subject = document.querySelector<HTMLInputElement>('input[name="subject"]')!;
    const form = document.querySelector<HTMLFormElement>('dialog form')!;
    subject.value = '   ';
    subject.dispatchEvent(new Event('input'));
    form.requestSubmit();
    expect(document.querySelector('dialog')!.open).toBe(true);
    expect(subject.validity.customError).toBe(true);
    subject.value = 'MAN';
    subject.dispatchEvent(new Event('input'));
    form.requestSubmit();
    await expect(result).resolves.toMatchObject({ action: 'save', lesson: { subject: 'MAN' } });
  });
});
