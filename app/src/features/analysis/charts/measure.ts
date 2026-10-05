// Text measurement for chart labels (canvas measureText), with a cache: charts lay out labels
// before drawing them, and SVG text cannot be measured until it is in the page.

export const CHART_FONT = "'Instrument Sans Variable', 'Instrument Sans', system-ui, sans-serif";

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

export function textWidth(text: string, size = 12, weight = 450): number {
  const key = `${weight}|${size}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) {
    try {
      ctx = document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
  }
  let w: number;
  if (ctx) {
    ctx.font = `${weight} ${size}px ${CHART_FONT}`;
    w = ctx.measureText(text).width;
  } else w = text.length * size * 0.56;
  if (cache.size > 5000) cache.clear();
  cache.set(key, w);
  return w;
}

/** `text` cut with an ellipsis so it fits `max` px. */
export function fitText(text: string, max: number, size = 12, weight = 450): string {
  if (textWidth(text, size, weight) <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (textWidth(`${text.slice(0, mid).trimEnd()}…`, size, weight) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : '…';
}
