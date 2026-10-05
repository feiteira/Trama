import { describe, expect, it } from 'vitest';
import type { KwicRow } from '../../../core/qda/search';
import { code } from '../../../core/qda/fixtures';
import { buildTree } from '../../../core/qda/tree';
import { codeLines, defaultCodeSelection, inCodebookOrder, segmentCounts, visibleLines } from './codeLines';
import { formatP, formatPercent, formatValue, matrixRows, safeFileName } from './format';
import { heatScale, inkFor, rampColor, rampGradient } from './heat';
import { countPerDocument, flattenKwic, groupKwic, hitsWithin, kwicExportRows } from './kwic';
import { edgesOf, forceLayout, nodeRadius, seeded } from './network';
import { readSettings, settingsKey, writeSettings } from './settings';
import { prefixOffsets, scrollToShow, visibleRange } from './virtual';
import { layoutCloud, wordSize } from './wordcloud';

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

describe('heat scale', () => {
  it('gets darker with the value on light paper and lighter on dark paper', () => {
    const light = [0, 0.25, 0.5, 0.75, 1].map((t) => lum(rampColor(t, 'light')));
    const dark = [0, 0.25, 0.5, 0.75, 1].map((t) => lum(rampColor(t, 'dark')));
    for (let i = 1; i < light.length; i++) {
      expect(light[i]!).toBeLessThan(light[i - 1]!);
      expect(dark[i]!).toBeGreaterThan(dark[i - 1]!);
    }
  });

  it('hits the ramp ends exactly and clamps outside [0, 1]', () => {
    expect(rampColor(0)).toBe('#cde2fb');
    expect(rampColor(1)).toBe('#0d366b');
    expect(rampColor(-3)).toBe('#cde2fb');
    expect(rampColor(7)).toBe('#0d366b');
    expect(rampColor(Number.NaN)).toBe('#cde2fb');
  });

  it('maps a matrix: zero has no fill, the maximum is the darkest, the diagonal can be skipped', () => {
    const m = [
      [50, 2, 0],
      [2, 30, 4],
      [0, 4, 9],
    ];
    const s = heatScale(m, { skipDiagonal: true });
    expect(s.max).toBe(4);
    expect(s.fill(0)).toBeNull();
    expect(s.t(4)).toBe(1);
    expect(s.t(2)).toBeGreaterThan(0.12);
    expect(s.t(2)).toBeLessThan(1);
    expect(s.fill(4)).toBe('#0d366b');
    expect(s.ink(4)).toBe('#ffffff');
    expect(s.ink(0)).toBe('#1d2130');
    expect(heatScale(m).max).toBe(50);
    expect(heatScale(m, { max: 100 }).t(50)).toBeCloseTo(0.12 + 0.88 * 0.5);
  });

  it('picks the label ink that contrasts more', () => {
    expect(inkFor('#ffffff')).toBe('#1d2130');
    expect(inkFor('#0d366b')).toBe('#ffffff');
    expect(rampGradient('light', 3)).toMatch(/^linear-gradient\(to right, #[0-9a-f]{6}, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
  });
});

describe('force layout', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, weight: i + 1 }));
  const matrix = [
    [0, 5, 1, 0, 0],
    [5, 0, 2, 0, 0],
    [1, 2, 0, 0, 0],
    [0, 0, 0, 0, 3],
    [0, 0, 0, 3, 0],
  ];
  const edges = edgesOf(matrix);

  it('lists the upper triangle, heaviest first', () => {
    expect(edges.map((e) => [e.a, e.b, e.weight])).toEqual([
      [0, 1, 5],
      [3, 4, 3],
      [1, 2, 2],
      [0, 2, 1],
    ]);
    expect(edgesOf(matrix, 3)).toHaveLength(2);
  });

  it('is deterministic for a seed and stays inside the padded box', () => {
    const a = forceLayout(nodes, edges, { width: 600, height: 400, seed: 3 });
    const b = forceLayout(nodes, edges, { width: 600, height: 400, seed: 3 });
    expect(a).toEqual(b);
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(40 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(560 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(40 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(360 + 1e-9);
    }
  });

  it('puts strongly co-occurring codes closer than unrelated ones', () => {
    const p = forceLayout(nodes, edges, { width: 600, height: 400 });
    const d = (i: number, j: number) => Math.hypot(p[i]!.x - p[j]!.x, p[i]!.y - p[j]!.y);
    expect(d(0, 1)).toBeLessThan(d(0, 3));
    expect(d(3, 4)).toBeLessThan(d(1, 4));
  });

  it('handles none, one and identical nodes', () => {
    expect(forceLayout([], [], { width: 100, height: 100 })).toEqual([]);
    expect(forceLayout([{ id: 'x', weight: 1 }], [], { width: 100, height: 80 })).toEqual([{ x: 50, y: 40 }]);
    const many = forceLayout(nodes, [], { width: 300, height: 300 });
    expect(many.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true);
  });

  it('sizes nodes by area and seeds reproducibly', () => {
    expect(nodeRadius(0, 10)).toBe(6);
    expect(nodeRadius(10, 10)).toBe(26);
    expect(nodeRadius(2.5, 10)).toBeCloseTo(16);
    const r1 = seeded(1);
    const r2 = seeded(1);
    expect([r1(), r1()]).toEqual([r2(), r2()]);
  });
});

describe('word cloud', () => {
  const measure = (w: string, size: number) => w.length * size * 0.6;
  const words = Array.from({ length: 40 }, (_, i) => ({ word: `word${i}`, count: 100 - i * 2 }));

  it('places words without overlaps, inside the box, deterministically', () => {
    const a = layoutCloud(words, { width: 500, height: 300, measure });
    const b = layoutCloud(words, { width: 500, height: 300, measure });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(20);
    for (const w of a) {
      expect(w.x - w.width / 2).toBeGreaterThanOrEqual(0);
      expect(w.x + w.width / 2).toBeLessThanOrEqual(500);
      expect(w.y - w.height / 2).toBeGreaterThanOrEqual(0);
      expect(w.y + w.height / 2).toBeLessThanOrEqual(300);
    }
    for (let i = 0; i < a.length; i++)
      for (let j = i + 1; j < a.length; j++) {
        const p = a[i]!;
        const q = a[j]!;
        const apart = Math.abs(p.x - q.x) * 2 >= p.width + q.width || Math.abs(p.y - q.y) * 2 >= p.height + q.height;
        expect(apart).toBe(true);
      }
  });

  it('puts the most frequent word, largest, at the centre', () => {
    const [first] = layoutCloud(words, { width: 500, height: 300, measure });
    expect(first!.word).toBe('word0');
    expect(first!.x).toBeCloseTo(250, 0);
    expect(first!.y).toBeCloseTo(150, 0);
    expect(first!.weight).toBe(1);
  });

  it('sizes by square root of the count', () => {
    expect(wordSize(1, 1, 100, 10, 50)).toBe(10);
    expect(wordSize(100, 1, 100, 10, 50)).toBe(50);
    expect(wordSize(25, 1, 100, 10, 50)).toBeCloseTo(10 + 40 * (4 / 9));
    expect(wordSize(5, 5, 5, 10, 50)).toBe(30);
    expect(layoutCloud([], { width: 10, height: 10, measure })).toEqual([]);
  });
});

describe('KWIC', () => {
  const row = (documentId: string, start: number, left = 'before', right = 'after'): KwicRow => ({ documentId, start, end: start + 5, left, keyword: 'trust', right });
  const docs = [
    { id: 'd1', name: 'Interview 1' },
    { id: 'd2', name: 'Interview 2' },
    { id: 'd3', name: 'Interview 3' },
  ];

  it('groups by document in list order, with totals beyond the shown rows', () => {
    const groups = groupKwic([row('d3', 5), row('d1', 10), row('d1', 40), row('dx', 1)], docs, new Map([['d1', 7], ['d3', 1]]));
    expect(groups.map((g) => [g.documentId, g.rows.length, g.total])).toEqual([
      ['d1', 2, 7],
      ['d3', 1, 1],
      ['dx', 1, 1],
    ]);
  });

  it('keeps only hits inside the given spans', () => {
    const hits = [
      { documentId: 'd1', start: 10, end: 15 },
      { documentId: 'd1', start: 18, end: 25 },
      { documentId: 'd1', start: 40, end: 45 },
      { documentId: 'd2', start: 10, end: 15 },
    ];
    const spans = new Map([['d1', [{ start: 0, end: 16 }, { start: 15, end: 30 }]]]);
    expect(hitsWithin(hits, spans)).toEqual(hits.slice(0, 2));
    expect(countPerDocument(hits)).toEqual(new Map([['d1', 3], ['d2', 1]]));
  });

  it('flattens groups into list rows, leaving collapsed documents closed', () => {
    const groups = groupKwic([row('d1', 1), row('d1', 9), row('d2', 3)], docs);
    const items = flattenKwic(groups, new Set(['d2']));
    expect(items.map((i) => i.kind)).toEqual(['doc', 'hit', 'hit', 'doc']);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    expect(kwicExportRows(groups, ['Document', 'Start', 'End', 'Left', 'Hit', 'Right'])[1]).toEqual(['Interview 1', 1, 6, 'before', 'trust', 'after']);
  });
});

describe('code lines', () => {
  const codes = [
    code('a', { name: 'Wellbeing', order: 1 }),
    code('a1', { name: 'Belonging', parent_id: 'a', order: 1 }),
    code('a2', { name: 'Calm', parent_id: 'a', order: 2 }),
    code('a2x', { name: 'Quiet', parent_id: 'a2', order: 1 }),
    code('b', { name: 'Conflict', order: 2, codable: false }),
  ];
  const lines = codeLines(buildTree(codes).flatten());

  it('carries depth, children and the path', () => {
    expect(lines.map((l) => [l.id, l.depth, l.hasChildren])).toEqual([
      ['a', 0, true],
      ['a1', 1, false],
      ['a2', 1, true],
      ['a2x', 2, false],
      ['b', 0, false],
    ]);
    expect(lines[3]!.path).toEqual(['Wellbeing', 'Calm', 'Quiet']);
  });

  it('hides the descendants of collapsed codes', () => {
    expect(visibleLines(lines, new Set(['a2'])).map((l) => l.id)).toEqual(['a', 'a1', 'a2', 'b']);
    expect(visibleLines(lines, new Set(['a', 'a2'])).map((l) => l.id)).toEqual(['a', 'b']);
    expect(visibleLines(lines, new Set()).length).toBe(5);
  });

  it('chooses the most used codable codes, in codebook order', () => {
    const counts = segmentCounts([{ code_id: 'a2x' }, { code_id: 'a1' }, { code_id: 'a1' }, { code_id: 'b' }, { code_id: 'a', deleted: true }]);
    expect(defaultCodeSelection(lines, counts)).toEqual(['a1', 'a2x']);
    expect(defaultCodeSelection(lines, counts, 1)).toEqual(['a1']);
    expect(inCodebookOrder(lines, ['b', 'zz', 'a'])).toEqual(['a', 'b']);
  });
});

describe('settings', () => {
  const defaults = { mode: 'words' as 'words' | 'regex', wholeWord: false, distance: 50, ids: [] as string[], group: null as string | null };

  it('merges valid stored fields over the defaults', () => {
    const s = memoryStorage({ k: JSON.stringify({ mode: 'regex', wholeWord: 'yes', distance: 10, ids: ['x', 1], group: 'g', extra: 1 }) });
    expect(readSettings('k', defaults, { mode: ['words', 'regex'] }, s)).toEqual({ mode: 'regex', wholeWord: false, distance: 10, ids: [], group: 'g' });
  });

  it('refuses values outside the allowed list and survives broken storage', () => {
    const s = memoryStorage({ k: JSON.stringify({ mode: 'magic' }), bad: '{nope' });
    expect(readSettings('k', defaults, { mode: ['words', 'regex'] }, s).mode).toBe('words');
    expect(readSettings('bad', defaults, {}, s)).toEqual(defaults);
    expect(readSettings('k', defaults, {}, null)).toEqual(defaults);
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(readSettings('k', defaults, {}, throwing)).toEqual(defaults);
    expect(() => writeSettings('k', defaults, throwing)).not.toThrow();
  });

  it('round-trips and keys by project and tool', () => {
    const s = memoryStorage();
    writeSettings(settingsKey('p1', 'search'), { ...defaults, distance: 3 }, s);
    expect(readSettings(settingsKey('p1', 'search'), defaults, {}, s).distance).toBe(3);
    expect(readSettings(settingsKey('p2', 'search'), defaults, {}, s).distance).toBe(50);
  });
});

describe('virtual list', () => {
  const offs = prefixOffsets([36, 30, 30, 30, 36, 30, 30]);

  it('computes offsets and the visible window', () => {
    expect([...offs]).toEqual([0, 36, 66, 96, 126, 162, 192, 222]);
    expect(visibleRange(offs, 0, 60, 0)).toEqual([0, 2]);
    expect(visibleRange(offs, 70, 60, 0)).toEqual([2, 5]);
    expect(visibleRange(offs, 70, 60, 1)).toEqual([1, 6]);
    expect(visibleRange(prefixOffsets([]), 0, 100)).toEqual([0, 0]);
  });

  it('scrolls just enough to show an item', () => {
    expect(scrollToShow(offs, 6, 0, 100)).toBe(122);
    expect(scrollToShow(offs, 0, 50, 100)).toBe(0);
    expect(scrollToShow(offs, 2, 40, 100)).toBe(40);
  });
});

describe('format', () => {
  it('formats values, percentages and p by locale', () => {
    expect(formatValue(1234, 'en')).toBe('1,234');
    expect(formatValue(12.345, 'pt-PT')).toBe('12,3');
    expect(formatValue(null, 'en')).toBe('–');
    expect(formatPercent(12.34, 'en')).toBe('12.3%');
    expect(formatPercent(100, 'en')).toBe('100%');
    expect(formatP(0.0001, 'en')).toBe('< 0.001');
    expect(formatP(0.04567, 'es-ES')).toBe('0,046');
  });

  it('builds export tables and safe file names', () => {
    expect(matrixRows('Code', ['A', 'B'], ['d1', 'd2'], [[1, 2.33333], [0, null]], { label: 'Total', rows: [3, 0], cols: [1, 2], grand: 3 })).toEqual([
      ['Code', 'd1', 'd2', 'Total'],
      ['A', 1, 2.333, 3],
      ['B', 0, null, 0],
      ['Total', 1, 2, 3],
    ]);
    expect(safeFileName('Co-occurrence: a/b?', 'csv')).toBe('Co-occurrence a b.csv');
    expect(safeFileName('   ', 'png')).toBe('Trama.png');
  });
});

import { barPath, niceTicks, stackSegments } from './scale';

describe('axes and marks', () => {
  it('picks round ticks that cover the maximum', () => {
    expect(niceTicks(87)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(4)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(0.37, 4)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(niceTicks(1200, 3)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(2, 4, true)).toEqual([0, 1, 2]);
  });

  it('draws bars with a rounded data end only', () => {
    expect(barPath(0, 0, 0, 10)).toBe('');
    expect(barPath(10, 5, 50, 12)).toBe('M10,5H56A4,4 0 0 1 60,9V13A4,4 0 0 1 56,17H10Z');
  });

  it('stacks segments with surface gaps', () => {
    expect(stackSegments([2, 0, 2], 4, 100)).toEqual([
      { x: 0, w: 48 },
      { x: 50, w: 0 },
      { x: 50, w: 48 },
    ]);
    expect(stackSegments([1], 0, 100)).toEqual([{ x: 0, w: 0 }]);
  });
});

import { separateBoxes } from './network';

describe('label separation', () => {
  it('pushes overlapping node boxes apart and keeps them in the box', () => {
    const boxes = [
      { x: 100, y: 100, l: 10, r: 80, u: 10, d: 10 },
      { x: 120, y: 105, l: 10, r: 80, u: 10, d: 10 },
      { x: 400, y: 100, l: 10, r: 10, u: 10, d: 10 },
    ];
    const p = separateBoxes(boxes, 500, 300);
    const overlap = (i: number, j: number) =>
      Math.min(p[i]!.x + boxes[i]!.r, p[j]!.x + boxes[j]!.r) - Math.max(p[i]!.x - boxes[i]!.l, p[j]!.x - boxes[j]!.l) > 0 &&
      Math.min(p[i]!.y + boxes[i]!.d, p[j]!.y + boxes[j]!.d) - Math.max(p[i]!.y - boxes[i]!.u, p[j]!.y - boxes[j]!.u) > 0;
    expect(overlap(0, 1)).toBe(false);
    expect(p[2]).toEqual({ x: 400, y: 100 });
    expect(separateBoxes(boxes, 500, 300)).toEqual(p);
    for (const q of p) expect(q.y).toBeGreaterThanOrEqual(10);
  });
});

describe('performance of the view models', () => {
  it('lays out 40 codes, 80 words and 5,000 hits quickly', () => {
    const r = seeded(5);
    const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, weight: 1 + Math.floor(r() * 300) }));
    const m = Array.from({ length: 40 }, (_, i) => Array.from({ length: 40 }, (_, j) => (i === j ? 0 : Math.floor(r() * 4))));
    for (let i = 0; i < 40; i++) for (let j = 0; j < i; j++) m[i]![j] = m[j]![i]!;
    let t0 = performance.now();
    const pos = forceLayout(nodes, edgesOf(m), { width: 1000, height: 600, iterations: 320 });
    separateBoxes(pos.map((p) => ({ ...p, l: 10, r: 120, u: 12, d: 12 })), 1000, 600);
    expect(performance.now() - t0).toBeLessThan(300);

    const words = Array.from({ length: 80 }, (_, i) => ({ word: `w${i}xx`, count: 500 - i * 5 }));
    t0 = performance.now();
    layoutCloud(words, { width: 900, height: 500, measure: (w, s) => w.length * s * 0.6 });
    expect(performance.now() - t0).toBeLessThan(300);

    const rows: KwicRow[] = Array.from({ length: 5000 }, (_, i) => ({ documentId: `d${i % 100}`, start: i * 10, end: i * 10 + 4, left: 'l', keyword: 'k', right: 'r' }));
    const docs = Array.from({ length: 100 }, (_, i) => ({ id: `d${i}`, name: `Doc ${i}` }));
    t0 = performance.now();
    const items = flattenKwic(groupKwic(rows, docs), new Set());
    visibleRange(prefixOffsets(items.map((x) => (x.kind === 'doc' ? 40 : 34))), 50_000, 600);
    expect(items).toHaveLength(5100);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
