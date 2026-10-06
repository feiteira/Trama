import { describe, expect, it } from 'vitest';
import { coding, doc } from '../../../core/qda/fixtures';
import { codeDocumentMatrix } from '../../../core/qda/matrix';
import { presenceTotals } from './matrixTotals';

describe('presenceTotals', () => {
  it('counts documents in every total, like the cells', () => {
    const docs = [doc('d1', 100, { group_ids: ['g'] }), doc('d2', 100, { group_ids: ['g'] }), doc('d3', 100, { group_ids: ['g'] })];
    const codings = [coding('d1', 'X', 0, 5), coding('d2', 'X', 0, 5), coding('d3', 'X', 0, 5), coding('d1', 'Y', 0, 5), coding('d2', 'Y', 0, 5)];
    const raw = codeDocumentMatrix(codings, ['X', 'Y'], docs, { measure: 'presence', groupBy: { by: 'group', groups: [{ id: 'g', name: 'G', color: '#000', order: 0, created_at: '', updated_at_hlc: '0', deleted: false }] } });
    expect(raw.cells).toEqual([[3], [2]]);
    const m = presenceTotals(raw, codings);
    expect(m.rowTotals).toEqual([3, 2]);
    expect(m.colTotals).toEqual([3]);
    expect(m.grandTotal).toBe(3);
  });

  it('leaves the other measures alone', () => {
    const raw = codeDocumentMatrix([coding('d1', 'X', 0, 5)], ['X'], [doc('d1', 10)], { measure: 'segments' });
    expect(presenceTotals(raw, [])).toBe(raw);
  });
});
