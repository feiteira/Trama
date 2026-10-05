// Layout arithmetic of the virtualised list (VirtualList.tsx): where each item starts, and
// which item is at a given scroll position.

/**
 * Top offset of every item, plus the total height at index n: `padding` above the first item
 * and below the last, `gap` between items.
 */
export function offsetsOf(keys: readonly string[], height: (key: string) => number, gap: number, padding: number): Float64Array {
  const n = keys.length;
  const out = new Float64Array(n + 1);
  let y = padding;
  for (let i = 0; i < n; i++) {
    out[i] = y;
    y += height(keys[i]!) + (i < n - 1 ? gap : 0);
  }
  out[n] = y + padding;
  return out;
}

/** The item at vertical position `y` (the last one starting at or above it), within [0, n). */
export function firstVisible(offsets: ArrayLike<number>, y: number, n: number): number {
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
