import { describe, expect, it } from 'vitest';
import {
  applyEdits,
  computeEdits,
  expandToUnits,
  mapOffset,
  mapRange,
  normalizeEdits,
  paragraphSpans,
  replaceAll,
  sentenceSpans,
  splitsPair,
  trimSpan,
  type TextEdit,
} from './ranges';

/** Checks the invariants every computed edit list must hold. */
function checkEdits(a: string, b: string): TextEdit[] {
  const edits = computeEdits(a, b);
  expect(applyEdits(a, edits)).toBe(b);
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i]!;
    expect(e.end).toBeGreaterThanOrEqual(e.start);
    expect(e.start === e.end && e.insert === '').toBe(false);
    if (i > 0) expect(e.start).toBeGreaterThan(edits[i - 1]!.end);
    expect(splitsPair(a, e.start)).toBe(false);
    expect(splitsPair(a, e.end)).toBe(false);
  }
  return edits;
}

describe('normalizeEdits / applyEdits', () => {
  it('sorts, drops no-ops and merges touching edits', () => {
    const n = normalizeEdits([
      { start: 5, end: 7, insert: 'x' },
      { start: 0, end: 0, insert: '' },
      { start: 2, end: 2, insert: 'a' },
      { start: 2, end: 5, insert: 'b' },
    ]);
    expect(n).toEqual([{ start: 2, end: 7, insert: 'abx' }]);
  });

  it('rejects overlapping and malformed edits', () => {
    expect(() => normalizeEdits([{ start: 0, end: 3, insert: '' }, { start: 2, end: 4, insert: '' }])).toThrow(RangeError);
    expect(() => normalizeEdits([{ start: 3, end: 1, insert: '' }])).toThrow(RangeError);
    expect(() => normalizeEdits([{ start: -1, end: 1, insert: '' }])).toThrow(RangeError);
    expect(() => applyEdits('abc', [{ start: 2, end: 9, insert: '' }])).toThrow(RangeError);
  });

  it('applies edits in old-text coordinates', () => {
    expect(applyEdits('hello world', [{ start: 0, end: 5, insert: 'goodbye' }, { start: 11, end: 11, insert: '!' }])).toBe('goodbye world!');
    expect(applyEdits('', [{ start: 0, end: 0, insert: 'x' }])).toBe('x');
    expect(applyEdits('abc', [])).toBe('abc');
  });
});

describe('computeEdits', () => {
  it('returns nothing for equal texts', () => {
    expect(computeEdits('', '')).toEqual([]);
    expect(computeEdits('same', 'same')).toEqual([]);
  });

  it('handles empty sides', () => {
    expect(checkEdits('', 'new text')).toEqual([{ start: 0, end: 0, insert: 'new text' }]);
    expect(checkEdits('old text', '')).toEqual([{ start: 0, end: 8, insert: '' }]);
  });

  it('replaces whole words, not parts of them', () => {
    expect(checkEdits('I met Ana today.', 'I met Anabela today.')).toEqual([{ start: 6, end: 9, insert: 'Anabela' }]);
    expect(checkEdits('the teh cat', 'the the cat')).toEqual([{ start: 4, end: 7, insert: 'the' }]);
  });

  it('inserts and deletes whole words', () => {
    expect(checkEdits('the cat sat', 'the big cat sat')).toEqual([{ start: 4, end: 4, insert: 'big ' }]);
    expect(checkEdits('the big cat sat', 'the cat sat')).toEqual([{ start: 4, end: 8, insert: '' }]);
  });

  it('finds several separate changes', () => {
    const a = 'Ana lives in Porto. She works at the hospital. Ana likes it.';
    const b = 'P1 lives in Porto. She works at a clinic. P1 likes it.';
    const edits = checkEdits(a, b);
    // "the hospital" → "a clinic" is two word changes around an unchanged space.
    expect(edits.map((e) => a.slice(e.start, e.end))).toEqual(['Ana', 'the', 'hospital', 'Ana']);
    expect(edits[0]).toEqual({ start: 0, end: 3, insert: 'P1' });
  });

  it('never splits surrogate pairs', () => {
    checkEdits('a 😀 b', 'a 😁 b');
    checkEdits('😀😀', '😀😁');
    checkEdits('x😀', 'x😀😀');
    checkEdits('𝒜𝒷𝒸', '𝒜𝒸');
    const e = checkEdits('😀', '😁');
    expect(e).toEqual([{ start: 0, end: 2, insert: '😁' }]);
  });

  it('handles accents, combining marks and ideographs', () => {
    expect(checkEdits('São Paulo', 'São Bento')).toEqual([{ start: 4, end: 9, insert: 'Bento' }]);
    checkEdits('café au lait', 'café au lait');
    // Ideographs are tokens of their own: a one-character change stays one character.
    expect(checkEdits('我喜欢北京的天气', '我喜欢上海的天气')).toEqual([{ start: 3, end: 5, insert: '上海' }]);
  });

  it('keeps paragraph breaks as tokens of their own', () => {
    const edits = checkEdits('one\ntwo\nthree', 'one\nTWO\nthree');
    expect(edits).toEqual([{ start: 4, end: 7, insert: 'TWO' }]);
    checkEdits('a\n\nb', 'a\nb');
  });

  it('agrees with applyEdits on random texts', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const words = ['Ana', 'saw', 'the', 'river', ',', '.', ' ', '\n', 'çà', '😀', '北', 'ok'];
    const gen = (n: number) => Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join('');
    for (let i = 0; i < 300; i++) {
      const a = gen(Math.floor(rand() * 40));
      // Mutate a few positions of a so the texts share structure.
      let b = a;
      for (let k = 0; k < 3; k++) {
        const at = Math.floor(rand() * (b.length + 1));
        const safe = splitsPair(b, at) ? at - 1 : at;
        b = b.slice(0, safe) + gen(Math.floor(rand() * 3)) + b.slice(safe + Math.floor(rand() * 4));
        // A cut may strand half a pair; skip such samples (canonical text is well formed).
      }
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(b)) continue;
      checkEdits(a, b);
    }
  });

  it('handles a 1 MB transcript with scattered edits quickly', () => {
    const para = (i: number) => `Interviewer: How was week ${i}?\nRespondent: It was fine, Ana said the market in Braga was busy.\n`;
    const a = Array.from({ length: 12000 }, (_, i) => para(i)).join('');
    expect(a.length).toBeGreaterThan(1_000_000);
    const b = a.replace(/Ana/g, (m, off: number) => (off % 7 === 0 ? 'P1' : m)).replace('week 4500', 'week 4500 (approximately)');
    const t0 = performance.now();
    const edits = computeEdits(a, b);
    const ms = performance.now() - t0;
    expect(applyEdits(a, edits)).toBe(b);
    expect(ms).toBeLessThan(1000);
  });

  it('handles a single edit in a 1 MB text instantly', () => {
    const a = 'word '.repeat(220_000);
    const b = a.slice(0, 500_000) + 'NEW ' + a.slice(500_000);
    const t0 = performance.now();
    const edits = computeEdits(a, b);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(edits).toHaveLength(1);
    expect(applyEdits(a, edits)).toBe(b);
  });

  it('stays correct and bounded on two unrelated 1 MB texts', () => {
    let seed = 1;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const vocab = Array.from({ length: 5000 }, (_, i) => `w${i}`);
    const gen = (n: number) => Array.from({ length: n }, () => vocab[Math.floor(rand() * vocab.length)]).join(' ');
    const a = gen(170_000);
    const b = gen(170_000);
    const t0 = performance.now();
    const edits = computeEdits(a, b);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(applyEdits(a, edits)).toBe(b);
  });

  it('produces LF-only edits for LF-only texts', () => {
    const edits = checkEdits('line one\nline two\n', 'line one\nline 2\nline three\n');
    for (const e of edits) expect(e.insert.includes('\r')).toBe(false);
  });
});

describe('mapOffset', () => {
  const edits = normalizeEdits([
    { start: 2, end: 2, insert: 'XX' }, // insertion at 2
    { start: 5, end: 8, insert: 'Y' }, // replace 3 chars with 1
  ]);

  it('moves positions after edits by the length change', () => {
    expect(mapOffset(0, edits)).toBe(0);
    expect(mapOffset(3, edits)).toBe(5);
    expect(mapOffset(10, edits)).toBe(10); // +2 −2
  });

  it('honours assoc at insertions', () => {
    expect(mapOffset(2, edits, 'before')).toBe(2);
    expect(mapOffset(2, edits, 'after')).toBe(4);
  });

  it('maps positions inside replaced text to its start or end', () => {
    expect(mapOffset(5, edits)).toBe(7);
    expect(mapOffset(8, edits)).toBe(8);
    expect(mapOffset(6, edits, 'before')).toBe(7);
    expect(mapOffset(6, edits, 'after')).toBe(8);
  });

  it('is the identity with no edits', () => {
    expect(mapOffset(42, [])).toBe(42);
  });
});

describe('mapRange', () => {
  const text = 'I met Ana in Porto yesterday.';
  // "Ana" = [6, 9), "Porto" = [13, 18)

  it('keeps insertions at the edges outside the range', () => {
    const edits = computeEdits(text, 'I met dear Ana there in Porto yesterday.');
    const r = mapRange({ start: 6, end: 9 }, edits)!;
    expect('I met dear Ana there in Porto yesterday.'.slice(r.start, r.end)).toBe('Ana');
  });

  it('includes a replacement of the whole range', () => {
    const next = 'I met Anabela in Porto yesterday.';
    const r = mapRange({ start: 6, end: 9 }, computeEdits(text, next))!;
    expect(next.slice(r.start, r.end)).toBe('Anabela');
  });

  it('includes replacements inside the range and of a part of it', () => {
    const next = 'I met P1 in Braga yesterday.';
    const edits = computeEdits(text, next);
    const whole = mapRange({ start: 6, end: 18 }, edits)!;
    expect(next.slice(whole.start, whole.end)).toBe('P1 in Braga');
    // A range that starts inside replaced text takes the whole replacement.
    const partial = mapRange({ start: 7, end: 12 }, normalizeEdits([{ start: 6, end: 9, insert: 'P1' }]))!;
    expect(partial).toEqual({ start: 6, end: 11 });
  });

  it('shrinks when a deletion overlaps one end', () => {
    const edits = normalizeEdits([{ start: 3, end: 7, insert: '' }]);
    expect(mapRange({ start: 5, end: 10 }, edits)).toEqual({ start: 3, end: 6 });
    expect(mapRange({ start: 0, end: 5 }, edits)).toEqual({ start: 0, end: 3 });
  });

  it('collapses to null when everything in it is deleted', () => {
    expect(mapRange({ start: 5, end: 10 }, normalizeEdits([{ start: 0, end: 20, insert: '' }]))).toBeNull();
    expect(mapRange({ start: 5, end: 10 }, normalizeEdits([{ start: 5, end: 10, insert: '' }]))).toBeNull();
    expect(mapRange({ start: 5, end: 5 }, [])).toBeNull();
  });

  it('a deletion spanning several ranges shortens each', () => {
    const t = 'aaaa bbbb cccc dddd';
    const edits = computeEdits(t, 'aaaa dddd');
    const next = applyEdits(t, edits);
    const r1 = mapRange({ start: 0, end: 7 }, edits); // "aaaa bb"
    const r2 = mapRange({ start: 5, end: 14 }, edits); // "bbbb cccc"
    const r3 = mapRange({ start: 12, end: 19 }, edits); // "cc dddd"
    expect(next.slice(r1!.start, r1!.end)).toBe('aaaa ');
    expect(r2).toBeNull();
    expect(next.slice(r3!.start, r3!.end)).toBe('dddd');
  });

  it('a range spanning several edits follows all of them', () => {
    const t = 'Ana and Rui met Ana.';
    const { text: next, edits } = replaceAll(t, [
      { start: 0, end: 3, insert: 'P1' },
      { start: 8, end: 11, insert: 'P2' },
      { start: 16, end: 19, insert: 'P1' },
    ]);
    const r = mapRange({ start: 0, end: 20 }, edits)!;
    expect(next.slice(r.start, r.end)).toBe('P1 and P2 met P1.');
    const mid = mapRange({ start: 4, end: 15 }, edits)!;
    expect(next.slice(mid.start, mid.end)).toBe('and P2 met');
  });

  it('keeps surrogate pairs whole', () => {
    const t = 'a 😀 b 😀 c';
    const next = 'a 😀 bb 😀 c';
    const edits = computeEdits(t, next);
    const r = mapRange({ start: 2, end: 9 }, edits)!; // "😀 b 😀"
    expect(next.slice(r.start, r.end)).toBe('😀 bb 😀');
    expect(splitsPair(next, r.start) || splitsPair(next, r.end)).toBe(false);
  });
});

describe('replaceAll', () => {
  it('replaces non-overlapping matches, earliest then longest first', () => {
    const t = 'Ana Lima met Ana.';
    const r = replaceAll(t, [
      { start: 0, end: 3, insert: 'X' },
      { start: 0, end: 8, insert: 'P1' },
      { start: 13, end: 16, insert: 'P2' },
    ]);
    expect(r.text).toBe('P1 met P2.');
    expect(r.applied).toBe(2);
    expect(r.edits).toEqual([{ start: 0, end: 8, insert: 'P1' }, { start: 13, end: 16, insert: 'P2' }]);
  });

  it('handles no matches and empty text', () => {
    expect(replaceAll('', [])).toEqual({ text: '', edits: [], applied: 0 });
    expect(replaceAll('abc', [])).toEqual({ text: 'abc', edits: [], applied: 0 });
  });

  it('rejects matches that would split a surrogate pair', () => {
    expect(() => replaceAll('😀', [{ start: 1, end: 2, insert: 'x' }])).toThrow(RangeError);
  });

  it('skips identity replacements in the edit list', () => {
    const r = replaceAll('Rui', [{ start: 0, end: 3, insert: 'Rui' }]);
    expect(r.edits).toEqual([]);
    expect(r.text).toBe('Rui');
  });
});

describe('units of text', () => {
  it('splits paragraphs at line breaks, skipping empty ones', () => {
    expect(paragraphSpans('')).toEqual([]);
    expect(paragraphSpans('a\n\nbc\n')).toEqual([{ start: 0, end: 1 }, { start: 3, end: 5 }]);
  });

  it('splits sentences within paragraphs', () => {
    const t = 'First one. Second one?! "Third," she said. Last\nNew para… ok';
    const s = sentenceSpans(t).map((x) => t.slice(x.start, x.end));
    expect(s).toEqual(['First one.', 'Second one?!', '"Third," she said.', 'Last', 'New para…', 'ok']);
    expect(sentenceSpans('Olá. ¿Qué tal? Bem!').map((x) => 'Olá. ¿Qué tal? Bem!'.slice(x.start, x.end))).toEqual(['Olá.', '¿Qué tal?', 'Bem!']);
    expect(sentenceSpans('今天很好。明天呢？').length).toBe(2);
  });

  it('trims whitespace without splitting pairs', () => {
    expect(trimSpan('  ab  ', { start: 0, end: 6 })).toEqual({ start: 2, end: 4 });
    expect(trimSpan('   ', { start: 0, end: 3 })).toBeNull();
    expect(trimSpan('x😀y', { start: 2, end: 3 })).toEqual({ start: 1, end: 3 });
    expect(trimSpan('x😀y', { start: 1, end: 2 })).toEqual({ start: 1, end: 3 });
  });

  it('expands spans to whole units', () => {
    const t = 'One two. Three four. Five.';
    const units = sentenceSpans(t);
    const r = expandToUnits({ start: 4, end: 5 }, units);
    expect(t.slice(r.start, r.end)).toBe('One two.');
    const r2 = expandToUnits({ start: 5, end: 12 }, units);
    expect(t.slice(r2.start, r2.end)).toBe('One two. Three four.');
    expect(expandToUnits({ start: 0, end: 2 }, [])).toEqual({ start: 0, end: 2 });
  });
});
