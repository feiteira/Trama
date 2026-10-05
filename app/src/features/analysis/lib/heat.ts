// Colour for magnitudes: one hue (blue), light to dark on light paper and dark to light on dark
// paper, so "more" always reads as "stronger" against the surface. Cells of value 0 get no fill
// at all: an empty cell should look empty, not faintly blue.

export type Theme = 'light' | 'dark';

// The sequential blue ramp, steps 100 → 700 (dataviz reference palette).
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
// Dark paper: the anchor flips. The darkest steps sit close to the surface (near zero recedes).
const RAMP_DARK = ['#1b3354', '#1d3d66', '#1f4a7d', '#245a96', '#2a6bb0', '#3a7fca', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];

/** Series colours for two-sided comparisons (categorical slots 1 and 2, validated per theme). */
export const SERIES = {
  light: { a: '#2a78d6', b: '#eb6834' },
  dark: { a: '#3987e5', b: '#d95926' },
} as const;

/** Chart ink and chrome, per theme (resolved values, so exported SVG keeps them). */
export const CHROME = {
  light: { surface: '#fbfaf7', ink: '#1d2130', ink2: '#4a4f5e', muted: '#656a78', grid: '#e6e2d8', axis: '#c3bcad', diagonal: '#e9e6de', edge: '#8e919b' },
  dark: { surface: '#272623', ink: '#ebe7de', ink2: '#c2bdb2', muted: '#9d988d', grid: '#2e2c28', axis: '#4d4a43', diagonal: '#1e1d1b', edge: '#6d695f' },
} as const;

function parse(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function hex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;
}

/** The ramp colour at t ∈ [0, 1] (clamped), interpolated between neighbouring steps. */
export function rampColor(t: number, theme: Theme = 'light'): string {
  const ramp = theme === 'dark' ? RAMP_DARK : RAMP;
  const x = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const pos = x * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = parse(ramp[i]!);
  const b = parse(ramp[i + 1]!);
  return hex(a.map((c, k) => c + (b[k]! - c) * f));
}

function lum(h: string): number {
  const lin = parse(h).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/** Text colour for a label inside a filled cell: whichever of dark or white ink contrasts more. */
export function inkFor(background: string, dark = '#1d2130', light = '#ffffff'): string {
  const lb = lum(background);
  const cd = (Math.max(lb, lum(dark)) + 0.05) / (Math.min(lb, lum(dark)) + 0.05);
  const cl = (Math.max(lb, lum(light)) + 0.05) / (Math.min(lb, lum(light)) + 0.05);
  return cd >= cl ? dark : light;
}

export interface HeatScale {
  max: number;
  /** Position of a value on the ramp, 0–1. Values ≤ 0 are 0. */
  t: (v: number) => number;
  /** Fill for a value, or null for "no fill" (zero, empty or not a number). */
  fill: (v: number) => string | null;
  /** Label ink for a value's cell (null fill → the theme's ordinary ink). */
  ink: (v: number) => string;
}

export interface HeatOptions {
  theme?: Theme;
  /** Leave the diagonal of a square matrix out of the maximum (co-occurrence). */
  skipDiagonal?: boolean;
  /** Fixed maximum (percentages: 100; Jaccard: 1). Otherwise the largest value. */
  max?: number;
}

/**
 * A heat scale for a matrix. Non-zero values start a little up the ramp (t ≥ 0.12) so the
 * smallest count is still visibly filled; the largest is the ramp's end.
 */
export function heatScale(values: readonly (readonly number[])[], opts: HeatOptions = {}): HeatScale {
  const theme = opts.theme ?? 'light';
  let max = opts.max ?? 0;
  if (opts.max === undefined) {
    values.forEach((row, i) =>
      row.forEach((v, j) => {
        if (opts.skipDiagonal && i === j) return;
        if (Number.isFinite(v) && v > max) max = v;
      }),
    );
  }
  const FLOOR = 0.12;
  const t = (v: number) => (!Number.isFinite(v) || v <= 0 || max <= 0 ? 0 : FLOOR + (1 - FLOOR) * Math.min(1, v / max));
  const ink = CHROME[theme].ink;
  return {
    max,
    t,
    fill: (v) => (t(v) > 0 ? rampColor(t(v), theme) : null),
    ink: (v) => (t(v) > 0 ? inkFor(rampColor(t(v), theme), '#1d2130', '#ffffff') : ink),
  };
}

/** CSS linear-gradient for a scale legend. */
export function rampGradient(theme: Theme = 'light', steps = 8): string {
  const stops = Array.from({ length: steps }, (_, i) => rampColor(0.12 + (0.88 * i) / (steps - 1), theme));
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
