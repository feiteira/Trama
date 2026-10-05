import { describe, expect, it } from 'vitest';
import { docTextInfo, documentCount, matchSpans, oneLine, paragraphNumber, shownText, splitBySpans } from './view';

const text = 'First paragraph here.\n\nSecond one. It has two sentences.\n   \nThird.';

describe('paragraphNumber', () => {
  it('counts non-blank lines from 1', () => {
    const info = docTextInfo(text);
    expect(paragraphNumber(info, 0)).toBe(1);
    expect(paragraphNumber(info, text.indexOf('Second'))).toBe(2);
    expect(paragraphNumber(info, text.indexOf('It has'))).toBe(2);
    expect(paragraphNumber(info, text.indexOf('Third'))).toBe(3);
    expect(paragraphNumber(info, text.length)).toBe(3);
    expect(paragraphNumber(info, 9999)).toBe(3);
  });

  it('a leading blank line belongs to paragraph 1', () => {
    const info = docTextInfo('\nA\nB');
    expect(paragraphNumber(info, 0)).toBe(1);
    expect(paragraphNumber(info, 1)).toBe(1);
    expect(paragraphNumber(info, 3)).toBe(2);
  });
});

describe('shownText', () => {
  const start = text.indexOf('two');
  const coding = { start, end: start + 3, text: 'two' };

  it('none, or no text yet: the coded text only', () => {
    expect(shownText(coding, 'none', text)).toEqual({ before: '', coded: 'two', after: '', cutBefore: false, cutAfter: false });
    expect(shownText(coding, 'paragraph', null).coded).toBe('two');
  });

  it('sentence', () => {
    const s = shownText(coding, 'sentence', text);
    expect(s.before + s.coded + s.after).toBe('It has two sentences.');
    expect(s.coded).toBe('two');
  });

  it('paragraph', () => {
    const s = shownText(coding, 'paragraph', text);
    expect(s.before + s.coded + s.after).toBe('Second one. It has two sentences.');
  });

  it('cuts long context at a word, marking the cut', () => {
    const long = `${'word '.repeat(200)}KEY${' more'.repeat(200)}`;
    const k = long.indexOf('KEY');
    const s = shownText({ start: k, end: k + 3, text: 'KEY' }, 'paragraph', long, 50);
    expect(s.cutBefore && s.cutAfter).toBe(true);
    expect(s.before.length).toBeLessThanOrEqual(50);
    expect(s.after.length).toBeLessThanOrEqual(50);
    expect(s.before.startsWith('word')).toBe(true);
    expect(s.after.endsWith('more')).toBe(true);
  });

  it('clamps offsets beyond the text', () => {
    const s = shownText({ start: 5, end: 500, text: 'x' }, 'sentence', 'Hello there.');
    expect(s.coded).toBe(' there.');
  });
});

describe('small helpers', () => {
  it('documentCount and oneLine', () => {
    expect(documentCount([{ document_id: 'a' }, { document_id: 'b' }, { document_id: 'a' }])).toBe(2);
    expect(oneLine(' a\n\n b\tc ')).toBe('a b c');
  });
});

describe('text matches', () => {
  it('finds every word, ignoring case and accents, merged', () => {
    const text = 'O Coração da horta, a HORTA do coracao';
    expect(matchSpans(text, 'coracao horta')).toEqual([
      { start: 2, end: 9 },
      { start: 13, end: 18 },
      { start: 22, end: 27 },
      { start: 31, end: 38 },
    ]);
    expect(matchSpans(text, '  ')).toEqual([]);
    expect(matchSpans('aaaa', 'aa')).toEqual([{ start: 0, end: 4 }]);
  });

  it('splits text into plain and matched pieces', () => {
    expect(splitBySpans('abcdef', [{ start: 1, end: 3 }, { start: 5, end: 9 }])).toEqual([
      { text: 'a', hit: false },
      { text: 'bc', hit: true },
      { text: 'de', hit: false },
      { text: 'f', hit: true },
    ]);
    expect(splitBySpans('abc', [])).toEqual([{ text: 'abc', hit: false }]);
  });
});
