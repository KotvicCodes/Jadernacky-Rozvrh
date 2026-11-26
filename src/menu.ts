import { h } from './dom';

export interface MenuItem {
  label: string;
  onSelect(): void;
}

export interface Menu {
  /** The button and its popup, to put in the toolbar. */
  element: HTMLElement;
  button: HTMLButtonElement;
  /** Closes the popup and stops listening outside it. */
  close(): void;
}

/**
 * A toolbar button that opens a small menu (Importovat, Stáhnout). Arrow keys
 * move between items; Escape, a click outside or focus leaving it closes it.
 */
export function renderMenu(label: string, items: readonly MenuItem[]): Menu {
  const button = h('button', { type: 'button', class: 'btn btn-menu', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, label);
  const entries = items.map((item) => h('button', { type: 'button', class: 'menu-item', role: 'menuitem' }, item.label));
  const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': label, hidden: true }, ...entries);
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
      const i = entries.indexOf(document.activeElement as HTMLButtonElement);
      entries[(i + (e.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length]!.focus();
    }
  };
  const open = () => {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside);
    wrap.addEventListener('keydown', onKey);
    entries[0]?.focus();
  };
  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside);
    wrap.removeEventListener('keydown', onKey);
  };
  // Safari (and Firefox on macOS) don't focus a button on click, so pressing an
  // item, or the button to close the menu, would blur the focused item and
  // close the menu before the click lands (which then reopened it).
  wrap.addEventListener('mousedown', (e) => {
    if (!menu.hidden) e.preventDefault();
  });
  wrap.addEventListener('focusout', (e) => {
    if (!wrap.contains(e.relatedTarget as Node | null)) close();
  });
  button.addEventListener('click', () => {
    if (menu.hidden) {
      open();
    } else {
      close();
      button.focus();
    }
  });
  entries.forEach((entry, i) => entry.addEventListener('click', () => {
    close();
    // The item is about to be hidden; keep keyboard focus on the menu's button.
    button.focus();
    items[i]!.onSelect();
  }));
  return { element: wrap, button, close };
}
