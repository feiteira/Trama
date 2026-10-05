import { describe, expect, it } from 'vitest';
import { visibleRows, type ChecklistItem } from './checklistModel';

const items: ChecklistItem[] = [
  { id: 'w', label: 'Wellbeing', depth: 0 },
  { id: 'calm', label: 'Calm', depth: 1 },
  { id: 'stress', label: 'Stress relief', depth: 2 },
  { id: 'phys', label: 'Physical health', depth: 1 },
  { id: 'b', label: 'Belonging', depth: 0 },
  { id: 'coração', label: 'Coração', depth: 1 },
];

describe('visibleRows', () => {
  it('all rows in order with parents and descendants', () => {
    const rows = visibleRows(items, '', new Set());
    expect(rows.map((r) => r.item.id)).toEqual(['w', 'calm', 'stress', 'phys', 'b', 'coração']);
    expect(rows.map((r) => r.parentIndex)).toEqual([-1, 0, 1, 0, -1, 4]);
    expect(rows[0]!.descendantIds).toEqual(['calm', 'stress', 'phys']);
    expect(rows[2]!.hasChildren).toBe(false);
  });

  it('hides collapsed branches', () => {
    const rows = visibleRows(items, '', new Set(['w']));
    expect(rows.map((r) => r.item.id)).toEqual(['w', 'b', 'coração']);
    expect(rows[0]!.collapsed).toBe(true);
  });

  it('search shows matches with dimmed ancestors, ignoring collapse and accents', () => {
    const rows = visibleRows(items, 'stress', new Set(['w']));
    expect(rows.map((r) => [r.item.id, r.dim])).toEqual([['w', true], ['calm', true], ['stress', false]]);
    expect(visibleRows(items, 'coracao', new Set()).map((r) => r.item.id)).toEqual(['b', 'coração']);
  });

  it('flat lists work without depth', () => {
    const rows = visibleRows([{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }], '', new Set());
    expect(rows.map((r) => r.parentIndex)).toEqual([-1, -1]);
  });
});
