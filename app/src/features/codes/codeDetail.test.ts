import { describe, expect, it } from 'vitest';
import { perCoder, perDocument, segmentContext } from './codeDetail';

describe('segmentContext', () => {
  const text = 'First paragraph here.\nWe grow beans and share them with the neighbours every summer.\nLast one.';
  const start = text.indexOf('share');
  const end = start + 'share them'.length;

  it('keeps to the paragraph', () => {
    const c = segmentContext(text, start, end, 200);
    expect(c.before).toBe('We grow beans and ');
    expect(c.text).toBe('share them');
    expect(c.after).toBe(' with the neighbours every summer.');
    expect(c.clippedStart).toBe(false);
    expect(c.clippedEnd).toBe(false);
  });

  it('cuts at a word when the paragraph is longer than the radius', () => {
    const c = segmentContext(text, start, end, 8);
    expect(c.before).toBe('and ');
    expect(c.after).toBe(' with');
    expect(c.clippedStart).toBe(true);
    expect(c.clippedEnd).toBe(true);
  });

  it('shortens a very long segment', () => {
    const long = 'word '.repeat(300);
    const c = segmentContext(long, 0, long.length, 50, 40);
    expect(c.text.length).toBeLessThanOrEqual(40);
    expect(c.after).toBe('');
    expect(c.clippedEnd).toBe(true);
  });
});

describe('spread', () => {
  it('counts per document in list order and per coder', () => {
    const codings = [
      { document_id: 'd2', coder_id: 'a' },
      { document_id: 'd1', coder_id: 'b' },
      { document_id: 'd2', coder_id: 'b' },
    ];
    expect(perDocument(codings, [{ id: 'd1', name: 'One' }, { id: 'd2', name: 'Two' }, { id: 'd3', name: 'Three' }])).toEqual([
      { id: 'd1', name: 'One', count: 1 },
      { id: 'd2', name: 'Two', count: 2 },
    ]);
    expect(perCoder(codings, [{ id: 'a', name: 'Ana', color: '#000000' }, { id: 'b', name: 'Bruno', color: '#ffffff' }]).map((c) => [c.name, c.count])).toEqual([
      ['Bruno', 2],
      ['Ana', 1],
    ]);
  });
});
