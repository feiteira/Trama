// Windowing for long result lists: only the rows near the viewport are rendered.

/** Prefix sums: offsets[i] is where item i starts; offsets[n] is the total height. */
export function prefixOffsets(heights: readonly number[]): Float64Array {
  const out = new Float64Array(heights.length + 1);
  for (let i = 0; i < heights.length; i++) out[i + 1] = out[i]! + heights[i]!;
  return out;
}

/** Items [start, end) that intersect the viewport, widened by `overscan` items on each side. */
export function visibleRange(offsets: ArrayLike<number>, scrollTop: number, viewport: number, overscan = 6): [number, number] {
  const n = offsets.length - 1;
  if (n <= 0) return [0, 0];
  // First item whose end is below scrollTop.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid + 1]! <= scrollTop) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  let last = first;
  const bottom = scrollTop + viewport;
  while (last < n && offsets[last]! < bottom) last++;
  return [Math.max(0, first - overscan), Math.min(n, last + overscan)];
}

/** The scrollTop that brings item i fully into view (unchanged when it already is). */
export function scrollToShow(offsets: ArrayLike<number>, i: number, scrollTop: number, viewport: number, headerOffset = 0): number {
  const top = offsets[i] ?? 0;
  const bottom = offsets[i + 1] ?? top;
  if (top - headerOffset < scrollTop) return Math.max(0, top - headerOffset);
  if (bottom > scrollTop + viewport) return bottom - viewport;
  return scrollTop;
}
