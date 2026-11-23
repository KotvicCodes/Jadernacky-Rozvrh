import { DEFAULT_COLOR_ID, KRUH_OPTIONS, PROGRAMS, canonicalSpecId, formatSpecId, parseSpecId } from './config';
import { openLessonDialog } from './dialog';
import { h } from './dom';
import { enablePointerDrag } from './drag';
import { downloadPdf, downloadPng } from './export';
import { renderGrid } from './grid';
import { startInlineEdit } from './inline-edit';
import { cleanText, createSchedule, normalizeLesson, scheduleLabel, type Lesson, type LessonDraft, type Schedule } from './model';
import { loadState, saveState, type AppState } from './storage';

/** Author's GitHub profile (header credit) and this project's repository (bug link). */
const AUTHOR_URL = 'https://github.com/KotvicCodes';
const REPO_URL = 'https://github.com/KotvicCodes/Jadernacky-Rozvrh';

export class App {
  private state: AppState;
  private readonly root: HTMLElement;
  private readonly boardHost = h('section', { class: 'board-host' });
  private readonly tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Rozvrhy' });
  private readonly toolbar = h('div', { class: 'toolbar' });
  private readonly status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  private readonly boardResizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.fitBoard());

  constructor(root: HTMLElement) {
    this.root = root;
    this.state = loadState();
    this.root.replaceChildren(
      h(
        'header',
        { class: 'topbar' },
        h('strong', {}, 'Jaderňácký Rozvrh'),
        h('a', { class: 'topbar-credit', href: AUTHOR_URL, target: '_blank', rel: 'noopener' }, 'Vytvořil Kotvič'),
      ),
      h(
        'main',
        { class: 'container' },
        this.tabs,
        this.toolbar,
        this.boardHost,
        this.status,
      ),
      h(
        'footer',
        { class: 'site-footer' },
        h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'Našel/našla jsi bug? Oprav ho!'),
      ),
    );
    this.render();
    this.boardResizeObserver?.observe(this.boardHost);
    this.listenForFiles();
  }

  /** Paste (Ctrl+V) and drag-and-drop of PDF/image files start an import. */
  private listenForFiles(): void {
    document.addEventListener('paste', (e) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, dialog')) return;
      const file = [...(e.clipboardData?.files ?? [])].find(isImportable);
      if (file) {
        e.preventDefault();
        void this.importFile(file, file.name);
      }
    });
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        document.body.classList.add('drop-target');
      }
    });
    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) document.body.classList.remove('drop-target');
    });
    window.addEventListener('drop', (e) => {
      document.body.classList.remove('drop-target');
      // Prevent the browser from navigating away and losing unsaved work even
      // when the dropped file is unsupported.
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
      const file = [...(e.dataTransfer?.files ?? [])].find(isImportable);
      if (!file) return;
      e.preventDefault();
      void this.importFile(file, file.name);
    });
  }

  private importing = false;

  private async importFile(file: Blob, name: string): Promise<void> {
    if (this.importing) return;
    this.importing = true;
    document.body.classList.add('busy');
    try {
      const { importSchedule } = await import('./import');
      const { schedule, usedOcr } = await importSchedule(file, name, (message) => (this.status.textContent = message));
      this.state.schedules.push(schedule);
      this.state.activeId = schedule.id;
      const check = usedOcr ? ' Texty byly rozpoznány z obrázku – zkontroluj je prosím (nejpřesnější je import z PDF).' : '';
      this.commit(`Importováno ${schedule.lessons.length} hodin.${check}`);
    } catch (err) {
      this.status.textContent = `Import se nepovedl: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.importing = false;
      document.body.classList.remove('busy');
    }
  }

  private get active(): Schedule {
    return this.state.schedules.find((s) => s.id === this.state.activeId) ?? this.state.schedules[0]!;
  }

  private commit(message?: string, schedule = this.active): void {
    schedule.updatedAt = Date.now();
    const ok = saveState(this.state);
    this.status.textContent = ok ? (message ?? '') : 'Rozvrh se nepodařilo uložit v prohlížeči (soukromé okno?).';
    this.render();
  }

  /** Last tab click, to spot a double click even if the tab was re-rendered in between. */
  private lastTabClick = { id: '', at: 0 };
  private closeImportMenu?: () => void;

  private reorderSchedule(id: string, index: number): void {
    const from = this.state.schedules.findIndex((s) => s.id === id);
    if (from < 0 || from === index) return;
    const [schedule] = this.state.schedules.splice(from, 1);
    this.state.schedules.splice(index, 0, schedule!);
    this.lastTabClick = { id: '', at: 0 };
    this.commit('Pořadí rozvrhů uloženo.', schedule);
    this.tabFor(id)?.focus({ preventScroll: true });
  }

  /** One tab per schedule: click switches, double click (or F2) renames, "+" adds one. */
  private renderTabs(): void {
    const active = this.active;
    const tabs = this.state.schedules.map((s, i) => {
      const label = scheduleLabel(s, i);
      const tab = h(
        'button',
        {
          type: 'button',
          class: 'tab',
          role: 'tab',
          'data-schedule-id': s.id,
          'aria-selected': s.id === active.id ? 'true' : 'false',
          tabindex: s.id === active.id ? 0 : -1,
          title: `${label} – dvojklikem přejmenuješ, přetažením nebo Alt+šipkou přesuneš`,
          'aria-keyshortcuts': 'F2 Alt+ArrowLeft Alt+ArrowRight',
        },
        label,
      );
      let targetIndex = i;
      const clearDrag = () => {
        tab.classList.remove('tab--dragging');
        this.tabs.querySelectorAll('.tab--drop-before, .tab--drop-after').forEach((el) => el.classList.remove('tab--drop-before', 'tab--drop-after'));
      };
      enablePointerDrag(tab, {
        scrollHost: this.tabs,
        onStart: () => { tab.classList.add('tab--dragging'); this.lastTabClick = { id: '', at: 0 }; },
        onMove: (point) => {
          const rect = this.tabs.getBoundingClientRect();
          clearDrag();
          tab.classList.add('tab--dragging');
          targetIndex = i;
          if (point.y < rect.top - 30 || point.y > rect.bottom + 30) return;
          const others = [...this.tabs.querySelectorAll<HTMLElement>('[data-schedule-id]')].filter((el) => el !== tab);
          targetIndex = others.filter((el) => { const r = el.getBoundingClientRect(); return point.x > r.left + r.width / 2; }).length;
          const marker = others[targetIndex] ?? others.at(-1);
          marker?.classList.add(targetIndex === others.length ? 'tab--drop-after' : 'tab--drop-before');
        },
        onEnd: () => { clearDrag(); this.reorderSchedule(s.id, targetIndex); },
        onCancel: clearDrag,
      });
      tab.addEventListener('click', (e) => {
        const now = Date.now();
        const isDouble = e.detail >= 2 || (this.lastTabClick.id === s.id && now - this.lastTabClick.at < 500);
        this.lastTabClick = { id: s.id, at: now };
        if (s.id !== this.state.activeId) {
          this.state.activeId = s.id;
          saveState(this.state);
          this.render();
        }
        if (isDouble) this.renameSchedule(s.id);
      });
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'F2') {
          e.preventDefault();
          this.renameSchedule(s.id);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const list = this.state.schedules;
          if (e.altKey) {
            this.reorderSchedule(s.id, Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1))));
            return;
          }
          const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]!;
          this.state.activeId = next.id;
          saveState(this.state);
          this.render();
          this.tabFor(next.id)?.focus();
        }
      });
      return tab;
    });

    const addTab = h('button', { type: 'button', class: 'tab tab-add', title: 'Nový rozvrh', 'aria-label': 'Nový rozvrh' }, '+');
    addTab.addEventListener('click', () => {
      const schedule = createSchedule();
      this.state.schedules.push(schedule);
      this.state.activeId = schedule.id;
      this.commit('Vytvořen nový rozvrh. Dvojklikem na záložku ho přejmenuješ.');
    });

    this.tabs.replaceChildren(...tabs, addTab);
    const selected = this.tabFor(active.id);
    if (selected) {
      const rect = selected.getBoundingClientRect();
      const host = this.tabs.getBoundingClientRect();
      if (rect.left < host.left) this.tabs.scrollLeft -= host.left - rect.left;
      else if (rect.right > host.right) this.tabs.scrollLeft += rect.right - host.right;
    }
  }

  private tabFor(id: string): HTMLElement | undefined {
    return [...this.tabs.querySelectorAll<HTMLElement>('[data-schedule-id]')].find((el) => el.dataset.scheduleId === id);
  }

  private renameSchedule(id: string): void {
    const tab = this.tabFor(id);
    const schedule = this.state.schedules.find((s) => s.id === id);
    if (!tab || !schedule) return;
    startInlineEdit(tab, {
      value: schedule.name || scheduleLabel(schedule, this.state.schedules.indexOf(schedule)),
      label: 'Název rozvrhu',
      placeholder: 'např. ZS 2026',
      className: 'tab-input',
      keepSize: true,
      onCommit: (value) => {
        const name = cleanText(value);
        // Leaving the default label as it was keeps the schedule unnamed.
        if (name === schedule.name || (!schedule.name && name === scheduleLabel(schedule, this.state.schedules.indexOf(schedule)))) return;
        schedule.name = name;
        this.commit(name ? `Rozvrh přejmenován na „${name}“.` : 'Název rozvrhu smazán.');
      },
    });
  }

  private renderToolbar(): void {
    this.closeImportMenu?.();
    const active = this.active;

    // Obor + kruh build the ID shown on the timetable ("JCF1"). An ID that
    // matches no known program (older or OCR-read) is kept as its own option.
    const parsed = parseSpecId(active.specId);
    const programSelect = h(
      'select',
      {},
      h('option', { value: '', selected: !active.specId }, '— vyber obor —'),
      ...(active.specId && !parsed ? [h('option', { value: CUSTOM_SPEC, selected: true }, active.specId)] : []),
      ...PROGRAMS.map((p) => h('option', { value: p.code, selected: p === parsed?.program }, p.name)),
    );
    // Kruh is the same choice for every program (counts change by year);
    // "–" leaves the number out. A kruh outside the list (e.g. an older
    // "JI_JR4") is kept as an extra option.
    const kruhs = parsed?.group && !KRUH_OPTIONS.includes(parsed.group) ? [...KRUH_OPTIONS, parsed.group] : KRUH_OPTIONS;
    const groupSelect = h(
      'select',
      { disabled: !parsed },
      ...kruhs.map((k) => h('option', { value: k ?? '', selected: k === (parsed?.group ?? null) }, k === null ? '–' : String(k))),
    );
    const saveSpec = () => {
      if (programSelect.value === CUSTOM_SPEC) return;
      const program = PROGRAMS.find((p) => p.code === programSelect.value);
      const group = groupSelect.value ? Number(groupSelect.value) : null;
      active.specId = program ? formatSpecId(program, group) : '';
      this.commit('Obor uložen.');
    };
    programSelect.addEventListener('change', saveSpec);
    groupSelect.addEventListener('change', saveSpec);

    const deleteBtn = h('button', { type: 'button', class: 'btn btn-danger' }, 'Smazat rozvrh');
    deleteBtn.addEventListener('click', () => {
      const label = scheduleLabel(active, this.state.schedules.indexOf(active));
      if (!confirm(`Opravdu smazat rozvrh „${label}“?`)) return;
      this.state.schedules = this.state.schedules.filter((s) => s.id !== active.id);
      if (this.state.schedules.length === 0) this.state.schedules.push(createSchedule());
      this.state.activeId = this.state.schedules[0]!.id;
      this.commit('Rozvrh smazán.');
    });


    const pdfBtn = h('button', { type: 'button', class: 'btn' }, 'Stáhnout PDF');
    pdfBtn.addEventListener('click', () => void this.runExport('pdf', pdfBtn));
    const pngBtn = h('button', { type: 'button', class: 'btn' }, 'Stáhnout PNG');
    pngBtn.addEventListener('click', () => void this.runExport('png', pngBtn));

    const fileInput = h('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void this.importFile(file, file.name);
      fileInput.value = '';
    });
    const importMenu = this.renderImportMenu(() => fileInput.click());

    // Two rows: the pickers, then all buttons in one row below them (it only
    // wraps when the screen is too narrow).
    this.toolbar.replaceChildren(
      h(
        'div',
        { class: 'toolbar-row' },
        h('label', { class: 'toolbar-field' }, h('span', {}, 'Obor'), programSelect),
        h('label', { class: 'toolbar-field toolbar-field--narrow' }, h('span', {}, 'Kruh'), groupSelect),
      ),
      h('div', { class: 'toolbar-row toolbar-actions' }, pngBtn, pdfBtn, importMenu, fileInput, deleteBtn),
    );
  }

  /** "Importovat" opens a small menu: a file from this device, or a timetable straight from the FJFI website. */
  private renderImportMenu(pickFile: () => void): HTMLElement {
    const button = h('button', { type: 'button', class: 'btn btn-menu', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, 'Importovat');
    const fromDevice = h('button', { type: 'button', class: 'menu-item', role: 'menuitem' }, 'Ze zařízení');
    const fromWeb = h('button', { type: 'button', class: 'menu-item', role: 'menuitem' }, 'Z webu FJFI');
    const menu = h('div', { class: 'menu', role: 'menu', hidden: true }, fromDevice, fromWeb);
    const wrap = h('div', { class: 'menu-wrap' }, button, menu);

    const onOutside = (e: Event) => {
      if (!wrap.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        button.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [fromDevice, fromWeb];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]!.focus();
      }
    };
    const open = () => {
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onOutside);
      wrap.addEventListener('keydown', onKey);
      fromDevice.focus();
    };
    const close = () => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside);
      wrap.removeEventListener('keydown', onKey);
    };
    this.closeImportMenu = close;
    wrap.addEventListener('focusout', (e) => {
      if (!wrap.contains(e.relatedTarget as Node | null)) close();
    });
    button.addEventListener('click', () => (menu.hidden ? open() : close()));
    fromDevice.addEventListener('click', () => {
      close();
      pickFile();
    });
    fromWeb.addEventListener('click', () => {
      close();
      void this.importFromWeb();
    });
    return wrap;
  }

  private async importFromWeb(): Promise<void> {
    if (this.importing) return;
    this.importing = true;
    try {
      const { pickFjfiTimetable } = await import('./import/web');
      const picked = await pickFjfiTimetable();
      if (picked) {
        this.state.schedules.push(picked.schedule);
        this.state.activeId = picked.schedule.id;
        this.commit(`Importováno ${picked.schedule.lessons.length} hodin.`);
      }
    } catch (err) {
      this.status.textContent = `Import se nepovedl: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.importing = false;
    }
  }

  /** Fit the complete desktop timetable on a phone, keeping its proportions.
   * Native pinch zoom remains available for reading/editing small lessons. */
  private fitBoard(): void {
    const host = this.boardHost.querySelector<HTMLElement>('.board-scroll');
    const board = host?.querySelector<HTMLElement>('.board');
    if (!host || !board || host.clientWidth === 0) return;
    const fits = host.clientWidth < 756;
    board.style.width = fits ? '756px' : '';
    board.style.zoom = fits ? String(host.clientWidth / 756) : '';
  }

  private render(): void {
    const scrollLeft = this.boardHost.querySelector('.board-scroll')?.scrollLeft ?? 0;
    this.renderTabs();
    this.renderToolbar();
    this.boardHost.replaceChildren(
      renderGrid(this.active, {
        onSlotClick: (day, hour) => void this.addLesson(day, hour),
        onLessonClick: (lesson) => void this.editLesson(lesson),
        onLessonMove: (lesson, day, start) => this.moveLesson(lesson, day, start),
        onSpecIdEdit: (value) => {
          this.active.specId = canonicalSpecId(cleanText(value));
          this.commit(this.active.specId ? `ID rozvrhu: ${this.active.specId}` : 'ID rozvrhu smazáno.');
        },
      }),
    );
    this.fitBoard();
    const scroller = this.boardHost.querySelector('.board-scroll');
    if (scroller) scroller.scrollLeft = scrollLeft;
  }

  private moveLesson(lesson: Lesson, day: number, start: number): void {
    const hadFocus = document.activeElement?.closest('[data-lesson-id]') !== null;
    this.active.lessons = this.active.lessons.map((l) => (l.id === lesson.id ? normalizeLesson({ ...l, day, start }) : l));
    this.commit(`Přesunuto: ${lesson.subject}`);
    if (hadFocus) this.boardHost.querySelector<HTMLElement>(`[data-lesson-id="${CSS.escape(lesson.id)}"]`)?.focus();
  }

  private async runExport(kind: 'pdf' | 'png', button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    this.status.textContent = 'Připravuji soubor…';
    try {
      await (kind === 'pdf' ? downloadPdf(this.active) : downloadPng(this.active));
      this.status.textContent = kind === 'pdf' ? 'PDF staženo.' : 'PNG staženo.';
    } catch (err) {
      this.status.textContent = `Export se nepovedl: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      button.disabled = false;
    }
  }

  private async addLesson(day: number, hour: number): Promise<void> {
    const schedule = this.active;
    const draft: LessonDraft = { day, start: hour, duration: 2, subject: '', room: '', lecturer: '', color: DEFAULT_COLOR_ID };
    const result = await openLessonDialog(draft);
    if (result.action === 'save') {
      schedule.lessons.push(result.lesson);
      this.commit(`Přidáno: ${result.lesson.subject}`, schedule);
    }
  }

  private async editLesson(lesson: Lesson): Promise<void> {
    const schedule = this.active;
    const result = await openLessonDialog(lesson, lesson);
    const lessons = schedule.lessons;
    if (result.action === 'save') {
      schedule.lessons = lessons.map((l) => (l.id === result.lesson.id ? result.lesson : l));
      this.commit(`Upraveno: ${result.lesson.subject}`, schedule);
    } else if (result.action === 'delete') {
      schedule.lessons = lessons.filter((l) => l.id !== result.id);
      this.commit('Hodina smazána.', schedule);
    }
  }
}

/** Value of the Obor option holding an ID that matches no known program. */
const CUSTOM_SPEC = '__custom__';

function isImportable(file: File): boolean {
  return file.type === 'application/pdf' || file.type.startsWith('image/') || /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
}
