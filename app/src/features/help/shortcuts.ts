// The keyboard shortcuts reference in Help. Keys are written once, platform-neutrally, and
// shown as "Ctrl+K" or "⌘K" by formatKeys. Labels are keys in the `help.keys` namespace.

export interface KeyCombo {
  /** Ctrl, or ⌘ on a Mac. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  key: string;
}

export type ShortcutLabel =
  | 'palette' | 'lock' | 'undo' | 'redo' | 'back' | 'escape' | 'tab'
  | 'move' | 'select' | 'find' | 'openHere' | 'favourite' | 'searchCode' | 'inVivo' | 'clear' | 'remove' | 'workbenchKeys'
  | 'playPause' | 'skip' | 'playHere'
  | 'listMove' | 'listOpen' | 'listSelect' | 'menu' | 'rename' | 'delete'
  | 'helpSearch' | 'helpBack';

export type ShortcutGroup = 'everywhere' | 'reading' | 'coding' | 'recording' | 'lists' | 'help';

export interface Shortcut {
  /** Alternatives, shown separated (either works). */
  keys: KeyCombo[];
  label: ShortcutLabel;
}

export const SHORTCUTS: readonly { group: ShortcutGroup; items: readonly Shortcut[] }[] = [
  {
    group: 'everywhere',
    items: [
      { keys: [{ mod: true, key: 'K' }], label: 'palette' },
      { keys: [{ mod: true, key: 'L' }], label: 'lock' },
      { keys: [{ mod: true, key: 'Z' }], label: 'undo' },
      { keys: [{ mod: true, shift: true, key: 'Z' }, { mod: true, key: 'Y' }], label: 'redo' },
      { keys: [{ alt: true, key: '←' }], label: 'back' },
      { keys: [{ key: 'Tab' }, { shift: true, key: 'Tab' }], label: 'tab' },
      { keys: [{ key: 'Esc' }], label: 'escape' },
    ],
  },
  {
    group: 'reading',
    items: [
      { keys: [{ key: '↑' }, { key: '↓' }, { key: '←' }, { key: '→' }], label: 'move' },
      { keys: [{ shift: true, key: '←' }, { shift: true, key: '→' }, { shift: true, key: '↑' }, { shift: true, key: '↓' }], label: 'select' },
      { keys: [{ mod: true, key: 'F' }], label: 'find' },
      { keys: [{ key: 'Enter' }], label: 'openHere' },
      { keys: [{ key: '?' }], label: 'workbenchKeys' },
    ],
  },
  {
    group: 'coding',
    items: [
      { keys: [{ key: '1 – 9' }], label: 'favourite' },
      { keys: [{ key: 'Enter' }], label: 'searchCode' },
      { keys: [{ mod: true, key: 'I' }], label: 'inVivo' },
      { keys: [{ key: 'Esc' }], label: 'clear' },
      { keys: [{ key: 'Delete' }], label: 'remove' },
    ],
  },
  {
    group: 'recording',
    items: [
      { keys: [{ mod: true, key: 'Space' }], label: 'playPause' },
      { keys: [{ alt: true, shift: true, key: '←' }, { alt: true, shift: true, key: '→' }], label: 'skip' },
      { keys: [{ alt: true, key: 'Enter' }], label: 'playHere' },
    ],
  },
  {
    group: 'lists',
    items: [
      { keys: [{ key: '↑' }, { key: '↓' }], label: 'listMove' },
      { keys: [{ key: 'Enter' }], label: 'listOpen' },
      { keys: [{ key: 'Space' }], label: 'listSelect' },
      { keys: [{ key: 'F2' }], label: 'rename' },
      { keys: [{ key: 'Delete' }], label: 'delete' },
      { keys: [{ shift: true, key: 'F10' }, { key: 'Menu' }], label: 'menu' },
    ],
  },
  {
    group: 'help',
    items: [
      { keys: [{ mod: true, key: 'F' }, { key: '/' }], label: 'helpSearch' },
      { keys: [{ alt: true, key: '←' }], label: 'helpBack' },
    ],
  },
];

/** "Ctrl+Shift+Z" elsewhere, "⇧⌘Z" on a Mac (the order macOS menus use). */
export function formatKeys(k: KeyCombo, mac: boolean): string {
  if (mac) {
    const key = k.key === 'Enter' ? '↩' : k.key === 'Delete' ? '⌫' : k.key;
    return `${k.alt ? '⌥' : ''}${k.shift ? '⇧' : ''}${k.mod ? '⌘' : ''}${key}`;
  }
  return [k.mod ? 'Ctrl' : null, k.alt ? 'Alt' : null, k.shift ? 'Shift' : null, k.key].filter(Boolean).join('+');
}
