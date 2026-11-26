/**
 * UI of the replacement finder ("Nahradit hodinu"): the dialog that picks the
 * lesson to skip and loads the official timetables, and the panel above the
 * timetable that lists what was found. The overlay on the timetable itself
 * is drawn by grid.ts.
 */
import { DAYS, paletteColor } from './config';
import { closeOnBackdropClick } from './dialog';
import { h } from './dom';
import { formatHour, type Lesson } from './model';
import { sourceNames, type CatalogTimetable, type ReplacementOption } from './replacements';
import './finder.css';

export interface FinderSearch {
  skippedId: string;
  timetables: CatalogTimetable[];
  /** Timetables that could not be loaded. */
  failed: number;
}

const SHORT_DAYS = ['Po', 'Út', 'St', 'Čt', 'Pá'] as const;

export function slotLabel(slot: { day: number; start: number; duration: number }, short = false): string {
  return `${(short ? SHORT_DAYS : DAYS)[slot.day]} ${formatHour(slot.start)}–${formatHour(slot.start + slot.duration)}`;
}

function countLabel(n: number, one: string, few: string, many: string): string {
  return `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
}

/**
 * Asks which lesson the student will miss, then loads every official
 * timetable. Resolves null when cancelled.
 */
export function openFinderDialog(lessons: readonly Lesson[], preselectId?: string): Promise<FinderSearch | null> {
  return new Promise((resolve) => {
    const abort = new AbortController();
    let result: FinderSearch | null = null;
    const choices = lessons
      .filter((l) => l.subject.trim())
      .sort((a, b) => a.day - b.day || a.start - b.start || a.subject.localeCompare(b.subject, 'cs'));
    const selected = choices.find((l) => l.id === preselectId) ?? choices[0];

    const options = h(
      'div',
      { class: 'finder-choices', role: 'radiogroup', 'aria-label': 'Hodina, kterou vynecháš' },
      ...choices.map((lesson) => {
        const color = paletteColor(lesson.color);
        return h(
          'label',
          { class: 'finder-choice', style: `--fill:${color.fill};--border:${color.border}` },
          h('input', { type: 'radio', name: 'skip', value: lesson.id, checked: lesson === selected }),
          h('span', { class: 'finder-choice-code' }, lesson.subject),
          h('span', { class: 'finder-choice-when' }, slotLabel(lesson, true)),
          h('span', { class: 'finder-choice-where' }, [lesson.room, lesson.lecturer].filter(Boolean).join(' · ') || '—'),
        );
      }),
    );
    const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const cancelBtn = h('button', { type: 'button', class: 'btn' }, 'Zrušit');
    const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary', disabled: !choices.length }, 'Hledat náhradu');
    const form = h(
      'form',
      { method: 'dialog', class: 'lesson-form finder-form' },
      h('h2', {}, 'Nahradit hodinu'),
      choices.length
        ? h('p', { class: 'hint' }, 'Vyber hodinu, na kterou nemůžeš přijít. Prohledám rozvrhy všech ročníků a ukážu, kdy se stejný předmět učí v čase, kdy máš volno.')
        : h('p', { class: 'hint' }, 'V tomhle rozvrhu zatím nejsou žádné hodiny. Přidej je nebo importuj rozvrh z webu FJFI.'),
      choices.length ? options : null,
      status,
      h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }), cancelBtn, submitBtn),
    );
    const dialog = h('dialog', { class: 'lesson-dialog finder-dialog', 'aria-label': 'Nahradit hodinu' }, form);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const skippedId = form.querySelector<HTMLInputElement>('input[name="skip"]:checked')?.value;
      if (!skippedId) return;
      submitBtn.disabled = true;
      options.querySelectorAll('input').forEach((input) => (input.disabled = true));
      status.classList.remove('finder-error');
      status.textContent = 'Načítám seznam rozvrhů…';
      void (async () => {
        try {
          const { loadCatalog } = await import('./import/catalog');
          const catalog = await loadCatalog((done, total) => {
            status.textContent = `Prohledávám rozvrhy… ${done}/${total}`;
          }, abort.signal);
          result = { skippedId, timetables: catalog.timetables, failed: catalog.failed };
          dialog.close();
        } catch (err) {
          if (abort.signal.aborted) return;
          status.textContent = err instanceof Error ? err.message : 'Rozvrhy se nepodařilo načíst.';
          status.classList.add('finder-error');
          submitBtn.disabled = false;
          options.querySelectorAll('input').forEach((input) => (input.disabled = false));
        }
      })();
    });
    cancelBtn.addEventListener('click', () => dialog.close());
    closeOnBackdropClick(dialog);
    dialog.addEventListener('close', () => {
      abort.abort();
      dialog.remove();
      resolve(result);
    });

    document.body.append(dialog);
    dialog.showModal();
    (form.querySelector<HTMLInputElement>('input[name="skip"]:checked') ?? cancelBtn).focus();
  });
}

export interface FinderPanelProps {
  skipped: Lesson;
  options: ReplacementOption[];
  failed: number;
  selectedKey: string | null;
  /** Whether the list of clashing options is unfolded. */
  clashesOpen: boolean;
  onSelect(key: string): void;
  onToggleClashes(open: boolean): void;
  onChange(): void;
  onClose(): void;
}

/** Summary above the timetable: what is being replaced, the free options, and (folded) the clashing ones. */
export function renderFinderPanel(props: FinderPanelProps): HTMLElement {
  const { skipped, options, failed, selectedKey } = props;
  const free = options.filter((o) => !o.clashes.length);
  const clashing = options.filter((o) => o.clashes.length);

  const changeBtn = h('button', { type: 'button', class: 'btn' }, 'Jiný předmět');
  changeBtn.addEventListener('click', props.onChange);
  const closeBtn = h('button', { type: 'button', class: 'btn', 'aria-keyshortcuts': 'Escape', title: 'Ukončit hledání (Esc)' }, 'Ukončit');
  closeBtn.addEventListener('click', props.onClose);

  const color = paletteColor(skipped.color);
  const head = h(
    'div',
    { class: 'finder-head' },
    h(
      'div',
      { class: 'finder-title' },
      h('span', { class: 'finder-eyebrow' }, 'Náhrada za'),
      h('span', { class: 'finder-code', style: `--fill:${color.fill};--border:${color.border}` }, skipped.subject),
      h('span', { class: 'finder-when' }, slotLabel(skipped)),
    ),
    h('div', { class: 'finder-actions' }, changeBtn, closeBtn),
  );

  // One fact per line, wrapping instead of overlapping or cutting names short.
  const item = (option: ReplacementOption) => {
    const busy = option.clashes.length > 0;
    const clashNames = [...new Set(option.clashes.map((c) => (c.id === skipped.id ? `${c.subject} (vynecháváš)` : c.subject || 'jinou hodinou')))];
    const button = h(
      'button',
      {
        type: 'button',
        class: `finder-item${busy ? ' finder-item--clash' : ''}`,
        'data-option-key': option.key,
        'aria-pressed': option.key === selectedKey ? 'true' : 'false',
        title: option.sources.map((s) => s.label).join('\n'),
      },
      h('span', { class: 'finder-item-when' }, slotLabel(option, true)),
      h('span', { class: 'finder-item-line' }, [option.lecturer, option.room].filter(Boolean).join(' · ') || 'Vyučující a učebna neuvedeny'),
      h('span', { class: 'finder-item-line finder-item-groups' }, sourceNames(option)),
      busy ? h('span', { class: 'finder-item-line finder-item-clash' }, `Koliduje s ${clashNames.join(', ')}`) : null,
    );
    button.addEventListener('click', () => props.onSelect(option.key));
    return h('li', {}, button);
  };

  const freeSection = free.length
    ? h('ol', { class: 'finder-list', 'aria-label': 'Volné termíny' }, ...free.map(item))
    : h('p', { class: 'finder-empty' }, options.length
      ? 'Žádný termín nevychází do tvého volného času. Termíny v kolizi najdeš níže.'
      : `V ostatních rozvrzích se předmět ${skipped.subject} nevyskytuje. Zkontroluj, že kód odpovídá oficiálnímu rozvrhu.`);

  let clashSection: HTMLElement | null = null;
  if (clashing.length) {
    const details = h(
      'details',
      { class: 'finder-clashes' },
      h('summary', {}, countLabel(clashing.length, 'termín v kolizi', 'termíny v kolizi', 'termínů v kolizi')),
      h('ol', { class: 'finder-list' }, ...clashing.map(item)),
    );
    details.open = props.clashesOpen || clashing.some((o) => o.key === selectedKey);
    details.addEventListener('toggle', () => props.onToggleClashes(details.open));
    clashSection = details;
  }

  const notes = [
    failed ? countLabel(failed, 'rozvrh se nepodařilo načíst', 'rozvrhy se nepodařilo načíst', 'rozvrhů se nepodařilo načíst') + '.' : '',
    'Shoda podle kódu předmětu; učebna a vyučující se mohou lišit. Náhradu si domluv s vyučujícím.',
  ].filter(Boolean);

  return h(
    'section',
    { class: 'finder-panel', 'aria-label': `Náhrada za ${skipped.subject}` },
    head,
    free.length ? h('h3', { class: 'finder-subhead' }, countLabel(free.length, 'volný termín', 'volné termíny', 'volných termínů')) : null,
    freeSection,
    clashSection,
    h('p', { class: 'finder-note' }, notes.join(' ')),
  );
}
