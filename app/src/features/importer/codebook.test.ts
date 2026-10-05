import { describe, expect, it } from 'vitest';
import { exportQdc, importQdc } from '../../core/export/refi';
import type { Code } from '../../core/model/types';
import { freshCount, planQdc } from './codebook';

const code = (id: string, name: string, parent_id: string | null = null, codable = true): Code => ({
  id, name, parent_id, codable, color: '#e4572e', description: '', inclusion: '', exclusion: '', example: '', order: 1, shortcut: null,
  created_at: '', updated_at_hlc: '', deleted: false,
});

describe('planQdc', () => {
  it('keeps codes already at the same place and puts new children under them', () => {
    const file = [code('a', 'Belonging', null, false), code('b', 'Newcomers', 'a'), code('c', 'Trust', 'a'), code('d', 'Wellbeing'), code('e', 'Stress', 'd')];
    const imported = importQdc(exportQdc(file, { origin: 'Trama test' }));
    const existing = [code('x', 'belonging', null, false), code('y', 'Newcomers', 'x'), code('z', 'Stress')];
    const plan = planQdc(imported, existing);
    expect(plan.map((p) => [p.name, p.depth, p.existingId])).toEqual([
      ['Belonging', 0, 'x'],
      ['Newcomers', 1, 'y'],
      ['Trust', 1, null],
      ['Wellbeing', 0, null],
      // "Stress" exists at the top, not under Wellbeing (which is new): created.
      ['Stress', 1, null],
    ]);
    expect(freshCount(plan)).toBe(3);
  });

  it('ignores deleted codes', () => {
    const imported = importQdc(exportQdc([code('a', 'Trust')], { origin: 'x' }));
    expect(planQdc(imported, [{ ...code('t', 'Trust'), deleted: true }])[0]!.existingId).toBeNull();
  });
});
