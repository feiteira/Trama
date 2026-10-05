import { describe, expect, it } from 'vitest';
import {
  binIndex,
  chiSquarePValue,
  chiSquareTest,
  lnGamma,
  logLikelihood,
  logRatio,
  percent,
  quantile,
  quantileBins,
  ratio,
  regularizedGammaP,
  regularizedGammaQ,
  round,
  safeDivide,
} from './stats';

describe('ratios', () => {
  it('divides safely', () => {
    expect(safeDivide(1, 0)).toBe(0);
    expect(safeDivide(1, 0, -1)).toBe(-1);
    expect(safeDivide(1, 4)).toBe(0.25);
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(3, 4)).toBe(0.75);
    expect(percent(1, 8)).toBe(12.5);
    expect(percent(0, 0)).toBeNull();
  });

  it('rounds half away from zero', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(-2.5, 0)).toBe(-3);
    expect(round(0.125, 2)).toBe(0.13);
    expect(round(NaN)).toBeNaN();
  });
});

describe('quantiles and bins', () => {
  it('interpolates quantiles like R type 7', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it('makes equal-count bins with data-value edges', () => {
    const bins = quantileBins([12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 4);
    expect(bins.map((b) => [b.min, b.max, b.count])).toEqual([[1, 3, 3], [4, 6, 3], [7, 9, 3], [10, 12, 3]]);
    expect(binIndex(bins, 3.5)).toBe(0);
    expect(binIndex(bins, 4)).toBe(1);
    expect(binIndex(bins, 12)).toBe(3);
    expect(binIndex(bins, 12.5)).toBe(-1);
    expect(binIndex(bins, 0)).toBe(-1);
  });

  it('never splits a repeated value and copes with tiny or odd input', () => {
    const bins = quantileBins([1, 1, 1, 1, 1, 1, 2, 3], 4);
    expect(bins.map((b) => [b.lo, b.min, b.max, b.count])).toEqual([[1, 1, 1, 6], [2, 2, 3, 2]]);
    expect(quantileBins([], 4)).toEqual([]);
    expect(quantileBins([5], 4).map((b) => b.count)).toEqual([1]);
    expect(quantileBins([NaN, Infinity, 2, 2], 3).map((b) => b.count)).toEqual([2]);
    expect(quantileBins([1, 2, 3], 10).map((b) => b.count)).toEqual([1, 1, 1]);
  });
});

describe('gamma and chi-square', () => {
  it('computes ln Γ', () => {
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    expect(lnGamma(100)).toBeCloseTo(359.1342053695754, 9);
  });

  it('computes the regularized incomplete gamma', () => {
    expect(regularizedGammaP(1, 2)).toBeCloseTo(1 - Math.exp(-2), 12);
    expect(regularizedGammaP(0.5, 1)).toBeCloseTo(0.8427007929497149, 12); // erf(1)
    expect(regularizedGammaQ(0.5, 1)).toBeCloseTo(1 - 0.8427007929497149, 12);
    expect(regularizedGammaP(3, 0)).toBe(0);
    expect(regularizedGammaQ(3, 0)).toBe(1);
    expect(regularizedGammaP(-1, 1)).toBeNaN();
  });

  it('matches tabulated chi-square critical values', () => {
    expect(chiSquarePValue(3.841458820694124, 1)).toBeCloseTo(0.05, 10);
    expect(chiSquarePValue(5.991464547107979, 2)).toBeCloseTo(0.05, 10);
    expect(chiSquarePValue(9.487729036781154, 4)).toBeCloseTo(0.05, 10);
    expect(chiSquarePValue(18.307038053275146, 10)).toBeCloseTo(0.05, 8);
    expect(chiSquarePValue(10.827566170662733, 1)).toBeCloseTo(0.001, 10);
    expect(chiSquarePValue(0, 3)).toBe(1);
    expect(chiSquarePValue(500, 1)).toBeLessThan(1e-100);
    expect(chiSquarePValue(1, 0)).toBeNaN();
  });

  it('tests a 2 × 2 table (hand computed)', () => {
    // Rows 30/70, columns 40/60, n = 100; expected 12, 18, 28, 42.
    // chi2 = 4/12 + 4/18 + 4/28 + 4/42 = 0.793650…; p = erfc(sqrt(chi2/2)) = 0.372998…
    const r = chiSquareTest([[10, 20], [30, 40]])!;
    expect(r.chi2).toBeCloseTo(0.7936507936507936, 12);
    expect(r.df).toBe(1);
    expect(r.p).toBeCloseTo(0.37299848361348714, 10);
    expect(r.expected).toEqual([[12, 18], [28, 42]]);
    expect(r.lowExpectedShare).toBe(0);
    expect(r.cramersV).toBeCloseTo(Math.sqrt(0.7936507936507936 / 100), 12);
  });

  it('drops empty rows and columns and refuses degenerate tables', () => {
    const r = chiSquareTest([[10, 0, 20], [0, 0, 0], [30, 0, 40]])!;
    expect(r.df).toBe(1);
    expect(r.chi2).toBeCloseTo(0.7936507936507936, 12);
    expect(chiSquareTest([[1, 2, 3]])).toBeNull();
    expect(chiSquareTest([[0, 0], [0, 0]])).toBeNull();
    expect(chiSquareTest([])).toBeNull();
    expect(chiSquareTest([[2, 1], [1, 2]])!.lowExpectedShare).toBe(1);
  });
});

describe('keyness', () => {
  it('computes log-likelihood as Rayson & Garside', () => {
    // E1 = E2 = 75; G2 = 2(100 ln(100/75) + 50 ln(50/75)) = 16.9899…
    expect(logLikelihood(100, 50, 10_000, 10_000)).toBeCloseTo(16.98990367953973, 10);
    expect(logLikelihood(10, 0, 1000, 1000)).toBeCloseTo(2 * 10 * Math.log(2), 10);
    expect(logLikelihood(0, 0, 10, 10)).toBe(0);
    expect(logLikelihood(5, 5, 100, 100)).toBe(0);
  });

  it('computes log ratio with smoothing for zeros', () => {
    expect(logRatio(100, 50, 10_000, 10_000)).toBeCloseTo(1, 12);
    expect(logRatio(4, 0, 100, 100)).toBeCloseTo(3, 12);
    expect(logRatio(1, 1, 0, 10)).toBe(0);
  });
});
