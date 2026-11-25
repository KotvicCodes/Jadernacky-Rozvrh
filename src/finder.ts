/**
 * UI of the replacement finder ("Najít náhradu"): the dialog that picks the
 * lesson to skip and loads the official timetables, and the panel above the
 * timetable that lists what was found. The overlay on the timetable itself
 * is drawn by grid.ts.
 */
import { DAYS, paletteColor } from './config';
import { closeOnBackdropClick } from './dialog';
import { h } from './dom';
import { formatHour, type Lesson } from './model';
import { rankReplacements, type CatalogTimetable, type ReplacementOption } from './replacements';
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

/** "Bc1JCF2", or "Bc1JCF2 +3" when more timetables share the lesson. */
export function sourcesShort(option: ReplacementOption): string {
  const [first, ...rest] = option.sources;
  return rest.length ? `${first!.id} +${rest.length}` : first?.id ?? '';
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
      h('h2', {}, 'Najít náhradní hodinu'),
      choices.length
        ? h('p', { class: 'hint' }, 'Vyber hodinu, na kterou nemůžeš přijít. Prohledám rozvrhy všech ročníků a ukážu, kdy se stejný předmět učí v čase, kdy máš volno.')
        : h('p', { class: 'hint' }, 'V tomhle rozvrhu zatím nejsou žádné hodiny. Přidej je nebo importuj rozvrh z webu FJFI.'),
      choices.length ? options : null,
      status,
      h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }), cancelBtn, submitBtn),
    );
    const dialog = h('dialog', { class: 'lesson-dialog finder-dialog', 'aria-label': 'Najít náhradní hodinu' }, form);

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
  onSelect(key: string): void;
  onChange(): void;
  onClose(): void;
}

/** Summary above the timetable: what is being replaced, how many options are free, and the list of all of them. */
export function renderFinderPanel(props: FinderPanelProps): HTMLElement {
  const { skipped, options, failed, selectedKey } = props;
  const ranked = rankReplacements(options);
  const free = ranked.filter((o) => !o.clashes.length).length;
  const clashing = ranked.length - free;

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
    h(
      'div',
      { class: 'finder-counts' },
      h('span', { class: 'finder-count finder-count--free' }, countLabel(free, 'volný termín', 'volné termíny', 'volných termínů')),
      clashing ? h('span', { class: 'finder-count finder-count--clash' }, `${clashing} v kolizi`) : null,
    ),
    h('div', { class: 'finder-actions' }, changeBtn, closeBtn),
  );

  const items = ranked.map((option) => {
    const busy = option.clashes.length > 0;
    const button = h(
      'button',
      {
        type: 'button',
        class: `finder-item${busy ? ' finder-item--clash' : ''}`,
        'data-option-key': option.key,
        'aria-pressed': option.key === selectedKey ? 'true' : 'false',
      },
      h('span', { class: 'finder-item-when' }, slotLabel(option, true)),
      h('span', { class: 'finder-item-where' }, [option.room, option.lecturer].filter(Boolean).join(' · ') || '—'),
      h('span', { class: 'finder-item-groups', title: option.sources.map((s) => s.label).join('\n') }, option.sources.map((s) => s.id).join(', ')),
      h(
        'span',
        { class: 'finder-item-state' },
        busy ? `koliduje s ${[...new Set(option.clashes.map((c) => (c.id === skipped.id ? `${c.subject} (vynecháváš)` : c.subject || 'hodinou')))].join(', ')}` : 'máš volno',
      ),
    );
    button.addEventListener('click', () => props.onSelect(option.key));
    return h('li', {}, button);
  });

  const notes = [
    failed ? countLabel(failed, 'rozvrh se nepodařilo načíst', 'rozvrhy se nepodařilo načíst', 'rozvrhů se nepodařilo načíst') + '.' : '',
    'Shoda podle kódu předmětu; učebna a vyučující se mohou lišit. Náhradu si domluv s vyučujícím.',
  ].filter(Boolean);

  return h(
    'section',
    { class: 'finder-panel', 'aria-label': `Náhrada za ${skipped.subject}` },
    head,
    ranked.length
      ? h('ol', { class: 'finder-list' }, ...items)
      : h('p', { class: 'finder-empty' }, `V ostatních rozvrzích se předmět ${skipped.subject} nevyskytuje. Zkontroluj, že kód odpovídá oficiálnímu rozvrhu.`),
    h('p', { class: 'finder-note' }, notes.join(' ')),
  );
}
