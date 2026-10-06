import { describe, expect, it } from 'vitest';
import type { Coding } from '../../core/model/types';
import { segmentAgreement } from '../../core/qda/agreement';
import {
  alphaBand,
  fmtOverlap,
  alphaTone,
  codeRows,
  codeUse,
  codingsOf,
  defaultPair,
  docsBothCoded,
  EMPTY_REVIEW,
  fmtCoef,
  fmtPercent,
  isResolved,
  kappaBand,
  kappaTone,
  pairDisagreements,
  passageWindow,
  percentTone,
  pieces,
  resolutionRemoves,
  reviewAfter,
  runAgreement,
  sortCodeRows,
} from './model';

let seq = 0;
function coding(coder: string, code: string, doc: string, start: number, end: number, extra: Partial<Coding> = {}): Coding {
  seq++;
  return {
    id: `c${seq}`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at_hlc: `h${seq}`,
    deleted: false,
    document_id: doc,
    code_id: code,
    coder_id: coder,
    start,
    end,
    text: '',
    comment: '',
    ...extra,
  };
}

describe('interpretation bands', () => {
  it('labels kappa per Landis & Koch, on the value as shown (two decimals)', () => {
    expect(kappaBand(null)).toBeNull();
    expect(kappaBand(Number.NaN)).toBeNull();
    expect(kappaBand(-0.1)).toBe('poor');
    expect(kappaBand(-0.004)).toBe('slight'); // shown as 0.00
    expect(kappaBand(0)).toBe('slight');
    expect(kappaBand(0.2)).toBe('slight');
    expect(kappaBand(0.21)).toBe('fair');
    expect(kappaBand(0.404)).toBe('fair'); // shown as 0.40
    expect(kappaBand(0.41)).toBe('moderate');
    expect(kappaBand(0.6)).toBe('moderate');
    expect(kappaBand(0.61)).toBe('substantial');
    expect(kappaBand(0.8)).toBe('substantial');
    expect(kappaBand(0.81)).toBe('almostPerfect');
    expect(kappaBand(1)).toBe('almostPerfect');
  });

  it('follows Krippendorff for alpha (.800 and .667)', () => {
    expect(alphaBand(null)).toBeNull();
    expect(alphaBand(0.8)).toBe('reliable');
    expect(alphaBand(0.7996)).toBe('reliable'); // shown as .800
    expect(alphaBand(0.799)).toBe('tentative');
    expect(alphaBand(0.667)).toBe('tentative');
    expect(alphaBand(0.666)).toBe('unreliable');
  });

  it('tints cells on a three-step scale', () => {
    expect(kappaTone(0.85)).toBe('good');
    expect(kappaTone(0.5)).toBe('fair');
    expect(kappaTone(0.1)).toBe('weak');
    expect(kappaTone(null)).toBe('none');
    expect(alphaTone(0.7)).toBe('fair');
    expect(percentTone(80)).toBe('good');
    expect(percentTone(60)).toBe('fair');
    expect(percentTone(59.9)).toBe('weak');
    expect(percentTone(null)).toBe('none');
  });
});

describe('formatting', () => {
  it('formats coefficients and percentages per locale, with a dash for undefined', () => {
    expect(fmtCoef(0.4567, 'en-GB')).toBe('0.46');
    expect(fmtCoef(0.4567, 'pt-PT', 3)).toBe('0,457');
    expect(fmtCoef(-0.001, 'en-GB')).toBe('0.00');
    expect(fmtCoef(null, 'en-GB')).toBe('—');
    expect(fmtPercent(87.54, 'en-GB')).toBe('87.5%');
    expect(fmtPercent(87.54, 'pt-PT')).toMatch(/^87,5\s?%$/);
    expect(fmtPercent(null, 'en-GB')).toBe('—');
  });
});

describe('selection', () => {
  const A = 'ana';
  const B = 'rui';
  const all = [
    coding(A, 'k1', 'd1', 0, 10),
    coding(B, 'k1', 'd1', 0, 10),
    coding(A, 'k2', 'd2', 0, 5),
    coding(B, 'k3', 'd1', 20, 30),
    coding(A, 'k4', 'd1', 40, 50, { deleted: true }),
    coding('other', 'k1', 'd3', 0, 4),
  ];

  it('picks me as A and the busiest other coder as B', () => {
    const coders = [{ id: 'x' }, { id: 'me' }, { id: 'y' }];
    expect(
      defaultPair(
        coders,
        new Map([
          ['x', 3],
          ['me', 5],
          ['y', 9],
        ]),
        'me',
      ),
    ).toEqual({ a: 'me', b: 'y' });
    expect(
      defaultPair(
        coders,
        new Map([
          ['x', 3],
          ['y', 9],
        ]),
        'me',
      ),
    ).toEqual({ a: 'y', b: 'x' });
    expect(defaultPair([{ id: 'me' }], new Map(), 'me')).toEqual({ a: 'me', b: null });
    expect(defaultPair([], new Map(), null)).toEqual({ a: null, b: null });
  });

  it('splits codings by coder, without deleted or empty ones', () => {
    expect(codingsOf(all, A).map((c) => c.code_id)).toEqual(['k1', 'k2']);
    expect(codingsOf(all, null)).toEqual([]);
  });

  it('finds the documents both coded, in document order', () => {
    const docs = [{ id: 'd3' }, { id: 'd2' }, { id: 'd1' }];
    expect(docsBothCoded(docs, codingsOf(all, A), codingsOf(all, B))).toEqual(['d1']);
  });

  it('tells codes both used from codes only one used, within the documents', () => {
    const codes = [{ id: 'k3' }, { id: 'k2' }, { id: 'k1' }, { id: 'k4' }];
    expect(codeUse(codes, codingsOf(all, A), codingsOf(all, B), ['d1'])).toEqual({ both: ['k1'], oneOnly: ['k3'] });
    expect(codeUse(codes, codingsOf(all, A), codingsOf(all, B), ['d1', 'd2'])).toEqual({ both: ['k1'], oneOnly: ['k3', 'k2'] });
  });
});

describe('runAgreement and table rows', () => {
  const A = 'ana';
  const B = 'rui';
  const a = [coding(A, 'k1', 'd1', 0, 50), coding(A, 'k1', 'd2', 0, 10), coding(A, 'k2', 'd1', 60, 80)];
  const b = [coding(B, 'k1', 'd1', 0, 50), coding(B, 'k2', 'd2', 0, 10), coding(B, 'k2', 'd1', 60, 70)];
  const input = {
    codingsA: a,
    codingsB: b,
    documents: [
      { id: 'd1', length: 100 },
      { id: 'd2', length: 100 },
    ],
    codeIds: ['k1', 'k2'],
    threshold: 0.9,
  };

  it('computes per-document figures that add up to the pooled ones', () => {
    const r = runAgreement(input);
    expect(r.documentIds).toEqual(['d1', 'd2']);
    const d1 = r.perDocument[0]!;
    // k1 in d1: 50 both, 50 neither; k2 in d1: 10 both, 10 A only, 80 neither.
    expect(d1.character).toMatchObject({ both: 60, aOnly: 10, bOnly: 0, neither: 130 });
    const sum = r.perDocument.reduce((n, p) => n + p.character.both, 0);
    expect(sum).toBe(r.character.overall.both);
    // Segments in d1: k1 matches (2), k2 overlaps 50% < 90% (2 misses).
    expect(d1.segment).toMatchObject({ agree: 2, disagree: 2 });
    expect(r.segment.agree).toBe(2);
    expect(r.segment.disagree).toBe(4);
    // Presence in d2: k1 by A only, k2 by B only.
    expect(r.perDocument[1]!.presence).toMatchObject({ both: 0, aOnly: 1, bOnly: 1, neither: 0 });
  });

  it('ignores codings outside the selection', () => {
    const r = runAgreement({ ...input, documents: [{ id: 'd1', length: 100 }], codeIds: ['k1'] });
    expect(r.character.overall).toMatchObject({ both: 50, aOnly: 0, bOnly: 0, neither: 50 });
    expect(r.segment.disagree).toBe(0);
  });

  it('builds rows with sparklines per document and sorts with empty values last', () => {
    const r = runAgreement(input);
    const names = new Map([
      ['k1', { name: 'Trust', color: '#e4572e' }],
      ['k2', { name: 'Access', color: '#3a6ea5' }],
    ]);
    const rows = codeRows(r, names);
    expect(rows.map((x) => x.name)).toEqual(['Trust', 'Access']);
    const trust = rows[0]!;
    expect(trust.spark.character).toEqual([1, 0]);
    expect(trust.spark.segment).toEqual([1, 0]);
    expect(trust.spark.document).toEqual([1, 0]);
    const access = rows[1]!;
    expect(access.spark.character).toEqual([0.5, 0]);
    expect(access.spark.document).toEqual([1, 0]);

    const collator = new Intl.Collator('en');
    expect(sortCodeRows(rows, 'name', 'asc', 'character', collator).map((x) => x.name)).toEqual(['Access', 'Trust']);
    expect(sortCodeRows(rows, 'kappa', 'desc', 'character', collator).map((x) => x.name)).toEqual(['Trust', 'Access']);
    expect(sortCodeRows(rows, 'disagree', 'asc', 'segment', collator).map((x) => x.name)).toEqual(['Trust', 'Access']);
    // Segment level has no kappa per code: both are empty, so the order falls back to names.
    expect(sortCodeRows(rows, 'kappa', 'desc', 'segment', collator).map((x) => x.name)).toEqual(['Access', 'Trust']);
  });
});

describe('disagreements', () => {
  const A = 'ana';
  const B = 'rui';

  it('pairs mutual closest segments into one boundary item and keeps the rest alone', () => {
    const a1 = coding(A, 'k', 'd', 0, 100);
    const a2 = coding(A, 'k', 'd', 300, 320);
    const b1 = coding(B, 'k', 'd', 10, 100);
    const b2 = coding(B, 'k', 'd', 500, 520);
    const seg = segmentAgreement([a1, a2], [b1, b2], ['k'], { threshold: 0.95 });
    const items = pairDisagreements(seg.disagreements);
    expect(items.map((i) => i.kind)).toEqual(['boundary', 'onlyA', 'onlyB']);
    expect(items[0]).toMatchObject({ key: `${a1.id}|${b1.id}`, start: 0, end: 100 });
    expect(items[0]!.overlap).toBeCloseTo(0.9);
    expect(items[1]).toMatchObject({ key: `${a2.id}|-`, a: { codingId: a2.id }, b: null });
    expect(items[2]).toMatchObject({ key: `-|${b2.id}` });
  });

  it('gives a contested segment to its mutual partner, not to the first claim', () => {
    // b closest to a2 (0.8) rather than a1 (0.5); a1 also points at b.
    const a1 = coding(A, 'k', 'd', 0, 50);
    const a2 = coding(A, 'k', 'd', 20, 100);
    const b = coding(B, 'k', 'd', 0, 100);
    const seg = segmentAgreement([a1, a2], [b], ['k'], { threshold: 0.9 });
    const items = pairDisagreements(seg.disagreements);
    const boundary = items.filter((i) => i.kind === 'boundary');
    expect(boundary).toHaveLength(1);
    expect(boundary[0]!.a!.codingId).toBe(a2.id);
    expect(items.find((i) => i.a?.codingId === a1.id)!.kind).toBe('onlyA');
  });

  it('orders by document order, then position', () => {
    const x = coding(A, 'k', 'd2', 0, 10);
    const y = coding(A, 'k', 'd1', 50, 60);
    const seg = segmentAgreement([x, y], [], ['k']);
    const items = pairDisagreements(
      seg.disagreements,
      new Map([
        ['d2', 0],
        ['d1', 1],
      ]),
    );
    expect(items.map((i) => i.documentId)).toEqual(['d2', 'd1']);
  });

  it('resolves: accepting one side removes the other side’s coding, and Undo brings the item back', () => {
    const a = coding(A, 'k', 'd', 0, 100);
    const b = coding(B, 'k', 'd', 30, 100);
    const [item] = pairDisagreements(segmentAgreement([a], [b], ['k']).disagreements);
    expect(resolutionRemoves(item!, 'acceptA')).toEqual([b.id]);
    expect(resolutionRemoves(item!, 'acceptB')).toEqual([a.id]);
    expect(resolutionRemoves(item!, 'keepBoth')).toEqual([]);

    const review = reviewAfter(EMPTY_REVIEW, item!, 'acceptA');
    // After the removal, A's coding is left alone as an "only A" item: resolved.
    const [left] = pairDisagreements(segmentAgreement([a], [], ['k']).disagreements);
    expect(isResolved(left!, review, new Set([a.id]))).toBe(true);
    // Undo restores B's coding: the pair is back and open again.
    expect(isResolved(item!, review, new Set([a.id, b.id]))).toBe(false);
    expect(isResolved(left!, review, new Set([a.id, b.id]))).toBe(false);
  });

  it('counts keeping (or accepting a side that removes nothing) as reviewed', () => {
    const a = coding(A, 'k', 'd', 0, 100);
    const [item] = pairDisagreements(segmentAgreement([a], [], ['k']).disagreements);
    expect(resolutionRemoves(item!, 'acceptA')).toEqual([]);
    const review = reviewAfter(EMPTY_REVIEW, item!, 'acceptA');
    expect(isResolved(item!, review, new Set([a.id]))).toBe(true);
    expect(isResolved(item!, reviewAfter(EMPTY_REVIEW, item!, 'keepBoth'), new Set())).toBe(true);
    expect(isResolved(item!, EMPTY_REVIEW, new Set([a.id]))).toBe(false);
  });
});

describe('passage', () => {
  const text = 'First paragraph.\nSecond one is here, quite short.\nThird.';

  it('widens to whole paragraphs', () => {
    const s = text.indexOf('one');
    expect(passageWindow(text, s, s + 3)).toEqual({ start: 17, end: 17 + 'Second one is here, quite short.'.length, cutBefore: false, cutAfter: false });
    expect(passageWindow(text, 0, 3)).toMatchObject({ start: 0, end: 16 });
    expect(passageWindow(text, text.length - 2, text.length)).toMatchObject({ start: text.lastIndexOf('\n') + 1, end: text.length });
  });

  it('cuts long paragraphs at a space, at most `context` characters around', () => {
    const long = `${'word '.repeat(200)}TARGET${' more'.repeat(200)}`;
    const s = long.indexOf('TARGET');
    const w = passageWindow(long, s, s + 6, 50);
    expect(w.cutBefore).toBe(true);
    expect(w.cutAfter).toBe(true);
    expect(s - w.start).toBeLessThanOrEqual(50);
    expect(w.end - (s + 6)).toBeLessThanOrEqual(50);
    expect(long[w.start - 1]).toBe(' ');
    expect(long[w.end]).toBe(' ');
  });

  it('cuts the window into pieces by who coded them', () => {
    expect(pieces(0, 100, [{ start: 10, end: 50 }], [{ start: 30, end: 70 }])).toEqual([
      { start: 0, end: 10, a: false, b: false },
      { start: 10, end: 30, a: true, b: false },
      { start: 30, end: 50, a: true, b: true },
      { start: 50, end: 70, a: false, b: true },
      { start: 70, end: 100, a: false, b: false },
    ]);
    expect(pieces(20, 40, [{ start: 0, end: 100 }], [])).toEqual([{ start: 20, end: 40, a: true, b: false }]);
    // Adjacent spans of the same coder merge into one piece.
    expect(
      pieces(
        0,
        30,
        [
          { start: 0, end: 10 },
          { start: 10, end: 20 },
        ],
        [],
      ),
    ).toEqual([
      { start: 0, end: 20, a: true, b: false },
      { start: 20, end: 30, a: false, b: false },
    ]);
  });
});

describe('performance', () => {
  it('runs a large project (100 documents, 300 codes, 20 000 codings) quickly', () => {
    const docs = Array.from({ length: 100 }, (_, i) => ({ id: `d${i}`, length: 60_000 }));
    const codes = Array.from({ length: 300 }, (_, i) => `k${i}`);
    const make = (coder: string, jitter: number) =>
      Array.from({ length: 10_000 }, (_, i) => {
        const start = (i * 397) % 59_000;
        return coding(coder, codes[(i * 7) % 300]!, docs[i % 100]!.id, start + jitter * (i % 3), start + 200);
      });
    const a = make('A', 0);
    const b = make('B', 15);
    const t0 = performance.now();
    const r = runAgreement({ codingsA: a, codingsB: b, documents: docs, codeIds: codes, threshold: 0.9 });
    const rows = codeRows(r, new Map());
    const items = pairDisagreements(r.segment.disagreements);
    const ms = performance.now() - t0;
    expect(rows).toHaveLength(300);
    expect(items.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(3000);
  });
});

describe('fmtOverlap', () => {
  it('never reads as reaching the threshold it failed', () => {
    expect(fmtOverlap(0.8469, 0.85, 'en-GB')).toBe('84.6%');
    expect(fmtOverlap(0.5972, 0.6, 'en-GB')).toBe('59.7%');
    expect(fmtOverlap(0.5952, 0.6, 'pt-PT')).toMatch(/^59,5\s?%$/);
    expect(fmtOverlap(0.84999, 0.85, 'en-GB')).toBe('84.9%');
    expect(fmtOverlap(0.84, 0.84, 'en-GB')).toBe('84%');
    expect(fmtOverlap(0.4, 0.85, 'en-GB')).toBe('40%');
  });
});
