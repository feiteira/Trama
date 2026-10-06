// Word cloud placement: words from most to least frequent, each sized by frequency and placed
// at the first free spot along an Archimedean spiral from the centre. Deterministic (no
// randomness), so the same counts always give the same cloud. Measuring text is the caller's
// business (canvas measureText in the screen, a fixed width per character in tests).

export interface CloudWord {
  word: string;
  count: number;
}

export interface PlacedWord {
  word: string;
  count: number;
  /** Centre of the word's box; `y` is the vertical centre (draw with dominant-baseline central). */
  x: number;
  y: number;
  size: number;
  width: number;
  height: number;
  /** 0–1: share of the most frequent word's count (for emphasis). */
  weight: number;
}

export interface CloudOptions {
  width: number;
  height: number;
  /** Font sizes in px for the least and most frequent word. */
  minSize?: number;
  maxSize?: number;
  /** Width of `word` at `size` px. */
  measure: (word: string, size: number) => number;
  /** Space kept between words (px). */
  gap?: number;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Font size by square root of the count: area grows with frequency, as readers judge it. */
export function wordSize(count: number, min: number, max: number, minSize: number, maxSize: number): number {
  if (max <= min) return (minSize + maxSize) / 2;
  const f = (Math.sqrt(count) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min));
  return minSize + (maxSize - minSize) * Math.max(0, Math.min(1, f));
}

/**
 * Places as many words as fit. Words that find no free spot inside the box are left out (the
 * table beside the cloud lists every word).
 */
export function layoutCloud(words: readonly CloudWord[], opts: CloudOptions): PlacedWord[] {
  if (!words.length) return [];
  const { width: W, height: H } = opts;
  const minSize = opts.minSize ?? 12;
  const maxSize = opts.maxSize ?? Math.max(minSize + 4, Math.min(56, H / 5));
  const gap = opts.gap ?? 3;
  const counts = words.map((w) => w.count);
  // A loop, not Math.max(...counts): spreading a long list overflows the call stack.
  const max = counts.reduce((a, b) => (b > a ? b : a), -Infinity);
  const min = counts.reduce((a, b) => (b < a ? b : a), Infinity);
  const placed: PlacedWord[] = [];
  const boxes: Box[] = [];
  const cx = W / 2;
  const cy = H / 2;
  // Ellipse-shaped spiral so the cloud fills a wide box rather than a circle in its middle.
  const ax = W >= H ? 1 : W / H;
  const ay = W >= H ? H / W : 1;
  const maxR = Math.hypot(W, H) / 2 / Math.min(ax, ay);
  // Shrink every size when the words would cover more than about half the box: a cloud that
  // drops most of its words says less than a smaller one.
  let area = 0;
  for (const w of words) {
    const size = wordSize(w.count, min, max, minSize, maxSize);
    area += opts.measure(w.word, size) * size * 1.08;
  }
  const shrink = Math.min(1, Math.sqrt((0.5 * W * H) / Math.max(1, area)));
  for (const w of words) {
    const size = Math.max(9, wordSize(w.count, min, max, minSize, maxSize) * shrink);
    const width = opts.measure(w.word, size);
    const height = size * 1.08;
    if (width > W || height > H) continue;
    let found: Box | null = null;
    // Constant steps along the spiral (about 4 px), so far rings are searched as finely as near ones.
    for (let a = 0, r = 0; r < maxR; a += Math.min(0.5, 4 / Math.max(r, 4))) {
      r = 1.6 * a;
      const x = cx + r * Math.cos(a) * ax;
      const y = cy + r * Math.sin(a) * ay;
      const box = { x0: x - width / 2 - gap, y0: y - height / 2 - gap, x1: x + width / 2 + gap, y1: y + height / 2 + gap };
      if (box.x0 + gap < 0 || box.y0 + gap < 0 || box.x1 - gap > W || box.y1 - gap > H) continue;
      if (!boxes.some((b) => overlaps(b, box))) {
        found = box;
        break;
      }
    }
    if (!found) continue;
    boxes.push(found);
    placed.push({
      word: w.word,
      count: w.count,
      x: (found.x0 + found.x1) / 2,
      y: (found.y0 + found.y1) / 2,
      size,
      width,
      height,
      weight: max > 0 ? w.count / max : 0,
    });
  }
  return placed;
}
