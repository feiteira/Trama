import { describe, expect, it } from 'vitest';
import { buildViews, type ViewCache } from './DocText';
import { markStyles } from './model/highlight';
import { splitParagraphs } from './model/paragraphs';
import { marksByParagraph } from './model/runs';

// The viewer re-renders a paragraph only when its view object changes: buildViews must reuse
// the previous object for every paragraph whose runs and paint are the same.

const text = 'Ana: One two three.\nRui: Four five six.\n\nAna: Seven.';
const paras = splitParagraphs(text, { transcript: true });

function views(codings: { id: string; code_id: string; start: number; end: number }[], cache: ViewCache, dark = false) {
  const styles = markStyles(codings, () => '#3a6ea5', { activeCodeIds: null, activeOnly: false });
  return buildViews(text, paras, marksByParagraph(paras, codings), [], styles, dark, cache);
}

describe('buildViews', () => {
  it('cuts transcript turns into label and text runs that cover the text exactly', () => {
    const v = views([], { text: '', byIndex: new Map() });
    expect(v).toHaveLength(4);
    expect(v[0]!.runs.map((r) => [r.text, r.label])).toEqual([
      ['Ana:', true],
      [' One two three.', false],
    ]);
    expect(v[2]!.para.blank).toBe(true);
    expect(v[2]!.runs).toEqual([]);
    for (const p of v) expect(p.runs.map((r) => r.text).join('')).toBe(text.slice(p.para.start, p.para.end));
  });

  it('reuses unchanged paragraphs and rebuilds only the one a new coding touches', () => {
    const cache: ViewCache = { text: '', byIndex: new Map() };
    const a = views([{ id: 'c1', code_id: 'k', start: 5, end: 8 }], cache);
    const b = views([{ id: 'c1', code_id: 'k', start: 5, end: 8 }], cache);
    expect(b.every((v, i) => v === a[i])).toBe(true);
    const c = views(
      [
        { id: 'c1', code_id: 'k', start: 5, end: 8 },
        { id: 'c2', code_id: 'k', start: 25, end: 29 },
      ],
      cache,
    );
    expect(c[0]).toBe(a[0]);
    expect(c[1]).not.toBe(a[1]);
    expect(c[1]!.runs.find((r) => r.ids === 'c2')?.text).toBe('Four');
    expect(c[3]).toBe(a[3]);
  });

  it('starts afresh when the text changes or the theme repaints the highlights', () => {
    const cache: ViewCache = { text: '', byIndex: new Map() };
    const a = views([{ id: 'c1', code_id: 'k', start: 5, end: 8 }], cache);
    const d = views([{ id: 'c1', code_id: 'k', start: 5, end: 8 }], cache, true);
    expect(d[0]).not.toBe(a[0]);
    expect(d[1]).toBe(a[1]); // uncoded: nothing to repaint
  });
});
