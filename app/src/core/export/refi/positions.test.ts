import { describe, expect, it } from 'vitest';
import {
  candidateModes,
  canonicalize,
  chooseMode,
  codePointLength,
  codePointMap,
  nameAgrees,
  OffsetMap,
  rawToLf,
  sampleProbes,
  scoreModes,
  SPEC_MODE,
  stripBom,
  toNfc,
} from './positions';

describe('codePointMap', () => {
  it('is the identity for BMP-only text', () => {
    const m = codePointMap('Olá, ação — 東京');
    expect(m.isIdentity).toBe(true);
    expect(m.forward(5)).toBe(5);
    expect(m.backward(5)).toBe(5);
  });

  it('counts astral characters as one code point', () => {
    const text = 'a😀b𝄞c';
    const m = codePointMap(text);
    expect(m.toLength).toBe(Array.from(text).length);
    for (let u = 0, cp = 0; u <= text.length; ) {
      expect(m.forward(u)).toBe(cp);
      expect(m.backward(cp)).toBe(u);
      const c = text.codePointAt(u);
      u += c !== undefined && c > 0xffff ? 2 : 1;
      cp++;
    }
  });

  it('rounds positions inside a surrogate pair outward', () => {
    const m = codePointMap('a😀b');
    expect(m.forward(2, 'start')).toBe(1);
    expect(m.forward(2, 'end')).toBe(2);
  });

  it('clamps out-of-range positions', () => {
    const m = codePointMap('😀😀');
    expect(m.forward(-3)).toBe(0);
    expect(m.forward(99)).toBe(2);
    expect(m.backward(99)).toBe(4);
  });

  it('handles empty text and lone surrogates', () => {
    expect(codePointMap('').forward(0)).toBe(0);
    const lone = 'a\uD800b\uDC00c';
    expect(codePointMap(lone).isIdentity).toBe(true);
    expect(codePointLength(lone)).toBe(5);
  });

  it('agrees with Array.from on a large mixed text', () => {
    const unit = 'Entrevista 😀 com a Ana — ação 𝄞 e mais texto.\n';
    const text = unit.repeat(20_000);
    const m = codePointMap(text);
    expect(m.toLength).toBe(Array.from(text).length);
    const u = text.length - unit.length + 14; // just after the last emoji
    expect(m.forward(u)).toBe(Array.from(text.slice(0, u)).length);
    expect(m.backward(m.forward(u))).toBe(u);
  });
});

describe('rawToLf', () => {
  const raw = 'Line one\r\nLine two 😀\r\nThird';

  it('maps CRLF counted as two (the spec, NVivo)', () => {
    const { text, map } = rawToLf(raw, { unit: 'codepoint', crlf: 2 });
    expect(text).toBe('Line one\nLine two 😀\nThird');
    // "Third" starts at code point 8+2+10+2 = 22 in the raw file
    expect(text.slice(map.forward(22), map.forward(27, 'end'))).toBe('Third');
  });

  it('maps CRLF counted as one (ATLAS.ti)', () => {
    const { text, map } = rawToLf(raw, { unit: 'codepoint', crlf: 1 });
    expect(text.slice(map.forward(20), map.forward(25, 'end'))).toBe('Third');
  });

  it('maps UTF-16 counting', () => {
    const { text, map } = rawToLf(raw, { unit: 'utf16', crlf: 2 });
    expect(text.slice(map.forward(23), map.forward(28, 'end'))).toBe('Third');
  });

  it('turns lone CR into LF one for one', () => {
    const { text, map } = rawToLf('a\rb\r\rc', SPEC_MODE);
    expect(text).toBe('a\nb\n\nc');
    expect(map.forward(5)).toBe(5);
  });

  it('a position between CR and LF rounds to the line break', () => {
    const { map } = rawToLf('ab\r\ncd', SPEC_MODE);
    expect(map.forward(3, 'start')).toBe(2);
    expect(map.forward(3, 'end')).toBe(3);
  });
});

describe('toNfc', () => {
  it('leaves NFC text alone', () => {
    const r = toNfc('ação');
    expect(r.text).toBe('ação');
    expect(r.map.isIdentity).toBe(true);
  });

  it('composes and maps positions after composed characters', () => {
    const decomposed = 'São João'; // "São João" decomposed
    const r = toNfc(decomposed);
    expect(r.text).toBe('São João');
    expect(r.map.forward(decomposed.indexOf('J'))).toBe(4);
    expect(r.map.forward(decomposed.length)).toBe(8);
    // inside a cluster: start rounds down, end rounds up
    expect(r.map.forward(2, 'start')).toBe(1);
    expect(r.map.forward(2, 'end')).toBe(2);
  });

  it('composes Hangul jamo', () => {
    const r = toNfc('각!');
    expect(r.text).toBe('각!');
    expect(r.map.forward(3)).toBe(1);
  });

  it('works across chunk boundaries on large text', () => {
    const decomposed = ('x'.repeat(70_000) + 'é').repeat(3);
    const r = toNfc(decomposed);
    expect(r.text).toBe(decomposed.normalize('NFC'));
    expect(r.map.forward(decomposed.length)).toBe(r.text.length);
    expect(r.map.forward(70_002)).toBe(70_001);
  });
});

describe('canonicalize', () => {
  it('strips a BOM without counting it, normalises line ends and NFC', () => {
    const c = canonicalize('﻿Café\r\nfim', { unit: 'codepoint', crlf: 2 });
    expect(c.text).toBe('Café\nfim');
    expect(c.maxPosition).toBe(10);
    expect(c.text.slice(c.toCanonical(7, 'start'), c.toCanonical(10, 'end'))).toBe('fim');
  });

  it('stripBom only removes a leading BOM', () => {
    expect(stripBom('a﻿')).toBe('a﻿');
    expect(stripBom('﻿')).toBe('');
  });
});

describe('mode detection', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `Speaker ${i}: I said something ${"😀".repeat(i % 3)} number ${i} today.`);
  const raw = lines.join('\r\n');

  function probes(mode: { unit: 'codepoint' | 'utf16'; crlf: 1 | 2 }) {
    // positions as a producer using `mode` would write them
    return lines.map((line, i) => {
      const before = lines.slice(0, i).join('\n') + (i ? '\n' : '');
      const count = (s: string) => (mode.unit === 'codepoint' ? Array.from(s).length : s.length);
      const start = count(before) + (mode.crlf === 2 ? i : 0);
      return { start, end: start + count(line), name: line.slice(0, 20) };
    });
  }

  it('offers only the modes that differ', () => {
    expect(candidateModes('plain')).toHaveLength(1);
    expect(candidateModes('a\r\nb')).toHaveLength(2);
    expect(candidateModes('a😀\r\nb')).toHaveLength(4);
  });

  for (const mode of [
    { unit: 'codepoint', crlf: 2 },
    { unit: 'codepoint', crlf: 1 },
    { unit: 'utf16', crlf: 2 },
    { unit: 'utf16', crlf: 1 },
  ] as const) {
    it(`recognises ${mode.unit} with CRLF=${mode.crlf}`, () => {
      const scores = scoreModes(raw, probes(mode));
      // a wrong prior does not matter when there is evidence
      const chosen = chooseMode(raw, scores, { unit: mode.unit === 'utf16' ? 'codepoint' : 'utf16', crlf: mode.crlf === 1 ? 2 : 1 });
      expect(chosen).toEqual(mode);
    });
  }

  it('falls back to the prior without evidence', () => {
    const scores = scoreModes(raw, []);
    expect(chooseMode(raw, scores, { unit: 'codepoint', crlf: 1 })).toEqual({ unit: 'codepoint', crlf: 1 });
    expect(chooseMode(raw, scores, { unit: 'codepoint', crlf: 2 })).toEqual({ unit: 'codepoint', crlf: 2 });
  });

  it('nameAgrees ignores whitespace, ellipses and labels', () => {
    expect(nameAgrees('Oh, that was\ngreat. See you', 'Oh, that was great…')).toBe(true);
    expect(nameAgrees('Oh, that was great', 'Oh, that was great. See you tomorrow')).toBe(false);
    expect(nameAgrees('\nOh, that was great', 'Oh, that was great')).toBe(false);
    expect(nameAgrees('something else', 'Oh, that')).toBe(false);
    expect(nameAgrees('anything', '')).toBeNull();
    expect(nameAgrees('anything', '6:1')).toBe(false);
    expect(nameAgrees('anything', 'ab')).toBeNull();
  });

  it('samples evenly and keeps the last probe', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ start: i, end: i + 1, name: `name ${i}` }));
    const s = sampleProbes(many);
    expect(s).toHaveLength(64);
    expect(s[0]!.start).toBe(0);
    expect(s[63]!.start).toBe(999);
  });

  it('OffsetMap.identity maps every position to itself', () => {
    const m = OffsetMap.identity(10);
    expect(m.forward(7, 'end')).toBe(7);
    expect(m.backward(11)).toBe(10);
  });
});
