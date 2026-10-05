// Numeric helpers for the analysis tables: safe ratios, quantile bins, chi-square with exact
// p-values (regularized incomplete gamma) and log-likelihood keyness.

/** a / b, or `fallback` when b is 0 or the result is not finite. */
export function safeDivide(a: number, b: number, fallback = 0): number {
  if (b === 0) return fallback;
  const r = a / b;
  return Number.isFinite(r) ? r : fallback;
}

/** a / b, or null when b is 0 (an undefined ratio is not the same as 0). */
export function ratio(a: number, b: number): number | null {
  if (b === 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}

/** part / whole × 100, or null when whole is 0. */
export function percent(part: number, whole: number): number | null {
  const r = ratio(part, whole);
  return r === null ? null : r * 100;
}

/** Rounds half away from zero to `digits` decimals (for display and stable test values). */
export function round(x: number, digits = 2): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** digits;
  const r = Math.round(Math.abs(x) * f + Number.EPSILON * f) / f;
  return x < 0 ? -r : r;
}

/** Quantile of ascending data by linear interpolation (Hyndman & Fan type 7, as R and Excel). */
export function quantile(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const h = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(h);
  const a = sorted[lo]!;
  const b = sorted[Math.min(n - 1, lo + 1)]!;
  return a + (h - lo) * (b - a);
}

export interface Bin {
  /** Lower edge (inclusive). */
  lo: number;
  /** Upper edge: exclusive, except for the last bin where it is the maximum (inclusive). */
  hi: number;
  /** Smallest and largest value actually in the bin: what labels should show ("18–29"). */
  min: number;
  max: number;
  count: number;
}

/**
 * Up to `n` bins holding roughly equal numbers of values. Edges are data values, so a value
 * that repeats a lot is never split across bins; bins can therefore be fewer or uneven when
 * the data has heavy ties. Non-finite values are ignored.
 */
export function quantileBins(values: readonly number[], n: number): Bin[] {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const N = v.length;
  if (N === 0 || n < 1) return [];
  const edges: number[] = [];
  for (let i = 0; i < Math.min(n, N); i++) {
    const e = v[Math.floor((i * N) / Math.min(n, N))]!;
    if (edges.length === 0 || e > edges[edges.length - 1]!) edges.push(e);
  }
  const max = v[N - 1]!;
  const bins: Bin[] = edges.map((lo, i) => ({ lo, hi: edges[i + 1] ?? max, min: Infinity, max: -Infinity, count: 0 }));
  for (const x of v) {
    const b = bins[binIndex(bins, x)]!;
    b.count++;
    if (x < b.min) b.min = x;
    if (x > b.max) b.max = x;
  }
  return bins.filter((b) => b.count > 0);
}

/** Index of the bin holding x (bins as from quantileBins, ascending), or -1. */
export function binIndex(bins: readonly Bin[], x: number): number {
  if (bins.length === 0 || !Number.isFinite(x)) return -1;
  const last = bins[bins.length - 1]!;
  if (x < bins[0]!.lo || x > last.hi) return -1;
  let lo = 0;
  let hi = bins.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (bins[mid]!.lo <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ---------------------------------------------------------------------------------------------
// Gamma functions (Numerical Recipes, 3rd ed., §6.1–6.2)
// ---------------------------------------------------------------------------------------------

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0 (Lanczos, g = 7: about 15 significant digits). */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0]!;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

const EPS = 1e-15;
const FPMIN = 1e-300;

function gammaSeries(a: number, x: number): number {
  let sum = 1 / a;
  let del = sum;
  let ap = a;
  for (let n = 0; n < 10_000; n++) {
    ap++;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

function gammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 10_000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** Regularized lower incomplete gamma P(a, x). */
export function regularizedGammaP(a: number, x: number): number {
  if (!(a > 0) || x < 0 || Number.isNaN(x)) return NaN;
  if (x === 0) return 0;
  if (x === Infinity) return 1;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaContinuedFraction(a, x);
}

/** Regularized upper incomplete gamma Q(a, x) = 1 − P(a, x), accurate in the far tail. */
export function regularizedGammaQ(a: number, x: number): number {
  if (!(a > 0) || x < 0 || Number.isNaN(x)) return NaN;
  if (x === 0) return 1;
  if (x === Infinity) return 0;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaContinuedFraction(a, x);
}

/** Upper-tail probability of the chi-square distribution: P(X² ≥ chi2) with df degrees of freedom. */
export function chiSquarePValue(chi2: number, df: number): number {
  if (!(df > 0) || Number.isNaN(chi2)) return NaN;
  if (chi2 <= 0) return 1;
  return Math.min(1, Math.max(0, regularizedGammaQ(df / 2, chi2 / 2)));
}

export interface ChiSquareResult {
  chi2: number;
  df: number;
  p: number;
  n: number;
  /** Expected counts for the table as given (zero rows/columns get 0). */
  expected: number[][];
  /** Share of the cells used whose expected count is below 5 (the usual caution: > 0.2). */
  lowExpectedShare: number;
  /** Cramér's V, an effect size between 0 and 1. */
  cramersV: number;
}

/**
 * Pearson's chi-square test of independence on a table of counts. Rows and columns that are
 * all zero carry no information and would inflate the degrees of freedom, so they are left
 * out. Null when fewer than two rows or columns remain.
 */
export function chiSquareTest(observed: readonly (readonly number[])[]): ChiSquareResult | null {
  const R = observed.length;
  const C = R ? Math.max(...observed.map((r) => r.length)) : 0;
  const rowSum = observed.map((r) => r.reduce((s, x) => s + (x || 0), 0));
  const colSum = Array.from({ length: C }, (_, j) => observed.reduce((s, r) => s + (r[j] || 0), 0));
  const n = rowSum.reduce((s, x) => s + x, 0);
  const rows = rowSum.map((s, i) => (s > 0 ? i : -1)).filter((i) => i >= 0);
  const cols = colSum.map((s, j) => (s > 0 ? j : -1)).filter((j) => j >= 0);
  const expected = observed.map((r, i) => Array.from({ length: C }, (_, j) => (n > 0 ? (rowSum[i]! * colSum[j]!) / n : 0)));
  if (rows.length < 2 || cols.length < 2) return null;
  let chi2 = 0;
  let low = 0;
  for (const i of rows) {
    for (const j of cols) {
      const e = expected[i]![j]!;
      const o = observed[i]![j] || 0;
      chi2 += ((o - e) * (o - e)) / e;
      if (e < 5) low++;
    }
  }
  const df = (rows.length - 1) * (cols.length - 1);
  const k = Math.min(rows.length, cols.length) - 1;
  return {
    chi2,
    df,
    p: chiSquarePValue(chi2, df),
    n,
    expected,
    lowExpectedShare: low / (rows.length * cols.length),
    cramersV: Math.sqrt(chi2 / (n * k)),
  };
}

// ---------------------------------------------------------------------------------------------
// Keyness
// ---------------------------------------------------------------------------------------------

const xlnx = (x: number, e: number) => (x > 0 ? x * Math.log(x / e) : 0);

/**
 * Log-likelihood G² for a word occurring `a` times in a corpus of `c` words and `b` times in
 * one of `d` words (Rayson & Garside 2000). Compare with chi-square(1): 3.84 → p < 0.05,
 * 6.63 → p < 0.01, 10.83 → p < 0.001, 15.13 → p < 0.0001.
 */
export function logLikelihood(a: number, b: number, c: number, d: number): number {
  if (c + d === 0 || a + b === 0) return 0;
  const e1 = (c * (a + b)) / (c + d);
  const e2 = (d * (a + b)) / (c + d);
  return 2 * (xlnx(a, e1) + xlnx(b, e2));
}

/**
 * Log ratio (Hardie 2014): log2 of the ratio of relative frequencies, an effect size (1 = twice
 * as frequent). Zero counts are replaced by 0.5 so the value stays finite.
 */
export function logRatio(a: number, b: number, c: number, d: number): number {
  if (c === 0 || d === 0) return 0;
  return Math.log2(((a || 0.5) / c) / ((b || 0.5) / d));
}
