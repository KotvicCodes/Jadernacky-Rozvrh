import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { downloadPdf, downloadPng } from '../src/export';
import { loadState } from '../src/storage';

vi.mock('../src/export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/export')>()),
  downloadPdf: vi.fn(async () => {}),
  downloadPng: vi.fn(async () => {}),
}));

function setup(): HTMLElement {
  localStorage.clear();
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.append(root);
  new App(root);
  return root;
}

function menuFor(root: HTMLElement, label: string) {
  const button = [...root.querySelectorAll<HTMLButtonElement>('.menu-wrap > .btn')].find((b) => b.textContent === label)!;
  const menu = button.parentElement!.querySelector<HTMLElement>('.menu')!;
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  return { button, menu, items };
}

const tabs = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.tab[role="tab"]')];

function typeAndPress(input: HTMLInputElement, text: string, key: string): void {
  input.value = text;
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('timetable tabs', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = setup();
  });

  it('adds a timetable with the + tab and switches to it', () => {
    root.querySelector<HTMLButtonElement>('.tab-add')!.click();
    expect(tabs(root).map((t) => t.textContent)).toEqual(['Rozvrh 1', 'Rozvrh 2']);
    expect(tabs(root)[1]!.getAttribute('aria-selected')).toBe('true');
    tabs(root)[0]!.click();
    expect(tabs(root)[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('renames a timetable on double click and keeps it', () => {
    tabs(root)[0]!.dispatchEvent(new MouseEvent('click', { detail: 2, bubbles: true }));
    const input = root.querySelector<HTMLInputElement>('input.tab-input')!;
    expect(input.value).toBe('Rozvrh 1');
    typeAndPress(input, '  ZS 2026  ', 'Enter');
    expect(tabs(root)[0]!.textContent).toBe('ZS 2026');
    expect(loadState().schedules[0]!.name).toBe('ZS 2026');
  });

  it('spots a double click on a tab that was re-rendered by the first click', () => {
    root.querySelector<HTMLButtonElement>('.tab-add')!.click();
    tabs(root)[0]!.click(); // switches and re-renders
    tabs(root)[0]!.click(); // second click lands on the new element
    expect(root.querySelector('input.tab-input')).not.toBeNull();
  });

  it('cancels a rename with Escape', () => {
    tabs(root)[0]!.dispatchEvent(new MouseEvent('click', { detail: 2, bubbles: true }));
    typeAndPress(root.querySelector<HTMLInputElement>('input.tab-input')!, 'Nope', 'Escape');
    expect(root.querySelector('input.tab-input')).toBeNull();
    expect(tabs(root)[0]!.textContent).toBe('Rozvrh 1');
    expect(loadState().schedules[0]!.name).toBe('');
  });

  it('starts the rename field exactly as large as the tab, so nothing moves', () => {
    const tab = tabs(root)[0]!;
    tab.getBoundingClientRect = () => ({ width: 222.8, height: 36.4 }) as DOMRect;
    tab.dispatchEvent(new MouseEvent('click', { detail: 2, bubbles: true }));
    const input = root.querySelector<HTMLInputElement>('input.tab-input')!;
    expect([input.style.width, input.style.height]).toEqual(['222.8px', '36.4px']);
  });

  it('renames with F2 from the keyboard', () => {
    tabs(root)[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    typeAndPress(root.querySelector<HTMLInputElement>('input.tab-input')!, 'LS 2027', 'Enter');
    expect(tabs(root)[0]!.textContent).toBe('LS 2027');
  });

  it('persists tab order with Alt+arrows while keeping the active schedule', () => {
    root.querySelector<HTMLButtonElement>('.tab-add')!.click();
    root.querySelector<HTMLButtonElement>('.tab-add')!.click();
    const original = loadState();
    tabs(root)[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true }));
    const reordered = loadState();
    expect(reordered.schedules.map((s) => s.id)).toEqual([
      original.schedules[0]!.id, original.schedules[2]!.id, original.schedules[1]!.id,
    ]);
    expect(reordered.activeId).toBe(original.activeId);
    expect((document.activeElement as HTMLElement).dataset.scheduleId).toBe(original.activeId);
    // Ordinary arrows still switch schedules in their new order.
    tabs(root)[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(loadState().activeId).toBe(original.schedules[1]!.id);
    const reloaded = document.createElement('div');
    new App(reloaded);
    expect(tabs(reloaded).map((t) => t.dataset.scheduleId)).toEqual(reordered.schedules.map((s) => s.id));
  });

  it('keeps the timetable scroll position after a render', () => {
    const scroller = root.querySelector<HTMLElement>('.board-scroll')!;
    scroller.scrollLeft = 300;
    root.querySelector<HTMLButtonElement>('.tab-add')!.click();
    expect(root.querySelector('.board-scroll')!.scrollLeft).toBe(300);
  });
});

describe('dragging timetable tabs', () => {
  let root: HTMLElement;
  const items = () => [...root.querySelectorAll<HTMLElement>('.tab-item')];
  const pointer = (el: Element, type: string, x: number, y = 10) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    Object.entries({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y }).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
    el.dispatchEvent(event);
  };
  /** Lays the three tabs out 100 px wide with a 4 px gap, in a 20 px high bar. */
  const layOut = () => {
    root.querySelector<HTMLElement>('.tabs')!.getBoundingClientRect = () => ({ left: 0, right: 600, top: 0, bottom: 20, width: 600, height: 20 }) as DOMRect;
    items().forEach((item, i) => {
      item.getBoundingClientRect = () => {
        const shift = Number(/translateX\((-?[\d.]+)px\)/.exec(item.style.transform)?.[1] ?? 0);
        return { left: i * 104 + shift, right: i * 104 + 100 + shift, top: 0, bottom: 20, width: 100, height: 20 } as DOMRect;
      };
    });
  };
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    root = setup();
    root.querySelector<HTMLButtonElement>('.tab-add')!.click();
    root.querySelector<HTMLButtonElement>('.tab-add')!.click();
    root.querySelector<HTMLElement>('.tabs')!.style.columnGap = '4px';
    layOut();
  });
  const capture = { set: HTMLElement.prototype.setPointerCapture, has: HTMLElement.prototype.hasPointerCapture, release: HTMLElement.prototype.releasePointerCapture };
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(HTMLElement.prototype, { setPointerCapture: capture.set, hasPointerCapture: capture.has, releasePointerCapture: capture.release });
  });

  it('moves the tab with the pointer and slides the others aside to open a gap', () => {
    const [first, second, third] = items();
    pointer(tabs(root)[0]!, 'pointerdown', 50);
    pointer(tabs(root)[0]!, 'pointermove', 80);
    expect(first!.classList.contains('tab-item--dragging')).toBe(true);
    expect(first!.style.transform).toBe('translateX(30px)');
    expect([second!.style.transform, third!.style.transform]).toEqual(['', '']);
    pointer(tabs(root)[0]!, 'pointermove', 170);
    expect(first!.style.transform).toBe('translateX(120px)');
    expect([second!.style.transform, third!.style.transform]).toEqual(['translateX(-104px)', '']);
  });

  it('saves the new order on release and keeps the active tab', () => {
    const ids = loadState().schedules.map((s) => s.id);
    pointer(tabs(root)[0]!, 'pointerdown', 50);
    pointer(tabs(root)[0]!, 'pointermove', 400);
    pointer(tabs(root)[0]!, 'pointerup', 400);
    expect(loadState().schedules.map((s) => s.id)).toEqual([ids[1], ids[2], ids[0]]);
    expect(loadState().activeId).toBe(ids[2]);
    expect(items().every((item) => !item.classList.contains('tab-item--dragging'))).toBe(true);
  });

  it('puts the tab back on Escape or when released far from the tab bar', () => {
    const ids = loadState().schedules.map((s) => s.id);
    pointer(tabs(root)[0]!, 'pointerdown', 50);
    pointer(tabs(root)[0]!, 'pointermove', 400);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(items()[1]!.style.transform).toBe('');

    pointer(tabs(root)[0]!, 'pointerdown', 50);
    pointer(tabs(root)[0]!, 'pointermove', 400, 200);
    expect(items()[1]!.style.transform).toBe('');
    expect(items()[0]!.classList.contains('tab-item--outside')).toBe(true);
    pointer(tabs(root)[0]!, 'pointerup', 400, 200);
    expect(loadState().schedules.map((s) => s.id)).toEqual(ids);
    expect(items()[0]!.classList.contains('tab-item--dragging')).toBe(false);
    expect(items()[0]!.classList.contains('tab-item--outside')).toBe(false);
  });

  it('still switches tabs on a click without movement', () => {
    pointer(tabs(root)[0]!, 'pointerdown', 50);
    pointer(tabs(root)[0]!, 'pointerup', 50);
    tabs(root)[0]!.click();
    expect(tabs(root)[0]!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('closing timetable tabs', () => {
  let root: HTMLElement;
  const closeButtons = () => [...root.querySelectorAll<HTMLButtonElement>('.tab-close')];
  beforeEach(() => {
    root = setup();
    root.querySelector<HTMLButtonElement>('.tab-add')!.click();
    root.querySelector<HTMLButtonElement>('.tab-add')!.click();
    vi.stubGlobal('confirm', vi.fn(() => true));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows a labelled × on every tab, outside the tab order', () => {
    expect(closeButtons().map((b) => b.getAttribute('aria-label'))).toEqual(['Zavřít rozvrh Rozvrh 1', 'Zavřít rozvrh Rozvrh 2', 'Zavřít rozvrh Rozvrh 3']);
    expect(closeButtons().every((b) => b.tabIndex === -1)).toBe(true);
    // The tablist still holds only tabs (and the + button) for assistive tech.
    expect([...root.querySelectorAll('.tab-item')].every((item) => item.getAttribute('role') === 'presentation')).toBe(true);
  });

  it('asks first, and keeps everything when the answer is no', () => {
    vi.mocked(confirm).mockReturnValueOnce(false);
    closeButtons()[0]!.click();
    expect(confirm).toHaveBeenCalledWith('Opravdu smazat rozvrh „Rozvrh 1“?');
    expect(loadState().schedules).toHaveLength(3);
  });

  it('closes an inactive tab without switching away from the active one', () => {
    const active = loadState().activeId;
    closeButtons()[0]!.click();
    expect(loadState().schedules).toHaveLength(2);
    expect(loadState().activeId).toBe(active);
    expect(tabs(root).find((t) => t.getAttribute('aria-selected') === 'true')!.dataset.scheduleId).toBe(active);
  });

  it('switches to a neighbouring tab after closing the active one', () => {
    const ids = loadState().schedules.map((s) => s.id);
    tabs(root)[1]!.click();
    closeButtons()[1]!.click();
    expect(loadState().activeId).toBe(ids[2]);
    closeButtons()[1]!.click(); // the last tab: falls back to the one before it
    expect(loadState().activeId).toBe(ids[0]);
  });

  it('leaves one new empty timetable after closing the last tab', () => {
    closeButtons()[0]!.click();
    closeButtons()[0]!.click();
    closeButtons()[0]!.click();
    const state = loadState();
    expect(state.schedules).toHaveLength(1);
    expect(state.schedules[0]!.lessons).toEqual([]);
    expect(state.activeId).toBe(state.schedules[0]!.id);
  });

  it('closes the focused tab with Delete and keeps keyboard focus in the tab bar', () => {
    const ids = loadState().schedules.map((s) => s.id);
    const tab = tabs(root)[2]!;
    tab.focus();
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(loadState().schedules.map((s) => s.id)).toEqual(ids.slice(0, 2));
    expect((document.activeElement as HTMLElement).dataset.scheduleId).toBe(ids[1]);
    // ⌫ on a Mac keyboard does the same.
    tabs(root)[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(loadState().schedules.map((s) => s.id)).toEqual([ids[1]]);
  });

  it('does not switch, rename or drag the tab when its × is clicked', () => {
    const active = loadState().activeId;
    closeButtons()[0]!.dispatchEvent(new MouseEvent('click', { detail: 2, bubbles: true }));
    expect(root.querySelector('input.tab-input')).toBeNull();
    expect(loadState().activeId).toBe(active);
  });

  it('uses the same confirmation and neighbour logic for Smazat rozvrh', () => {
    const ids = loadState().schedules.map((s) => s.id);
    tabs(root)[1]!.click();
    root.querySelector<HTMLButtonElement>('.btn-danger')!.click();
    expect(confirm).toHaveBeenCalledWith('Opravdu smazat rozvrh „Rozvrh 2“?');
    expect(loadState().schedules.map((s) => s.id)).toEqual([ids[0], ids[2]]);
    expect(loadState().activeId).toBe(ids[2]);
  });
});

describe('lesson edits while the active schedule changes', () => {
  it('saves a lesson into the schedule that opened the dialog', async () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
    const root = setup();
    const originalId = tabs(root)[0]!.dataset.scheduleId;
    root.querySelector<HTMLButtonElement>('.slot')!.click();
    // Simulates an asynchronous file import switching schedules behind a modal.
    root.querySelector<HTMLButtonElement>('.tab-add')!.click();
    const subject = document.querySelector<HTMLInputElement>('dialog input[name="subject"]')!;
    subject.value = 'MAN';
    document.querySelector<HTMLFormElement>('dialog form')!.requestSubmit();
    await vi.waitFor(() => expect(loadState().schedules[0]!.lessons).toHaveLength(1));
    const state = loadState();
    expect(state.schedules.find((s) => s.id === originalId)!.lessons[0]!.subject).toBe('MAN');
    expect(state.schedules.find((s) => s.id === state.activeId)!.lessons).toEqual([]);
  });
});

describe('timetable ID in the corner', () => {
  it('is typed by hand on click, and drives the Obor/Kruh pickers', () => {
    const root = setup();
    root.querySelector<HTMLButtonElement>('.corner-edit')!.click();
    typeAndPress(root.querySelector<HTMLInputElement>('input.corner-input')!, 'bc1fi_pf2', 'Enter');
    expect(root.querySelector('.corner-edit')?.textContent).toBe('FI_PF2');
    const [obor, kruh] = [...root.querySelectorAll<HTMLSelectElement>('.toolbar select')];
    expect(obor!.selectedOptions[0]!.textContent).toBe('Fyzikální inženýrství, spec. Počítačová fyzika');
    expect(kruh!.value).toBe('2');
    // The tab falls back to the ID while the timetable has no name.
    expect(tabs(root)[0]!.textContent).toBe('FI_PF2');
  });

  it('keeps free text that matches no program', () => {
    const root = setup();
    root.querySelector<HTMLButtonElement>('.corner-edit')!.click();
    typeAndPress(root.querySelector<HTMLInputElement>('input.corner-input')!, 'Můj rozvrh', 'Enter');
    expect(root.querySelector('.corner-edit')?.textContent).toBe('Můj rozvrh');
    expect(loadState().schedules[0]!.specId).toBe('Můj rozvrh');
  });
});

describe('toolbar and header', () => {
  it('has the download, import, replacement and delete buttons in that order, and no add button', () => {
    const root = setup();
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.toolbar-actions > button, .toolbar-actions > .menu-wrap > .btn')].map((b) => b.textContent);
    expect(buttons).toEqual(['Stáhnout', 'Importovat', 'Nahradit hodinu', 'Smazat rozvrh']);
  });

  it('shows no subtitle or hint, but credits the author and links bug reports to the repo', () => {
    const root = setup();
    expect(root.querySelector('.topbar strong')?.textContent).toBe('Jaderňácký Rozvrh');
    const credit = root.querySelector<HTMLAnchorElement>('.topbar-credit')!;
    expect(credit.textContent).toBe('Vytvořil Kotvič');
    expect(credit.href).toBe('https://github.com/KotvicCodes');
    expect(root.querySelector('.topbar')?.textContent).toBe('Jaderňácký RozvrhVytvořil Kotvič');
    expect(root.querySelector('.hint')).toBeNull();
    const bug = root.querySelector<HTMLAnchorElement>('.site-footer a')!;
    expect(bug.textContent).toBe('Našel/našla jsi bug? Oprav ho!');
    expect(bug.href).toBe('https://github.com/KotvicCodes/Jadernacky-Rozvrh');
    expect([credit.rel, bug.rel]).toEqual(['noopener', 'noopener']);
  });
});

describe('Stáhnout menu', () => {
  beforeEach(() => vi.mocked(downloadPdf).mockClear() && vi.mocked(downloadPng).mockClear());

  it('offers PDF and PNG in one menu that works like Importovat', () => {
    const root = setup();
    const { button, menu, items } = menuFor(root, 'Stáhnout');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(items.map((i) => i.textContent)).toEqual(['PDF', 'PNG']);
    button.click();
    expect(menu.hidden).toBe(false);
    expect(document.activeElement).toBe(items[0]);
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    button.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(true);
  });

  it('downloads the chosen format and keeps the button disabled while the file is prepared', async () => {
    let finish!: () => void;
    vi.mocked(downloadPdf).mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const root = setup();
    const { button, menu, items } = menuFor(root, 'Stáhnout');
    button.click();
    items[0]!.click();
    expect(menu.hidden).toBe(true);
    expect(downloadPdf).toHaveBeenCalledOnce();
    expect(downloadPng).not.toHaveBeenCalled();
    expect(root.querySelector('.status')!.textContent).toBe('Připravuji soubor…');
    // Stays disabled across a re-render in the meantime.
    root.querySelector<HTMLButtonElement>('.tab-add')!.click();
    expect(menuFor(root, 'Stáhnout').button.disabled).toBe(true);
    finish();
    await vi.waitFor(() => expect(root.querySelector('.status')!.textContent).toBe('PDF staženo.'));
    expect(menuFor(root, 'Stáhnout').button.disabled).toBe(false);

    menuFor(root, 'Stáhnout').button.click();
    menuFor(root, 'Stáhnout').items[1]!.click();
    await vi.waitFor(() => expect(root.querySelector('.status')!.textContent).toBe('PNG staženo.'));
    expect(downloadPng).toHaveBeenCalledOnce();
  });
});

describe('Importovat menu', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds a web timetable directly from JSON with fresh lesson IDs on each import', async () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.dispatchEvent(new Event('close')); };
    const manifest = { version: 2, generatedAt: '2026-11-23T00:00:00Z', years: [{
      id: 'bs1', label: '1. ročník Bc.', programs: [{ code: 'JCF', name: 'Jaderná a částicová fyzika',
        kruhs: [{ kruh: null, id: 'Bc1JCF1', file: 'Bc1JCF1-abcd.json' }] }],
    }] };
    const fetcher = vi.fn(async (url: URL) => Response.json(String(url).endsWith('manifest.json') ? manifest : {
      version: 1, id: 'Bc1JCF1', specId: 'JCF', lessons: [{
        day: 0, start: 8, duration: 2, subject: 'MAN', lecturer: '', room: '', color: 'green',
      }],
    }));
    vi.stubGlobal('fetch', fetcher);
    const root = setup();
    for (let i = 0; i < 2; i++) {
      [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'Z webu FJFI')!.click();
      await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('dialog button[type="submit"]')?.disabled).toBe(false));
      document.querySelector<HTMLFormElement>('dialog form')!.requestSubmit();
      await vi.waitFor(() => expect(tabs(root)).toHaveLength(i + 2));
    }
    const state = loadState();
    expect(state.schedules.slice(1)).toEqual([expect.objectContaining({ specId: 'JCF', lessons: [expect.objectContaining({ subject: 'MAN' })] }),
      expect.objectContaining({ specId: 'JCF' })]);
    expect(state.activeId).toBe(state.schedules[2]!.id);
    expect(state.schedules[1]!.lessons[0]!.id).not.toBe(state.schedules[2]!.lessons[0]!.id);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('.json'))).toBe(true);
    expect(document.body.classList.contains('busy')).toBe(false);
  });

  it('offers import from the device and from the FJFI website', () => {
    const root = setup();
    const { button, menu } = menuFor(root, 'Importovat');
    expect(menu.hidden).toBe(true);
    button.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual(['Ze zařízení', 'Z webu FJFI']);
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true);
  });

  it('closes the import menu when keyboard focus leaves it', () => {
    const root = setup();
    const { button, menu } = menuFor(root, 'Importovat');
    button.click();
    expect(menu.hidden).toBe(false);
    root.querySelector<HTMLButtonElement>('.btn-danger')!.focus();
    expect(menu.hidden).toBe(true);
  });
});
