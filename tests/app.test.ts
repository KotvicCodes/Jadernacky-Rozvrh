import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app';
import { loadState } from '../src/storage';

function setup(): HTMLElement {
  localStorage.clear();
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.append(root);
  new App(root);
  return root;
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
  it('has the download, import and delete buttons in that order, and no add button', () => {
    const root = setup();
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.toolbar-actions > button, .toolbar-actions > .menu-wrap > .btn')].map((b) => b.textContent);
    expect(buttons).toEqual(['Stáhnout PNG', 'Stáhnout PDF', 'Importovat', 'Smazat rozvrh']);
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

describe('Importovat menu', () => {
  it('offers import from the device and from the FJFI website', () => {
    const root = setup();
    const button = root.querySelector<HTMLButtonElement>('.menu-wrap > .btn')!;
    const menu = root.querySelector<HTMLElement>('.menu')!;
    expect(menu.hidden).toBe(true);
    button.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual(['Ze zařízení…', 'Z webu FJFI…']);
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true);
  });
});
