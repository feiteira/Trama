import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_SUMMARY_COLUMNS,
  agreementSummary,
  binaryStats,
  characterAgreement,
  cohenKappa,
  cohenKappaMatrix,
  documentAgreement,
  krippendorffAlphaBinary,
  krippendorffAlphaNominal,
  overlapRatio,
  segmentAgreement,
} from './agreement';
import { coding, treeOf } from './fixtures';

const A = (doc: string, code: string, s: number, e: number, id?: string) => coding(doc, code, s, e, { coder_id: 'A', ...(id ? { id } : {}) });
const B = (doc: string, code: string, s: number, e: number, id?: string) => coding(doc, code, s, e, { coder_id: 'B', ...(id ? { id } : {}) });

describe('textbook values', () => {
  it("Cohen's kappa: 50 items, yes/yes 20, yes/no 5, no/yes 10, no/no 15 → 0.4", () => {
    // po = 35/50 = 0.7; pe = 0.5·0.6 + 0.5·0.4 = 0.5; κ = 0.2/0.5 = 0.4
    expect(cohenKappa({ both: 20, aOnly: 5, bOnly: 10, neither: 15 })).toBeCloseTo(0.4, 12);
    expect(cohenKappaMatrix([[20, 5], [10, 15]])).toBeCloseTo(0.4, 12);
  });

  it("Cohen's kappa for k categories agrees with the 2 × 2 identity and handles degenerate tables", () => {
    // 3 categories, n = 100: po = (25+30+23)/100 = 0.78; marginals A 35/35/30, B 30/40/30;
    // pe = .35·.30 + .35·.40 + .30·.30 = 0.335; κ = (0.78 − 0.335)/0.665 = 0.66917…
    expect(cohenKappaMatrix([[25, 5, 5], [3, 30, 2], [2, 5, 23]])).toBeCloseTo((0.78 - 0.335) / 0.665, 12);
    expect(cohenKappaMatrix([[10, 0], [0, 0]])).toBeNull();
    expect(cohenKappaMatrix([])).toBeNull();
    expect(cohenKappa({ both: 0, aOnly: 0, bOnly: 0, neither: 10 })).toBeNull();
    expect(cohenKappa({ both: 7, aOnly: 0, bOnly: 0, neither: 0 })).toBeNull();
    expect(cohenKappa({ both: 0, aOnly: 5, bOnly: 5, neither: 0 })).toBe(-1);
    expect(cohenKappa({ both: 5, aOnly: 0, bOnly: 0, neither: 5 })).toBe(1);
  });

  it("Krippendorff's alpha: binary, two observers (Krippendorff 2011, example A) → 0.095", () => {
    // A: 0 1 0 0 0 0 0 0 1 0 / B: 1 1 1 0 0 1 0 0 0 0
    // both = 1, A only = 1, B only = 3, neither = 5; n0 = 14, n1 = 6, n = 20
    // α = 1 − 19·4 / (14·6) = 1 − 76/84 = 0.0952…
    const a = [0, 1, 0, 0, 0, 0, 0, 0, 1, 0];
    const b = [1, 1, 1, 0, 0, 1, 0, 0, 0, 0];
    expect(krippendorffAlphaBinary({ both: 1, aOnly: 1, bOnly: 3, neither: 5 })).toBeCloseTo(1 - 76 / 84, 12);
    expect(krippendorffAlphaNominal(a.map((x, i) => [x, b[i]!]))).toBeCloseTo(1 - 76 / 84, 12);
  });

  it("Krippendorff's alpha: nominal, four observers, missing data (Krippendorff 2011, example C) → 0.743", () => {
    const n = null;
    const obs = [
      [1, 2, 3, 3, 2, 1, 4, 1, 2, n, n, n],
      [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, n, 3],
      [n, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, n],
      [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, n],
    ];
    const units = obs[0]!.map((_, u) => obs.map((o) => o[u]!));
    // Published: α = 0.743 (exactly 1 − 39·10/(…) = 0.743421…).
    expect(krippendorffAlphaNominal(units)).toBeCloseTo(0.743, 3);
    expect(krippendorffAlphaNominal(units)).toBeCloseTo(0.743421052631579, 12);
  });

  it('alpha is undefined without variation and ignores unpairable units', () => {
    expect(krippendorffAlphaNominal([['x', 'x'], ['x', 'x']])).toBeNull();
    expect(krippendorffAlphaNominal([['x', null], [null, null]])).toBeNull();
    expect(krippendorffAlphaNominal([])).toBeNull();
    expect(krippendorffAlphaBinary({ both: 0, aOnly: 0, bOnly: 0, neither: 100 })).toBeNull();
    expect(krippendorffAlphaBinary({ both: 0, aOnly: 0, bOnly: 0, neither: 1 })).toBeNull();
    // Values of different types never count as equal.
    expect(krippendorffAlphaNominal([[1, '1'], [2, 2], [1, 1]])).not.toBeNull();
  });
});

describe('characterAgreement', () => {
  // Hand-computed example.
  // d1 (20 chars): A codes X on [0,10), B on [5,15).
  //   both 5, A only 5, B only 5, neither 5. po = 0.5, pe = 0.5 → κ = 0.
  //   α: o01 = 10, n0 = 20, n1 = 20, n = 40 → 1 − 39·10/400 = 0.025.
  // d2 (10 chars): A codes X on [0,4), B nothing.
  //   both 0, A only 4, B only 0, neither 6 → κ = 0; α = 1 − 19·4/(16·4) = −0.1875.
  // Pooled: both 5, A only 9, B only 5, neither 11 (N = 30)
  //   κ = 2(5·11 − 9·5) / ((5+9)(9+11) + (5+5)(5+11)) = 20/440 = 0.04545…
  //   (the unweighted mean of the per-document kappas would be 0)
  //   α: o01 = 14, n0 = 36, n1 = 24, n = 60 → 1 − 59·14/864 = 0.043981…
  //   percent agreement 16/30; among coded 5/19.
  const docs = [{ id: 'd1', length: 20 }, { id: 'd2', length: 10 }];
  const a = [A('d1', 'X', 0, 10), A('d2', 'X', 0, 4)];
  const b = [B('d1', 'X', 5, 15)];
  const r = characterAgreement(a, b, docs, ['X', 'Y']);

  it('counts per document', () => {
    const [d1, d2] = r.codes[0]!.perDocument;
    expect(d1!.stats).toMatchObject({ both: 5, aOnly: 5, bOnly: 5, neither: 5, total: 20, percentAgreement: 50 });
    expect(d1!.stats.kappa).toBe(0);
    expect(d1!.stats.alpha).toBeCloseTo(0.025, 12);
    expect(d1!.stats.percentAmongCoded).toBeCloseTo(100 / 3, 12);
    expect(d2!.stats).toMatchObject({ both: 0, aOnly: 4, bOnly: 0, neither: 6, kappa: 0 });
    expect(d2!.stats.alpha).toBeCloseTo(-0.1875, 12);
  });

  it('pools tables over documents rather than averaging', () => {
    const p = r.codes[0]!.pooled;
    expect(p).toMatchObject({ both: 5, aOnly: 9, bOnly: 5, neither: 11, total: 30 });
    expect(p.kappa).toBeCloseTo(20 / 440, 12);
    expect(p.alpha).toBeCloseTo(1 - (59 * 14) / 864, 12);
    expect(p.percentAgreement).toBeCloseTo((16 / 30) * 100, 12);
    expect(p.percentAmongCoded).toBeCloseTo((5 / 19) * 100, 12);
  });

  it('reports undefined statistics for a code nobody used', () => {
    const y = r.codes[1]!.pooled;
    expect(y).toMatchObject({ both: 0, aOnly: 0, bOnly: 0, neither: 30, percentAgreement: 100, percentAmongCoded: null, kappa: null, alpha: null });
  });

  it('pools all codes into an overall table', () => {
    expect(r.overall).toMatchObject({ both: 5, aOnly: 9, bOnly: 5, neither: 41, total: 60 });
  });

  it('merges overlapping segments, clamps to the document, ignores deleted codings and unknown documents', () => {
    const res = characterAgreement(
      [A('d', 'X', 0, 6), A('d', 'X', 4, 8), A('d', 'X', 8, 50), A('zz', 'X', 0, 5), { ...A('d', 'X', 0, 10), deleted: true }],
      [B('d', 'X', 0, 10)],
      [{ id: 'd', length: 12 }, { id: 'd', length: 12 }],
      ['X'],
    );
    // A covers [0,12) after clamping; B [0,10).
    expect(res.codes[0]!.perDocument.length).toBe(1);
    expect(res.codes[0]!.pooled).toMatchObject({ both: 10, aOnly: 2, bOnly: 0, neither: 0 });
  });

  it('can count child codes for their parent', () => {
    const res = characterAgreement([A('d', 'child', 0, 5)], [B('d', 'parent', 0, 5)], [{ id: 'd', length: 10 }], ['parent'], {
      includeChildren: true,
      descendants: treeOf({ child: 'parent', parent: null }),
    });
    expect(res.codes[0]!.pooled).toMatchObject({ both: 5, aOnly: 0, bOnly: 0, neither: 5, kappa: 1, alpha: 1 });
  });

  it('handles no documents and empty documents', () => {
    const res = characterAgreement([], [], [], ['X']);
    expect(res.codes[0]!.pooled).toMatchObject({ total: 0, percentAgreement: null, kappa: null, alpha: null });
    const e = characterAgreement([A('d', 'X', 0, 3)], [], [{ id: 'd', length: 0 }], ['X']);
    expect(e.codes[0]!.pooled.total).toBe(0);
  });

  it('agrees with the general alpha on per-character labels', () => {
    const lab = (spans: [number, number][], L: number) => Array.from({ length: L }, (_, i) => (spans.some(([s, e]) => i >= s && i < e) ? 1 : 0));
    const la = lab([[0, 10], [30, 33]], 40);
    const lb = lab([[2, 12], [31, 40]], 40);
    const res = characterAgreement([A('d', 'X', 0, 10), A('d', 'X', 30, 33)], [B('d', 'X', 2, 12), B('d', 'X', 31, 40)], [{ id: 'd', length: 40 }], ['X']);
    expect(res.codes[0]!.pooled.alpha).toBeCloseTo(krippendorffAlphaNominal(la.map((x, i) => [x, lb[i]!]))!, 12);
    const m = [[0, 0], [0, 0]];
    la.forEach((x, i) => m[x]![lb[i]!]!++);
    expect(res.codes[0]!.pooled.kappa).toBeCloseTo(cohenKappaMatrix(m)!, 12);
  });
});

describe('segmentAgreement', () => {
  // Hand-computed example, document d1.
  // Code X: A a1 [0,100) a2 [200,250) a3 [400,420); B b1 [5,100) b2 [200,300) b3 [600,650).
  //   a1~b1: overlap 95 / span 100 = 0.95 → agree (both ways).
  //   a2~b2: overlap 50 / span 100 = 0.50 → disagree at 0.9, agree with 'any'.
  //   a3, b3: no partner → disagree.
  //   X at 0.9: agree 1 + 1, disagree 2 + 2 → 33.3 %.
  // Code Y: A [0,50), B [0,50) → agree 2.
  // Code Z: unused, but counts as a category: k = 3, chance = 1/3.
  // Totals at 0.9: agree 4, disagree 4, po = 0.5, κ = (0.5 − 1/3)/(2/3) = 0.25.
  // Totals with 'any': agree 6, disagree 2, po = 0.75, κ = (0.75 − 1/3)/(2/3) = 0.625.
  const a = [A('d1', 'X', 0, 100, 'a1'), A('d1', 'X', 200, 250, 'a2'), A('d1', 'X', 400, 420, 'a3'), A('d1', 'Y', 0, 50, 'ay')];
  const b = [B('d1', 'X', 5, 100, 'b1'), B('d1', 'X', 200, 300, 'b2'), B('d1', 'X', 600, 650, 'b3'), B('d1', 'Y', 0, 50, 'by')];

  it('checks both directions at the default threshold', () => {
    const r = segmentAgreement(a, b, ['X', 'Y', 'Z']);
    expect(r.threshold).toBe(0.9);
    expect(r.codes[0]).toMatchObject({ codeId: 'X', aAgree: 1, aDisagree: 2, bAgree: 1, bDisagree: 2, agree: 2, disagree: 4 });
    expect(r.codes[0]!.percent).toBeCloseTo(100 / 3, 12);
    expect(r.codes[1]).toMatchObject({ codeId: 'Y', agree: 2, disagree: 0, percent: 100 });
    expect(r.codes[2]).toMatchObject({ codeId: 'Z', agree: 0, disagree: 0, percent: null });
    expect(r).toMatchObject({ agree: 4, disagree: 4, percent: 50, categories: 3 });
    expect(r.chance).toBeCloseTo(1 / 3, 12);
    expect(r.kappa).toBeCloseTo(0.25, 12);
  });

  it('lists every disagreement with its closest partner', () => {
    const r = segmentAgreement(a, b, ['X', 'Y', 'Z']);
    expect(r.disagreements.map((d) => [d.coder, d.codingId, d.bestOverlap, d.closest])).toEqual([
      ['A', 'a2', 0.5, { start: 200, end: 300 }],
      ['B', 'b2', 0.5, { start: 200, end: 250 }],
      ['A', 'a3', 0, null],
      ['B', 'b3', 0, null],
    ]);
    expect(r.disagreements[0]).toMatchObject({ codeId: 'X', documentId: 'd1', start: 200, end: 250 });
  });

  it("accepts any overlap with 'any'", () => {
    const r = segmentAgreement(a, b, ['X', 'Y', 'Z'], { threshold: 'any' });
    expect(r).toMatchObject({ agree: 6, disagree: 2, percent: 75 });
    expect(r.kappa).toBeCloseTo(0.625, 12);
  });

  it('treats the threshold as inclusive, never matches across codes or documents', () => {
    expect(segmentAgreement([A('d', 'X', 0, 90)], [B('d', 'X', 0, 100)], ['X']).agree).toBe(2);
    expect(segmentAgreement([A('d', 'X', 0, 89)], [B('d', 'X', 0, 100)], ['X']).agree).toBe(0);
    expect(segmentAgreement([A('d', 'X', 0, 10)], [B('d', 'Y', 0, 10)], ['X', 'Y']).agree).toBe(0);
    expect(segmentAgreement([A('d', 'X', 0, 10)], [B('e', 'X', 0, 10)], ['X']).agree).toBe(0);
  });

  it('lets one long segment confirm several (each checked independently)', () => {
    const r = segmentAgreement([A('d', 'X', 0, 95), A('d', 'X', 5, 100)], [B('d', 'X', 0, 100)], ['X']);
    expect(r.codes[0]).toMatchObject({ aAgree: 2, bAgree: 1, disagree: 0 });
  });

  it('uses k = 2 for a single code, filters documents and validates the threshold', () => {
    const r = segmentAgreement([A('d', 'X', 0, 10), A('e', 'X', 0, 10)], [B('d', 'X', 0, 10)], ['X'], { documentIds: ['d'] });
    expect(r).toMatchObject({ categories: 2, agree: 2, disagree: 0, kappa: 1 });
    expect(() => segmentAgreement([], [], ['X'], { threshold: 0 })).toThrow(RangeError);
    expect(() => segmentAgreement([], [], ['X'], { threshold: 1.5 })).toThrow(RangeError);
    expect(segmentAgreement([], [], ['X'])).toMatchObject({ percent: null, kappa: null });
  });

  it('computes overlap ratios', () => {
    expect(overlapRatio({ start: 0, end: 100 }, { start: 5, end: 100 })).toBe(0.95);
    expect(overlapRatio({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(0);
    expect(overlapRatio({ start: 0, end: 10 }, { start: 0, end: 10 })).toBe(1);
  });
});

describe('documentAgreement', () => {
  it('compares presence per document (hand computed)', () => {
    // X: A in d1 d2 d3; B in d1 d2 d4 → both 2, A only 1, B only 1, neither 0.
    // κ = 2(2·0 − 1·1) / ((2+1)(1+0) + (2+1)(1+0)) = −2/6.
    const a = [A('d1', 'X', 0, 1), A('d1', 'X', 5, 6), A('d2', 'X', 0, 1), A('d3', 'X', 0, 1)];
    const b = [B('d1', 'X', 3, 4), B('d2', 'X', 0, 1), B('d4', 'X', 0, 1), B('d4', 'W', 0, 1)];
    const r = documentAgreement(a, b, ['d1', 'd2', 'd3', 'd4'], ['X', 'W']);
    expect(r.codes[0]!.stats).toMatchObject({ both: 2, aOnly: 1, bOnly: 1, neither: 0, percentAgreement: 50 });
    expect(r.codes[0]!.stats.kappa).toBeCloseTo(-1 / 3, 12);
    expect(r.codes[0]!.disagreements).toEqual([{ documentId: 'd3', coder: 'A' }, { documentId: 'd4', coder: 'B' }]);
    expect(r.codes[1]!.stats).toMatchObject({ both: 0, aOnly: 0, bOnly: 1, neither: 3 });
    expect(r.overall).toMatchObject({ both: 2, aOnly: 1, bOnly: 2, neither: 3, total: 8 });
  });
});

describe('agreementSummary', () => {
  it('joins the levels into one table with a totals row', () => {
    const a = [A('d', 'X', 0, 10)];
    const b = [B('d', 'X', 0, 10)];
    const rows = agreementSummary({
      character: characterAgreement(a, b, [{ id: 'd', length: 20 }], ['X']),
      segment: segmentAgreement(a, b, ['X']),
      document: documentAgreement(a, b, ['d'], ['X']),
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      codeId: 'X',
      charPercent: 100,
      charPercentAmongCoded: 100,
      charKappa: 1,
      charAlpha: 1,
      segAgree: 2,
      segDisagree: 0,
      segPercent: 100,
      docPercent: 100,
      docKappa: null,
    });
    expect(rows[1]!.codeId).toBeNull();
    expect(Object.keys(rows[0]!).sort()).toEqual([...AGREEMENT_SUMMARY_COLUMNS].sort());
    expect(agreementSummary({ segment: segmentAgreement(a, b, ['X']) })[0]).toMatchObject({ charKappa: null, segPercent: 100 });
  });

  it('binaryStats derives every figure from the table', () => {
    expect(binaryStats({ both: 20, aOnly: 5, bOnly: 10, neither: 15 })).toMatchObject({ total: 50, percentAgreement: 70, percentAmongCoded: (20 / 35) * 100 });
  });
});
