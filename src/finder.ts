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
import { isReplaceable, sourceNames, subjectKey, type CatalogTimetable, type ReplacementOption } from './replacements';
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
 * The student's replaceable lessons grouped by course code, each group by
 * time; groups in order of their first lesson. Language lessons are left out.
 */
export function groupBySubject(lessons: readonly Lesson[]): Lesson[][] {
  const groups = new Map<string, Lesson[]>();
  const sorted = lessons
    .filter((l) => isReplaceable(l.subject))
    .sort((a, b) => a.day - b.day || a.start - b.start || a.subject.localeCompare(b.subject, 'cs'));
  for (const lesson of sorted) {
    const key = subjectKey(lesson.subject);
    const group = groups.get(key);
    if (group) group.push(lesson);
    else groups.set(key, [lesson]);
  }
  return [...groups.values()];
}

/**
 * Asks which lesson the student will miss: first the subject (each listed
 * once), then, for a subject taught more than once a week, which of its
 * lessons. Then loads every official timetable. Resolves null when cancelled.
 */
export function openFinderDialog(lessons: readonly Lesson[], preselectId?: string): Promise<FinderSearch | null> {
  return new Promise((resolve) => {
    const abort = new AbortController();
    let result: FinderSearch | null = null;
    const groups = groupBySubject(lessons);
    const hasLanguages = lessons.some((l) => l.subject.trim() && !isReplaceable(l.subject));
    const preselected = groups.find((g) => g.some((l) => l.id === preselectId));
    let current = preselected ?? groups[0];

    const subjects = h(
      'div',
      { class: 'finder-choices', role: 'radiogroup', 'aria-label': 'Předmět' },
      ...groups.map((group, index) => {
        const first = group[0]!;
        const color = paletteColor(first.color);
        const input = h('input', { type: 'radio', name: 'subject', value: index, checked: group === current });
        input.addEventListener('change', () => {
          current = group;
          fillOccurrences();
          if (group.length > 1) occurrences.scrollIntoView?.({ block: 'nearest' });
        });
        return h(
          'label',
          { class: 'finder-choice', style: `--fill:${color.fill};--border:${color.border}` },
          input,
          h('span', { class: 'finder-choice-code' }, first.subject),
          group.length === 1
            ? h('span', { class: 'finder-choice-when' }, slotLabel(first, true))
            : h('span', { class: 'finder-choice-when' }, `${group.length}× týdně`),
          group.length === 1
            ? h('span', { class: 'finder-choice-where' }, [first.room, first.lecturer].filter(Boolean).join(' · ') || '—')
            : h('span', { class: 'finder-choice-where' }, group.map((l) => `${SHORT_DAYS[l.day]} ${formatHour(l.start)}`).join(', ')),
        );
      }),
    );

    // Second question, only for a subject taught more than once a week.
    const occurrenceLegend = h('legend', {});
    const occurrenceList = h('div', { class: 'finder-occurrence-list' });
    const occurrences = h('fieldset', { class: 'finder-occurrences', hidden: true }, occurrenceLegend, occurrenceList);
    const fillOccurrences = () => {
      const group = current;
      const multiple = !!group && group.length > 1;
      occurrences.hidden = !multiple;
      occurrenceList.replaceChildren(...(multiple ? group : []).map((lesson) => {
        const input = h('input', { type: 'radio', name: 'skip', value: lesson.id, checked: lesson.id === preselectId });
        input.addEventListener('change', updateSubmit);
        return h(
          'label',
          { class: 'finder-occurrence' },
          input,
          h('span', { class: 'finder-choice-when' }, slotLabel(lesson, true)),
          h('span', { class: 'finder-choice-where' }, [lesson.room, lesson.lecturer].filter(Boolean).join(' · ') || '—'),
        );
      }));
      if (multiple) occurrenceLegend.textContent = `Kterou hodinu ${group[0]!.subject} vynecháš?`;
      updateSubmit();
    };
    const skippedId = () => (current && current.length === 1
      ? current[0]!.id
      : form.querySelector<HTMLInputElement>('input[name="skip"]:checked')?.value);

    const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const cancelBtn = h('button', { type: 'button', class: 'btn' }, 'Zrušit');
    const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary', disabled: true }, 'Hledat náhradu');
    let loading = false;
    const updateSubmit = () => {
      submitBtn.disabled = loading || !skippedId();
    };
    const form = h(
      'form',
      { method: 'dialog', class: 'lesson-form finder-form' },
      h('h2', {}, 'Nahradit hodinu'),
      groups.length
        ? h('p', { class: 'hint' }, 'Vyber předmět, na který nemůžeš přijít. Prohledám rozvrhy všech ročníků a ukážu, kdy se stejný předmět učí v čase, kdy máš volno.')
        : h('p', { class: 'hint' }, hasLanguages
          ? 'V tomhle rozvrhu nejsou žádné hodiny, které by šlo nahradit.'
          : 'V tomhle rozvrhu zatím nejsou žádné hodiny. Přidej je nebo importuj rozvrh z webu FJFI.'),
      hasLanguages ? h('p', { class: 'hint finder-languages' }, 'Jazyky (JAZ) tu nahradit nejde.') : null,
      groups.length ? subjects : null,
      occurrences,
      status,
      h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }), cancelBtn, submitBtn),
    );
    const dialog = h('dialog', { class: 'lesson-dialog finder-dialog', 'aria-label': 'Nahradit hodinu' }, form);
    const lock = (on: boolean) => {
      loading = on;
      form.querySelectorAll('input').forEach((input) => (input.disabled = on));
      updateSubmit();
    };
    fillOccurrences();

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const id = skippedId();
      if (!id || loading) return;
      lock(true);
      status.classList.remove('finder-error');
      status.textContent = 'Načítám seznam rozvrhů…';
      void (async () => {
        try {
          const { loadCatalog } = await import('./import/catalog');
          const catalog = await loadCatalog((done, total) => {
            status.textContent = `Prohledávám rozvrhy… ${done}/${total}`;
          }, abort.signal);
          result = { skippedId: id, timetables: catalog.timetables, failed: catalog.failed };
          dialog.close();
        } catch (err) {
          if (abort.signal.aborted) return;
          status.textContent = err instanceof Error ? err.message : 'Rozvrhy se nepodařilo načíst.';
          status.classList.add('finder-error');
          lock(false);
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
    (form.querySelector<HTMLInputElement>('input[name="subject"]:checked') ?? cancelBtn).focus();
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
  onClose(): void;
}

/** Summary above the timetable: what is being replaced, the free options, and (folded) the clashing ones. */
export function renderFinderPanel(props: FinderPanelProps): HTMLElement {
  const { skipped, options, failed, selectedKey } = props;
  const free = options.filter((o) => !o.clashes.length);
  const clashing = options.filter((o) => o.clashes.length);

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
    h('div', { class: 'finder-actions' }, closeBtn),
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
      : `Předmět ${skipped.subject} se v ostatních rozvrzích neučí v žádném jiném čase. Pokud by měl, zkontroluj, že kód odpovídá oficiálnímu rozvrhu.`);

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


  return h(
    'section',
    { class: 'finder-panel', 'aria-label': `Náhrada za ${skipped.subject}` },
    head,
    free.length ? h('h3', { class: 'finder-subhead' }, countLabel(free.length, 'volný termín', 'volné termíny', 'volných termínů')) : null,
    freeSection,
    clashSection,
    // Only shown when some timetables could not be searched.
    failed ? h('p', { class: 'finder-note' }, `${countLabel(failed, 'rozvrh se nepodařilo načíst', 'rozvrhy se nepodařilo načíst', 'rozvrhů se nepodařilo načíst')}.`) : null,
  );
}
