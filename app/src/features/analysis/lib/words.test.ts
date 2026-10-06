import { describe, expect, it } from 'vitest';
import { compareFrequencies } from '../../../core/qda/wordfreq';
import { compareCorpora, keynessRows } from './words';

const docs = [
  { id: 'shared', group_ids: ['women', 'over60'] },
  { id: 'w', group_ids: ['women'] },
  { id: 'o', group_ids: ['over60'] },
  { id: 'x', group_ids: [] },
];

describe('compareCorpora', () => {
  it('leaves a document in both groups out of both sides', () => {
    const r = compareCorpora(docs, 'women', 'over60');
    expect(r.a.map((d) => d.id)).toEqual(['w']);
    expect(r.b.map((d) => d.id)).toEqual(['o']);
    expect(r.shared).toBe(1);
  });

  it('against the rest of the documents, the sides are disjoint already', () => {
    const r = compareCorpora(docs, 'women', '');
    expect(r.a.map((d) => d.id)).toEqual(['shared', 'w']);
    expect(r.b.map((d) => d.id)).toEqual(['o', 'x']);
    expect(r.shared).toBe(0);
  });
});

describe('keynessRows', () => {
  it('writes numbers as numbers', () => {
    const c = compareFrequencies([{ id: 'a', text: 'tomato tomato tomato tomato garden' }], [{ id: 'b', text: 'beans beans beans beans garden' }], { minCount: 1 });
    const rows = keynessRows(c.rows, ['w', 'A', 'B', 'a', 'b', 'll', 'p', 'lr', 'more'], 'A', 'B');
    const tomato = rows.find((r) => r[0] === 'tomato')!;
    for (const v of tomato.slice(1, 7)) expect(typeof v).toBe('number');
    expect(tomato[8]).toBe('A');
  });
});
