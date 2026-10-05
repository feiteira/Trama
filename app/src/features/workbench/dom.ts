import { type Para, paragraphIndexAt } from './model/paragraphs';
import { type NodeLike, pointIn } from './model/offsets';

// DOM helpers of the viewer: ranges for text offsets and their boxes. The text root's children
// are exactly the paragraph elements, in order, so paragraph i is `root.children[i]`.

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function point(root: HTMLElement, paras: readonly Para[], pos: number, bias: 'start' | 'end'): { node: Node; offset: number } | null {
  if (!paras.length) return null;
  let i = paragraphIndexAt(paras, pos);
  // An end exactly at a paragraph's start belongs to the end of the previous line.
  if (bias === 'end' && i > 0 && paras[i]!.start === pos && pos > 0) i--;
  const el = root.children[i];
  if (!el) return null;
  const p = paras[i]!;
  const at = Math.max(p.start, Math.min(p.end, pos));
  const r = pointIn(el as unknown as NodeLike, at, bias);
  return r ? { node: r.node as unknown as Node, offset: r.offset } : null;
}

/** A DOM range over text offsets [start, end), or null when the text is not rendered. */
export function rangeFor(root: HTMLElement, paras: readonly Para[], start: number, end: number): Range | null {
  const a = point(root, paras, start, 'start');
  const b = point(root, paras, end, 'end');
  if (!a || !b) return null;
  const r = document.createRange();
  try {
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
  } catch {
    return null;
  }
  return r;
}

/**
 * The line boxes of a span relative to `base` (the page element), one per line, merged where
 * the browser reports several boxes for one line.
 */
export function spanRects(root: HTMLElement, paras: readonly Para[], start: number, end: number, base: HTMLElement): Box[] {
  const r = rangeFor(root, paras, start, end);
  if (!r) return [];
  const b = base.getBoundingClientRect();
  const out: Box[] = [];
  for (const rect of r.getClientRects()) {
    if (rect.width < 0.5 || rect.height < 0.5) continue;
    const box = { top: rect.top - b.top, left: rect.left - b.left, width: rect.width, height: rect.height };
    const last = out[out.length - 1];
    if (last && Math.abs(last.top - box.top) < 2 && Math.abs(last.height - box.height) < 4 && box.left <= last.left + last.width + 2) {
      const right = Math.max(last.left + last.width, box.left + box.width);
      last.left = Math.min(last.left, box.left);
      last.width = right - last.left;
    } else out.push(box);
  }
  return out;
}

function charRect(root: HTMLElement, paras: readonly Para[], pos: number, text: string): DOMRect | null {
  // Two code units for an emoji, so the range never ends inside it.
  const code = text.charCodeAt(pos);
  const width = code >= 0xd800 && code <= 0xdbff ? 2 : 1;
  const r = rangeFor(root, paras, pos, Math.min(text.length, pos + width));
  if (!r) return null;
  const rects = r.getClientRects();
  for (const rect of rects) if (rect.height > 0) return rect;
  return null;
}

/** Vertical extent of a span relative to `baseTop` (cheap: measures its first and last character). */
export function spanExtent(root: HTMLElement, paras: readonly Para[], text: string, start: number, end: number, baseTop: number): { top: number; bottom: number } | null {
  if (end <= start) return null;
  const a = charRect(root, paras, start, text);
  let lastStart = end - 1;
  if (lastStart > start && text.charCodeAt(lastStart) >= 0xdc00 && text.charCodeAt(lastStart) <= 0xdfff) lastStart--;
  const b = lastStart === start ? a : charRect(root, paras, lastStart, text);
  if (!a || !b) return null;
  return { top: Math.min(a.top, b.top) - baseTop, bottom: Math.max(a.bottom, b.bottom) - baseTop };
}

/** Scrolls `scroller` so offset `pos` sits about a third of the way down. */
export function scrollToOffset(scroller: HTMLElement, root: HTMLElement, paras: readonly Para[], pos: number, text: string, opts: { smooth?: boolean; onlyIfHidden?: boolean } = {}): void {
  const s = scroller.getBoundingClientRect();
  let rect: { top: number; bottom: number } | null = null;
  const c = charRect(root, paras, Math.min(pos, Math.max(0, text.length - 1)), text);
  if (c) rect = c;
  else {
    const el = root.children[paragraphIndexAt(paras, pos)];
    if (el) rect = el.getBoundingClientRect();
  }
  if (!rect) return;
  if (opts.onlyIfHidden && rect.top >= s.top + 40 && rect.bottom <= s.bottom - 40) return;
  const target = scroller.scrollTop + (rect.top - s.top) - scroller.clientHeight * 0.32;
  scroller.scrollTo({ top: Math.max(0, target), behavior: opts.smooth ? 'smooth' : 'auto' });
}

/** Index range of the paragraphs on screen (plus `margin` px above and below). */
export function visibleParagraphs(scroller: HTMLElement, root: HTMLElement, margin: number): { first: number; last: number } {
  const kids = root.children;
  const n = kids.length;
  if (!n) return { first: 0, last: -1 };
  const s = scroller.getBoundingClientRect();
  const top = s.top - margin;
  const bottom = s.bottom + margin;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (kids[mid]!.getBoundingClientRect().bottom < top) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (kids[mid]!.getBoundingClientRect().top > bottom) hi = mid - 1;
    else lo = mid;
  }
  return { first, last: lo };
}
