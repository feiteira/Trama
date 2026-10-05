import { describe, expect, it } from 'vitest';
import { assignLanes, clusterWidths } from './lanes';
import { buildRuns, findsByParagraph, marksAt, marksByParagraph } from './runs';
import { formatTime, paragraphAtTime, paragraphIndexAt, speakerLabelLength, splitParagraphs } from './paragraphs';
import { boundaryOffset, cleanSelection, type NodeLike, pointIn, rangeOffsets, splitsSurrogate } from './offsets';
import { findAll, firstMatchFrom } from './find';
import { codeOptions, exactCode, favourites, pushRecent, recentCodes, searchCodes } from './codeSearch';
import { filterByCoder, markStyles, parseCoderFilter, coderFilterKey, runPaint } from './highlight';
import { code as mkCode } from '../../../core/qda/fixtures';

// ---------------------------------------------------------------------------------------------
// Lanes

describe('assignLanes', () => {
  it('gives a lone item lane 0 and uses no more lanes than the deepest overlap', () => {
    const r = assignLanes([
      { id: 'a', lo: 0, hi: 10 },
      { id: 'b', lo: 5, hi: 15 },
      { id: 'c', lo: 12, hi: 20 },
      { id: 'd', lo: 30, hi: 40 },
    ]);
    expect(r.lane.get('a')).toBe(0);
    expect(r.lane.get('b')).toBe(1);
    expect(r.lane.get('c')).toBe(0); // a has ended: its lane is free again
    expect(r.lane.get('d')).toBe(0);
    expect(r.count).toBe(2);
  });

  it('lets touching items share a lane, unless a gap is asked for', () => {
    const items = [
      { id: 'a', lo: 0, hi: 10 },
      { id: 'b', lo: 10, hi: 20 },
    ];
    expect(assignLanes(items).count).toBe(1);
    expect(assignLanes(items, 2).count).toBe(2);
  });

  it('puts the longer of two items starting together in the inner lane', () => {
    const r = assignLanes([
      { id: 'short', lo: 0, hi: 5 },
      { id: 'long', lo: 0, hi: 50 },
    ]);
    expect(r.lane.get('long')).toBe(0);
    expect(r.lane.get('short')).toBe(1);
  });

  it('is deterministic whatever the input order', () => {
    const items = [
      { id: 'x', lo: 0, hi: 5 },
      { id: 'y', lo: 0, hi: 5 },
      { id: 'z', lo: 2, hi: 9 },
    ];
    const a = assignLanes(items);
    const b = assignLanes([...items].reverse());
    expect([...a.lane]).toEqual(expect.arrayContaining([...b.lane]));
    expect(a.lane.get('x')).toBe(0);
    expect(a.lane.get('y')).toBe(1);
    expect(a.lane.get('z')).toBe(2);
  });

  it('handles nested spans and empty input', () => {
    expect(assignLanes([]).count).toBe(0);
    const r = assignLanes([
      { id: 'outer', lo: 0, hi: 100 },
      { id: 'in1', lo: 10, hi: 20 },
      { id: 'in2', lo: 30, hi: 40 },
    ]);
    expect(r.lane.get('in1')).toBe(1);
    expect(r.lane.get('in2')).toBe(1);
    expect(r.count).toBe(2);
  });

  it('reports the lanes each overlap cluster needs', () => {
    const items = [
      { id: 'a', lo: 0, hi: 10 },
      { id: 'b', lo: 5, hi: 15 },
      { id: 'c', lo: 40, hi: 50 },
    ];
    const w = clusterWidths(items, assignLanes(items));
    expect(w.get('a')).toBe(2);
    expect(w.get('b')).toBe(2);
    expect(w.get('c')).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Paragraphs

describe('paragraphs', () => {
  it('recognises speaker labels but not sentences with a colon', () => {
    expect(speakerLabelLength('Marta: I started in March.')).toBe(6);
    expect(speakerLabelLength('Dr. Sousa: Right.')).toBe(10);
    expect(speakerLabelLength('P3: yes')).toBe(3);
    expect(speakerLabelLength('[Interviewer]: so')).toBe(14);
    expect(speakerLabelLength('This is what she told me about it: nothing.')).toBe(0);
    expect(speakerLabelLength('No label here')).toBe(0);
    expect(speakerLabelLength('Time:10')).toBe(0);
  });

  it('cuts every line into a paragraph with its offsets, label and time', () => {
    const text = 'Ana: Hello.\n\nRui: Hi there.\nnote';
    const paras = splitParagraphs(text, { transcript: true, sync: [{ pos: 0, ms: 1000 }, { pos: 13, ms: 4000 }] });
    expect(paras.map((p) => text.slice(p.start, p.end))).toEqual(['Ana: Hello.', '', 'Rui: Hi there.', 'note']);
    expect(paras[0]!.labelEnd).toBe(4);
    expect(paras[1]!.blank).toBe(true);
    expect(paras[2]!.labelEnd).toBe(17);
    expect(paras.map((p) => p.ms)).toEqual([1000, null, 4000, null]);
  });

  it('ignores labels outside transcripts and handles an empty text', () => {
    expect(splitParagraphs('Ana: Hello.')[0]!.labelEnd).toBe(0);
    expect(splitParagraphs('')).toEqual([{ index: 0, start: 0, end: 0, labelEnd: 0, ms: null, blank: true }]);
  });

  it('finds the paragraph at an offset and at a media time', () => {
    const paras = splitParagraphs('a\nbb\nccc', { sync: [{ pos: 2, ms: 500 }, { pos: 5, ms: 900 }] });
    expect(paragraphIndexAt(paras, 0)).toBe(0);
    expect(paragraphIndexAt(paras, 1)).toBe(0);
    expect(paragraphIndexAt(paras, 2)).toBe(1);
    expect(paragraphIndexAt(paras, 7)).toBe(2);
    const timed = paras.filter((p) => p.ms !== null).map((p) => p.index);
    expect(paragraphAtTime(paras, timed, 100)).toBe(-1);
    expect(paragraphAtTime(paras, timed, 500)).toBe(1);
    expect(paragraphAtTime(paras, timed, 899)).toBe(1);
    expect(paragraphAtTime(paras, timed, 5000)).toBe(2);
  });

  it('formats media times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65_400)).toBe('1:05');
    expect(formatTime(3_729_000)).toBe('1:02:09');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});

// ---------------------------------------------------------------------------------------------
// Runs

describe('buildRuns', () => {
  const para = { start: 100, end: 130, labelEnd: 100 };

  it('leaves an uncoded paragraph as one run', () => {
    expect(buildRuns(para, [])).toEqual([{ start: 100, end: 130, ids: [], label: false, find: -1 }]);
  });

  it('splits overlapping codings into runs with the set covering each', () => {
    const runs = buildRuns(para, [
      { id: 'a', start: 105, end: 120 },
      { id: 'b', start: 110, end: 125 },
    ]);
    expect(runs.map((r) => [r.start, r.end, r.ids.join('+')])).toEqual([
      [100, 105, ''],
      [105, 110, 'a'],
      [110, 120, 'a+b'],
      [120, 125, 'b'],
      [125, 130, ''],
    ]);
  });

  it('clips codings that cross the paragraph and keeps the given order of ids', () => {
    const runs = buildRuns(para, [
      { id: 'late', start: 120, end: 200 },
      { id: 'early', start: 0, end: 125 },
    ]);
    expect(runs.map((r) => [r.start, r.end, r.ids])).toEqual([
      [100, 120, ['early']],
      [120, 125, ['late', 'early']],
      [125, 130, ['late']],
    ]);
  });

  it('cuts at the speaker label and at find matches', () => {
    const runs = buildRuns({ start: 0, end: 20, labelEnd: 5 }, [{ id: 'a', start: 3, end: 8 }], [{ start: 10, end: 12, index: 7 }]);
    expect(runs.map((r) => [r.start, r.end, r.label, r.ids.length, r.find])).toEqual([
      [0, 3, true, 0, -1],
      [3, 5, true, 1, -1],
      [5, 8, false, 1, -1],
      [8, 10, false, 0, -1],
      [10, 12, false, 0, 7],
      [12, 20, false, 0, -1],
    ]);
  });

  it('covers the paragraph exactly, without gaps, for many random overlaps', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 50; n++) {
      const marks = Array.from({ length: 8 }, (_, i) => {
        const s = 90 + Math.floor(rnd() * 50);
        return { id: `m${i}`, start: s, end: s + 1 + Math.floor(rnd() * 20) };
      });
      const runs = buildRuns(para, marks);
      expect(runs[0]!.start).toBe(100);
      expect(runs[runs.length - 1]!.end).toBe(130);
      for (let i = 1; i < runs.length; i++) expect(runs[i]!.start).toBe(runs[i - 1]!.end);
      for (const r of runs) {
        const expected = marks.filter((m) => m.start <= r.start && m.end >= r.end).map((m) => m.id);
        expect(r.ids).toEqual(expected);
      }
    }
  });

  it('ignores empty codings and returns nothing for an empty paragraph', () => {
    expect(buildRuns({ start: 5, end: 5, labelEnd: 5 }, [{ id: 'a', start: 0, end: 10 }])).toEqual([]);
    expect(buildRuns(para, [{ id: 'a', start: 110, end: 110 }])).toHaveLength(1);
  });

  it('assigns codings to every paragraph they touch', () => {
    const paras = splitParagraphs('one\ntwo\nthree');
    const by = marksByParagraph(paras, [
      { id: 'a', start: 0, end: 3 },
      { id: 'b', start: 2, end: 6 },
      { id: 'c', start: 8, end: 13 },
      { id: 'd', start: 3, end: 4 }, // just the newline: touches nothing visible
    ]);
    expect(by[0]!.map((m) => m.id)).toEqual(['a', 'b']);
    expect(by[1]!.map((m) => m.id)).toEqual(['b']);
    expect(by[2]!.map((m) => m.id)).toEqual(['c']);
    const f = findsByParagraph(paras, [{ start: 4, end: 7, index: 0 }]);
    expect(f[0]).toBeUndefined();
    expect(f[1]![0]!.index).toBe(0);
    expect(marksAt([{ id: 'a', start: 0, end: 3 }], 3)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Offsets: a tiny fake DOM

type Fake = NodeLike & { attrs?: Record<string, string>; data?: string };

function el(attrs: Record<string, string>, children: Fake[]): Fake {
  const n: Fake = { nodeType: 1, parentNode: null, childNodes: children, attrs, getAttribute: (k) => attrs[k] ?? null };
  for (const c of children) c.parentNode = n;
  return n;
}
function tx(data: string): Fake {
  return { nodeType: 3, parentNode: null, childNodes: [], data };
}
const run = (s: number, text: string, extra: Record<string, string> = {}) => el({ 'data-s': String(s), 'data-e': String(s + text.length), ...extra }, [tx(text)]);

describe('offsets', () => {
  // "Ana: Hi 👋 there\nRui: ok" — the emoji is two UTF-16 code units.
  const text = 'Ana: Hi 👋 there\nRui: ok';
  const chip = el({ 'data-chrome': '' }, [tx('0:02')]);
  const p0 = el({ 'data-ps': '0', 'data-pe': '16' }, [chip, run(0, 'Ana:'), run(4, ' Hi 👋 '), run(11, 'there')]);
  const empty = el({ 'data-ps': '16', 'data-pe': '16' }, []);
  const p1 = el({ 'data-ps': '17', 'data-pe': '24' }, [run(17, 'Rui:'), run(21, ' ok')]);
  const root = el({ 'data-wb-root': '' }, [p0, tx('\n'), p1]);
  const lone = el({}, [empty]);

  it('reads offsets inside run text nodes', () => {
    const t = p0.childNodes[2]!.childNodes[0]!; // " Hi 👋 "
    expect(boundaryOffset(root, t, 0, 'start')).toBe(4);
    expect(boundaryOffset(root, t, 3, 'start')).toBe(7);
    expect(boundaryOffset(root, t, 99, 'end')).toBe(11); // clamped to the run
    expect(text.slice(4, 11)).toBe(' Hi 👋 ');
  });

  it('maps points on elements between children, facing the right way', () => {
    expect(boundaryOffset(root, p0, 0, 'start')).toBe(0); // before the chip: first run
    expect(boundaryOffset(root, p0, 4, 'end')).toBe(16); // after the last run
    expect(boundaryOffset(root, root, 1, 'end')).toBe(16); // between paragraphs, looking back
    expect(boundaryOffset(root, root, 1, 'start')).toBe(17); // … and forward
    expect(boundaryOffset(root, root, 3, 'end')).toBe(24);
    expect(boundaryOffset(root, p1.childNodes[1]!, 1, 'end')).toBe(24); // a run element itself
  });

  it('treats a point inside chrome as just before or after it', () => {
    const chipText = chip.childNodes[0]!;
    expect(boundaryOffset(root, chipText, 2, 'start')).toBe(0);
    expect(boundaryOffset(root, chipText, 2, 'end')).toBe(0);
  });

  it('resolves an empty paragraph to its position and refuses points outside', () => {
    expect(boundaryOffset(lone, empty, 0, 'start')).toBe(16);
    expect(boundaryOffset(root, tx('x'), 0, 'start')).toBeNull();
  });

  it('orders a backwards range', () => {
    const a = p1.childNodes[1]!.childNodes[0]!;
    const b = p0.childNodes[1]!.childNodes[0]!;
    expect(rangeOffsets(root, { startContainer: a, startOffset: 2, endContainer: b, endOffset: 1 })).toEqual({ start: 1, end: 23 });
  });

  it('never splits a surrogate pair and refuses blank selections', () => {
    const at = text.indexOf('👋');
    expect(splitsSurrogate(text, at + 1)).toBe(true);
    expect(splitsSurrogate(text, at)).toBe(false);
    expect(cleanSelection(text, at + 1, at + 1)).toBeNull();
    expect(cleanSelection(text, at + 1, at + 2)).toEqual({ start: at, end: at + 2 });
    expect(cleanSelection(text, 4, at + 1)).toEqual({ start: 4, end: at + 2 });
    expect(cleanSelection(text, 16, 17)).toBeNull(); // just the line break
    expect(cleanSelection(text, -5, 3)).toEqual({ start: 0, end: 3 });
  });

  it('finds the text node for an offset, choosing runs at boundaries', () => {
    const r = pointIn(p0, 7)!;
    expect(r.node).toBe(p0.childNodes[2]!.childNodes[0]);
    expect(r.offset).toBe(3);
    expect(pointIn(p0, 4, 'start')!.node).toBe(p0.childNodes[2]!.childNodes[0]);
    expect(pointIn(p0, 4, 'end')!.node).toBe(p0.childNodes[1]!.childNodes[0]);
    expect(pointIn(p0, 15)!.offset).toBe(4);
    expect(pointIn(empty, 16)).toEqual({ node: empty, offset: 0 });
  });
});

// ---------------------------------------------------------------------------------------------
// Find

describe('findAll', () => {
  it('ignores case and accents and maps back to the original text', () => {
    const text = 'Coração e CORACAO.\nOutro coração';
    const m = findAll(text, 'coracao');
    expect(m.map((s) => text.slice(s.start, s.end))).toEqual(['Coração', 'CORACAO', 'coração']);
  });

  it('can match whole words only, and never across lines', () => {
    const text = 'garden gardening\ngar\nden';
    expect(findAll(text, 'garden', { wholeWord: true })).toHaveLength(1);
    expect(findAll(text, 'gar den')).toHaveLength(0);
    expect(findAll(text, '   ')).toEqual([]);
  });

  it('handles emoji and picks the next match from a position', () => {
    const text = 'a 👋 b 👋 c';
    const m = findAll(text, '👋');
    expect(m).toEqual([{ start: 2, end: 4 }, { start: 7, end: 9 }]);
    expect(firstMatchFrom(m, 3)).toBe(1);
    expect(firstMatchFrom(m, 100)).toBe(0);
    expect(firstMatchFrom([], 0)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------------------------
// Code search

describe('code search', () => {
  const codes = [
    mkCode('p', { name: 'Feelings', order: 1, codable: false }),
    mkCode('a', { name: 'Loneliness', parent_id: 'p', order: 1, shortcut: 2 }),
    mkCode('b', { name: 'Belonging', parent_id: 'p', order: 2, shortcut: 1 }),
    mkCode('c', { name: 'Soil & growing', order: 2 }),
    mkCode('d', { name: 'Self-care', order: 3 }),
  ];
  const opts = codeOptions(codes);

  it('lists codes in codebook order with their paths', () => {
    expect(opts.map((o) => o.name)).toEqual(['Feelings', 'Loneliness', 'Belonging', 'Soil & growing', 'Self-care']);
    expect(opts[1]!.path).toEqual(['Feelings']);
  });

  it('ranks name starts first, finds by parent name, and skips categories', () => {
    expect(searchCodes(opts, 'lonel').map((o) => o.id)).toEqual(['a']);
    expect(searchCodes(opts, 'feel').map((o) => o.id)).toEqual(['a', 'b']);
    expect(searchCodes(opts, 'care').map((o) => o.id)).toEqual(['d']);
    expect(searchCodes(opts, '').map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(searchCodes(opts, 'zzz')).toEqual([]);
  });

  it('knows exact names, favourites and recent codes', () => {
    expect(exactCode(opts, '  LONELINESS ')?.id).toBe('a');
    expect(exactCode(opts, 'lonely')).toBeUndefined();
    expect(favourites(opts).map((o) => o.id)).toEqual(['b', 'a']);
    expect(recentCodes(opts, ['gone', 'c', 'p', 'a', 'c']).map((o) => o.id)).toEqual(['c', 'a']);
    expect(pushRecent(['a', 'b', 'c'], 'c', 3)).toEqual(['c', 'a', 'b']);
  });
});

// ---------------------------------------------------------------------------------------------
// Highlight

describe('highlight', () => {
  const codings = [
    { id: 'x', code_id: 'A', coder_id: 'me', start: 0, end: 10 },
    { id: 'y', code_id: 'B', coder_id: 'other', start: 5, end: 15 },
  ];

  it('filters by coder', () => {
    expect(filterByCoder(codings, { kind: 'all' }, 'me')).toHaveLength(2);
    expect(filterByCoder(codings, { kind: 'me' }, 'me').map((c) => c.id)).toEqual(['x']);
    expect(filterByCoder(codings, { kind: 'coder', id: 'other' }, 'me').map((c) => c.id)).toEqual(['y']);
    expect(parseCoderFilter(coderFilterKey({ kind: 'coder', id: 'q' }))).toEqual({ kind: 'coder', id: 'q' });
    expect(parseCoderFilter(null)).toEqual({ kind: 'all' });
    expect(parseCoderFilter('me')).toEqual({ kind: 'me' });
  });

  it('gives overlapping codings different bands and dims others when only the active code shows', () => {
    const s = markStyles(codings, (id) => (id === 'A' ? '#3a6ea5' : '#f3a712'), { activeCodeIds: new Set(['B']), activeOnly: true });
    expect(s.get('x')).toEqual({ color: '#3a6ea5', band: 0, state: 'dim' });
    expect(s.get('y')).toEqual({ color: '#f3a712', band: 1, state: 'active' });
    const plain = markStyles(codings, () => '#000000', { activeCodeIds: null, activeOnly: true });
    expect(plain.get('x')!.state).toBe('normal');
  });

  it('paints one tint layer per coding and a band per level', () => {
    const s = markStyles(codings, () => '#3a6ea5', { activeCodeIds: null, activeOnly: false });
    expect(runPaint([], s)).toEqual({});
    const one = runPaint(['x'], s).background!;
    expect(one.match(/linear-gradient/g)).toHaveLength(2);
    expect(one).toContain('calc(100% - 0px)');
    const two = runPaint(['x', 'y'], s).background!;
    expect(two.match(/linear-gradient/g)).toHaveLength(4);
    expect(two).toContain('calc(100% - 2px)');
  });
});
