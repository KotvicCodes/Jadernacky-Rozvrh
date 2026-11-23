import { DAYS, PALETTE, paletteLabel } from './config';
import { h } from './dom';
import { formatHour, maxDuration, normalizeLesson, startHours, type Lesson, type LessonDraft } from './model';

export type DialogResult =
  | { action: 'save'; lesson: Lesson }
  | { action: 'delete'; id: string }
  | { action: 'cancel' };

/**
 * Opens the add/edit lesson dialog. `existing` edits that lesson; otherwise
 * `draft` pre-fills a new one (e.g. the clicked day and hour).
 */
export function openLessonDialog(draft: LessonDraft, existing?: Lesson): Promise<DialogResult> {
  return new Promise((resolve) => {
    const initial = existing ?? draft;
    const isEdit = Boolean(existing);

    const subject = h('input', { name: 'subject', required: true, maxlength: 80, autocomplete: 'off', value: initial.subject });
    const validateSubject = () => subject.setCustomValidity(subject.value.trim() ? '' : 'Vyplň název předmětu.');
    subject.addEventListener('input', validateSubject);
    const room = h('input', { name: 'room', maxlength: 80, autocomplete: 'off', value: initial.room });
    const lecturer = h('input', { name: 'lecturer', maxlength: 80, autocomplete: 'off', value: initial.lecturer });

    const day = h('select', { name: 'day' }, ...DAYS.map((d, i) => h('option', { value: i, selected: i === initial.day }, d)));
    const start = h(
      'select',
      { name: 'start' },
      ...startHours().map((hour) => h('option', { value: hour, selected: hour === initial.start }, formatHour(hour))),
    );
    const duration = h('select', { name: 'duration' });

    const fillDurations = (selected: number) => {
      const max = maxDuration(Number(start.value));
      duration.replaceChildren();
      for (let d = 1; d <= max; d++) {
        duration.append(h('option', { value: d, selected: d === Math.min(selected, max) }, `${d} h`));
      }
    };
    fillDurations(initial.duration);
    start.addEventListener('change', () => fillDurations(Number(duration.value)));

    const swatches = h(
      'div',
      { class: 'swatches', role: 'radiogroup', 'aria-label': 'Barva podle katedry' },
      ...PALETTE.map((c) =>
        h(
          'label',
          { class: 'swatch', title: paletteLabel(c), style: `--fill:${c.fill};--border:${c.border}` },
          h('input', { type: 'radio', name: 'color', value: c.id, checked: c.id === initial.color, 'aria-label': paletteLabel(c) }),
          h('span', { class: 'swatch-chip', 'aria-hidden': 'true' }, c.dept),
        ),
      ),
    );

    const field = (label: string, control: HTMLElement) => h('label', { class: 'field' }, h('span', {}, label), control);

    const deleteBtn = isEdit ? h('button', { type: 'button', class: 'btn btn-danger' }, 'Smazat') : null;
    const cancelBtn = h('button', { type: 'button', class: 'btn' }, 'Zrušit');

    const form = h(
      'form',
      { method: 'dialog', class: 'lesson-form' },
      h('h2', {}, isEdit ? 'Upravit hodinu' : 'Přidat hodinu'),
      field('Předmět', subject),
      h('div', { class: 'field-row' }, field('Učebna', room), field('Vyučující', lecturer)),
      h('div', { class: 'field-row field-row--3' }, field('Den', day), field('Začátek', start), field('Délka', duration)),
      h('fieldset', { class: 'field' }, h('legend', {}, 'Barva (katedra)'), swatches),
      h('div', { class: 'dialog-actions' }, deleteBtn, h('span', { class: 'spacer' }), cancelBtn, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Uložit')),
    );

    const dialog = h('dialog', { class: 'lesson-dialog', 'aria-label': isEdit ? 'Upravit hodinu' : 'Přidat hodinu' }, form);
    let result: DialogResult = { action: 'cancel' };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      validateSubject();
      if (!form.reportValidity()) return;
      const color = form.querySelector<HTMLInputElement>('input[name="color"]:checked')?.value ?? initial.color;
      result = {
        action: 'save',
        lesson: normalizeLesson({
          id: existing?.id,
          day: Number(day.value),
          start: Number(start.value),
          duration: Number(duration.value),
          subject: subject.value,
          room: room.value,
          lecturer: lecturer.value,
          color,
        }),
      };
      dialog.close();
    });
    cancelBtn.addEventListener('click', () => dialog.close());
    closeOnBackdropClick(dialog);
    deleteBtn?.addEventListener('click', () => {
      if (existing) result = { action: 'delete', id: existing.id };
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });

    document.body.append(dialog);
    dialog.showModal();
    subject.focus();
  });
}

/**
 * Closes a modal dialog (as a cancel) when the user clicks outside it, on
 * the backdrop. The press must also start outside, so selecting text in a
 * field and releasing the mouse past the edge does not close it.
 */
export function closeOnBackdropClick(dialog: HTMLDialogElement): void {
  const outside = (e: MouseEvent) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (e) => {
    pressedOutside = e.target === dialog && outside(e);
  });
  dialog.addEventListener('click', (e) => {
    if (pressedOutside && e.target === dialog && outside(e)) dialog.close();
    pressedOutside = false;
  });
}
