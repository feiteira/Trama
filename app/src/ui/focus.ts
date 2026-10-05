import type React from 'react';

// Focus helpers for dialogs, menus and popovers (browser only).

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/** Elements inside `root` that Tab can reach, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0 && !el.closest('[inert]'),
  );
}

/** Keeps Tab and Shift+Tab inside `root` (a modal). */
export function trapTab(e: KeyboardEvent | React.KeyboardEvent, root: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = focusables(root);
  if (!items.length) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Gives the focus back to `to` (the control that opened a dialog or menu) when it is still on
 * the page and nothing that matters took the focus meanwhile — never steals it from a field
 * somewhere else (adapted from Sala's focusReturn).
 */
export function focusBackTo(to: Element | null): void {
  if (!(to instanceof HTMLElement) || to === document.body || !to.isConnected) return;
  const active = document.activeElement;
  const adrift =
    !active || active === document.body || !active.isConnected ||
    (active instanceof HTMLElement && active.tabIndex < 0 && !active.matches('input, textarea, select, [contenteditable="true"]'));
  const dialog = to.closest('[aria-modal="true"]');
  if (adrift || (dialog && active && dialog.contains(active))) to.focus({ preventScroll: true });
}

/** True for an element where typing goes (keys like Ctrl+Z belong to it then). */
export function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'].includes(el.type);
}

/** True while a modal (a dialog, the command palette, the locking curtain) covers the screen. */
export function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

// Layers that close on Escape, newest last: only the top one hears it, so Esc in a menu opened
// from a dialog closes the menu, not the dialog.
const layers: symbol[] = [];

export function pushLayer(): { isTop: () => boolean; pop: () => void } {
  const id = Symbol('layer');
  layers.push(id);
  return {
    isTop: () => layers[layers.length - 1] === id,
    pop: () => {
      const i = layers.indexOf(id);
      if (i >= 0) layers.splice(i, 1);
    },
  };
}
