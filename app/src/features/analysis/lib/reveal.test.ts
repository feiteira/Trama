import { describe, expect, it } from 'vitest';
import { revealScroll } from './reveal';

describe('revealScroll', () => {
  const view = { left: 0, top: 0, width: 466, height: 400 };
  it('scrolls right just enough to show a cell past the right edge (End in a wide co-occurrence matrix)', () => {
    // 18 codes, 26 px cells after 200 px of row labels: the last column ends at 668.
    const box = { x: 200 + 17 * 26, y: 100, w: 26, h: 26 };
    expect(revealScroll(view, box, { x: 200 })).toEqual({ left: 668 - 466, top: 0 });
  });
  it('scrolls back left keeping the row label in sight when it fits, and never below 0', () => {
    const at = { ...view, left: 300 };
    expect(revealScroll(at, { x: 226, y: 0, w: 26, h: 26 }, { x: 200 })).toEqual({ left: 26, top: 0 });
    expect(revealScroll(at, { x: 200, y: 0, w: 26, h: 26 }, { x: 200 })).toEqual({ left: 0, top: 0 });
  });
  it('leaves a visible cell where it is', () => {
    expect(revealScroll({ ...view, left: 50 }, { x: 300, y: 10, w: 26, h: 26 }, { x: 200 })).toEqual({ left: 50, top: 0 });
  });
  it('scrolls down to a row below the view', () => {
    expect(revealScroll(view, { x: 0, y: 420, w: 26, h: 26 })).toEqual({ left: 0, top: 46 });
  });
});
