// Between the DOM of the document viewer and canonical text offsets (UTF-16, half-open).
//
// The viewer's markup carries its offsets, so mapping needs no text walking:
//   paragraph  <p data-ps="120" data-pe="245">  one line of the text
//   run        <span data-s="130" data-e="151">  exactly text.slice(130, 151), one text node
//   chrome     anything with data-chrome         (timestamp chips, play buttons): not text
// A selection boundary can land in a run's text node (the usual case), on an element between
// children (triple click, keyboard selection at a line start), or inside chrome; each resolves
// to the nearest text position on the side the boundary faces.
//
// Written against a minimal node shape so it runs in Node tests with plain objects.

export interface NodeLike {
  nodeType: number;
  parentNode: NodeLike | null;
  childNodes: ArrayLike<NodeLike>;
  getAttribute?: (name: string) => string | null;
}

const ELEMENT = 1;
const TEXT = 3;

export type Bias = 'start' | 'end';

function attr(n: NodeLike, name: string): string | null {
  return n.nodeType === ELEMENT && n.getAttribute ? n.getAttribute(name) : null;
}

function num(n: NodeLike, name: string): number | null {
  const v = attr(n, name);
  if (v === null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

const isChrome = (n: NodeLike) => attr(n, 'data-chrome') !== null;

function indexIn(parent: NodeLike, child: NodeLike): number {
  const kids = parent.childNodes;
  for (let i = 0; i < kids.length; i++) if (kids[i] === child) return i;
  return -1;
}

/** First text offset inside `n`, or null when it holds no text (chrome, stray whitespace). */
function startOf(n: NodeLike): number | null {
  if (n.nodeType !== ELEMENT || isChrome(n)) return null;
  const s = num(n, 'data-s') ?? num(n, 'data-ps');
  if (s !== null) return s;
  const kids = n.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const v = startOf(kids[i]!);
    if (v !== null) return v;
  }
  return null;
}

/** Last text offset inside `n` (the end of its last run), or null. */
function endOf(n: NodeLike): number | null {
  if (n.nodeType !== ELEMENT || isChrome(n)) return null;
  const e = num(n, 'data-e') ?? num(n, 'data-pe');
  if (e !== null) return e;
  const kids = n.childNodes;
  for (let i = kids.length - 1; i >= 0; i--) {
    const v = endOf(kids[i]!);
    if (v !== null) return v;
  }
  return null;
}

function within(root: NodeLike, n: NodeLike | null): boolean {
  for (let c = n; c; c = c.parentNode) if (c === root) return true;
  return false;
}

/**
 * The text offset of a DOM boundary point (container, offset) inside `root`. `bias` says which
 * way to look when the point is between paragraphs or inside chrome: a selection's start looks
 * forward ('start'), its end backward ('end'). Null when the point is outside `root`.
 */
export function boundaryOffset(root: NodeLike, container: NodeLike, offset: number, bias: Bias): number | null {
  if (!within(root, container)) return null;
  let node: NodeLike = container;
  let k = offset;

  // Inside chrome: stand just before (start) or after (end) the outermost chrome element.
  let chrome: NodeLike | null = null;
  for (let c: NodeLike | null = node; c && c !== root; c = c.parentNode) if (isChrome(c)) chrome = c;
  if (chrome && chrome.parentNode) {
    const parent: NodeLike = chrome.parentNode;
    k = indexIn(parent, chrome) + (bias === 'end' ? 1 : 0);
    node = parent;
  }

  if (node.nodeType === TEXT) {
    const parent = node.parentNode;
    if (!parent) return null;
    const s = num(parent, 'data-s');
    const e = num(parent, 'data-e');
    if (s !== null && e !== null) return s + Math.max(0, Math.min(k, e - s));
    // Stray text (whitespace between elements): its position among its siblings.
    k = indexIn(parent, node) + (k > 0 ? 1 : 0);
    node = parent;
  }

  for (;;) {
    const s = num(node, 'data-s');
    const e = num(node, 'data-e');
    if (s !== null && e !== null) return k <= 0 ? s : e;
    const kids = node.childNodes;
    const forward = (): number | null => {
      for (let i = Math.max(0, k); i < kids.length; i++) {
        const v = startOf(kids[i]!);
        if (v !== null) return v;
      }
      return null;
    };
    const backward = (): number | null => {
      for (let i = Math.min(k, kids.length) - 1; i >= 0; i--) {
        const v = endOf(kids[i]!);
        if (v !== null) return v;
      }
      return null;
    };
    const v = bias === 'start' ? forward() ?? backward() : backward() ?? forward();
    if (v !== null) return v;
    const ps = num(node, 'data-ps');
    if (ps !== null) return bias === 'start' ? ps : num(node, 'data-pe') ?? ps;
    if (node === root || !node.parentNode) return null;
    const parent: NodeLike = node.parentNode;
    k = indexIn(parent, node) + (bias === 'end' ? 1 : 0);
    node = parent;
  }
}

export interface RangeLike {
  startContainer: NodeLike;
  startOffset: number;
  endContainer: NodeLike;
  endOffset: number;
}

/** The text span a DOM range covers inside `root`, ordered; null when it is outside. */
export function rangeOffsets(root: NodeLike, r: RangeLike): { start: number; end: number } | null {
  const a = boundaryOffset(root, r.startContainer, r.startOffset, 'start');
  const b = boundaryOffset(root, r.endContainer, r.endOffset, 'end');
  if (a === null || b === null) return null;
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/** True when `pos` falls between the two halves of a surrogate pair (an emoji, say). */
export function splitsSurrogate(text: string, pos: number): boolean {
  if (pos <= 0 || pos >= text.length) return false;
  const hi = text.charCodeAt(pos - 1);
  const lo = text.charCodeAt(pos);
  return hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff;
}

/**
 * A selected span made safe: clamped to the text, ordered, and widened so it never splits a
 * character made of two code units. Null when nothing is selected.
 */
export function cleanSelection(text: string, a: number, b: number): { start: number; end: number } | null {
  let start = Math.max(0, Math.min(text.length, Math.min(a, b)));
  let end = Math.max(0, Math.min(text.length, Math.max(a, b)));
  if (end <= start) return null;
  if (splitsSurrogate(text, start)) start--;
  if (splitsSurrogate(text, end)) end++;
  if (end <= start) return null;
  // Only whitespace (or a line break between paragraphs): nothing to code.
  if (!/\S/.test(text.slice(start, end))) return null;
  return { start, end };
}

/**
 * Where offset `pos` is inside paragraph element `para`: the run's text node and the offset in
 * it. At a boundary between two runs, 'start' picks the later run and 'end' the earlier one.
 */
export function pointIn(para: NodeLike, pos: number, bias: Bias = 'start'): { node: NodeLike; offset: number } | null {
  const runs: NodeLike[] = [];
  const collect = (n: NodeLike) => {
    if (n.nodeType !== ELEMENT || isChrome(n)) return;
    if (num(n, 'data-s') !== null) {
      runs.push(n);
      return;
    }
    const kids = n.childNodes;
    for (let i = 0; i < kids.length; i++) collect(kids[i]!);
  };
  collect(para);
  let best: NodeLike | null = null;
  for (const r of runs) {
    const s = num(r, 'data-s')!;
    const e = num(r, 'data-e')!;
    if (pos < s || pos > e) continue;
    best = r;
    if (bias === 'end' ? pos <= e : pos < e) break;
  }
  if (!best) {
    if (!runs.length) return { node: para, offset: 0 };
    const last = runs[runs.length - 1]!;
    best = pos < num(runs[0]!, 'data-s')! ? runs[0]! : last;
    pos = best === last ? num(last, 'data-e')! : num(best, 'data-s')!;
  }
  const s = num(best, 'data-s')!;
  const textNode = best.childNodes[0];
  if (!textNode) return { node: best, offset: 0 };
  return { node: textNode, offset: pos - s };
}
