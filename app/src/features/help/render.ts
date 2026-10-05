import type { Block, Inline } from '../../core/text/markdown';

// Small pure helpers for rendering the manual's Markdown (Markdown.tsx).

export interface ListNode {
  c: Inline[];
  children: ListNode[];
}

/** The parser's flat list items (each with a depth) as a tree; a jump in depth nests one level. */
export function listTree(items: readonly { depth: number; c: Inline[] }[]): ListNode[] {
  const root: ListNode[] = [];
  const stack: { depth: number; list: ListNode[] }[] = [{ depth: -1, list: root }];
  for (const it of items) {
    while (stack.length > 1 && stack[stack.length - 1]!.depth >= it.depth) stack.pop();
    const node: ListNode = { c: it.c, children: [] };
    stack[stack.length - 1]!.list.push(node);
    stack.push({ depth: it.depth, list: node.children });
  }
  return root;
}

export type BlockGroup = { t: 'block'; b: Block } | { t: 'quotes'; items: Inline[][] };

/** Consecutive "> " lines are one note, not a note per line. */
export function groupBlocks(blocks: readonly Block[]): BlockGroup[] {
  const out: BlockGroup[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.t === 'quote') {
      if (last && last.t === 'quotes') last.items.push(b.c);
      else out.push({ t: 'quotes', items: [b.c] });
    } else out.push({ t: 'block', b });
  }
  return out;
}

const KEY_NAMES = ['Ctrl', 'Shift', 'Alt', 'Enter', 'Esc', 'Tab', 'Delete', 'Backspace', 'Space', 'Home', 'End', 'PageUp', 'PageDown', '⌘', '⇧', '⌥', '↑', '↓', '←', '→'];

/** Whether inline code is a key or key combination ("Ctrl+K", "Shift+F10", "F2", "Enter", "1–9"). */
export function isKeyLabel(s: string): boolean {
  const parts = s.split('+');
  if (parts.some((p) => !p)) return false;
  return parts.every((p) => KEY_NAMES.includes(p) || /^F\d{1,2}$/.test(p) || /^[A-Z0-9?/]$/.test(p) || /^\d\s?[–-]\s?\d$/.test(p));
}

/** "Ctrl+Shift+Z" as a Mac shows it: "⇧⌘Z". */
export function macKeys(s: string): string {
  const parts = s.split('+');
  const key = parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, -1));
  return `${mods.has('Alt') ? '⌥' : ''}${mods.has('Shift') ? '⇧' : ''}${mods.has('Ctrl') ? '⌘' : ''}${key}`;
}
