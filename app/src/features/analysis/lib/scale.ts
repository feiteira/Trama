// Linear axes for the bar charts: round tick values (1, 2, 5 × 10ⁿ) that cover the data.

/** Ticks from 0 to at least `max`, about `count` of them, on a 1–2–5 step (whole steps for counts). */
export function niceTicks(max: number, count = 4, integer = false): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  if (integer) step = Math.max(1, step);
  const top = Math.ceil(max / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1e9) / 1e9);
  return out;
}

/** SVG path of a horizontal bar with a rounded data end (right) and a square baseline (left). */
export function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (w <= 0) return '';
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h - rr}A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}H${x}Z`;
}

/**
 * Stacked segments along one bar, with a 2 px surface gap between them: [x, width] for each
 * value, in order. Values ≤ 0 get no segment (width 0).
 */
export function stackSegments(values: readonly number[], total: number, width: number, gap = 2): { x: number; w: number }[] {
  const out: { x: number; w: number }[] = [];
  let x = 0;
  for (const v of values) {
    const full = total > 0 ? (Math.max(0, v) / total) * width : 0;
    if (full <= 0) {
      out.push({ x, w: 0 });
      continue;
    }
    out.push({ x, w: Math.max(0.5, full - gap) });
    x += full;
  }
  return out;
}
