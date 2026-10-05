import { describe, expect, it } from 'vitest';
import { clampPos, moveCell, rowRange, startsTyping } from './grid';

const size = { rows: 3, cols: 4 };

describe('moveCell', () => {
  it('moves one step with the arrows and stops at the edges', () => {
    expect(moveCell({ row: 1, col: 1 }, 'ArrowUp', size)).toEqual({ row: 0, col: 1 });
    expect(moveCell({ row: 0, col: 1 }, 'ArrowUp', size)).toEqual({ row: 0, col: 1 });
    expect(moveCell({ row: 2, col: 1 }, 'ArrowDown', size)).toEqual({ row: 2, col: 1 });
    expect(moveCell({ row: 1, col: 0 }, 'ArrowLeft', size)).toEqual({ row: 1, col: 0 });
    expect(moveCell({ row: 1, col: 3 }, 'ArrowRight', size)).toEqual({ row: 1, col: 3 });
    expect(moveCell({ row: 1, col: 1 }, 'ArrowRight', size)).toEqual({ row: 1, col: 2 });
  });

  it('jumps to the edges with Ctrl, Home and End', () => {
    expect(moveCell({ row: 1, col: 1 }, 'ArrowDown', size, { ctrl: true })).toEqual({ row: 2, col: 1 });
    expect(moveCell({ row: 1, col: 1 }, 'ArrowLeft', size, { ctrl: true })).toEqual({ row: 1, col: 0 });
    expect(moveCell({ row: 1, col: 1 }, 'Home', size)).toEqual({ row: 1, col: 0 });
    expect(moveCell({ row: 1, col: 1 }, 'End', size)).toEqual({ row: 1, col: 3 });
    expect(moveCell({ row: 1, col: 1 }, 'Home', size, { ctrl: true })).toEqual({ row: 0, col: 0 });
    expect(moveCell({ row: 1, col: 1 }, 'End', size, { ctrl: true })).toEqual({ row: 2, col: 3 });
  });

  it('pages up and down', () => {
    const big = { rows: 50, cols: 2 };
    expect(moveCell({ row: 5, col: 0 }, 'PageDown', big, {}, 10)).toEqual({ row: 15, col: 0 });
    expect(moveCell({ row: 45, col: 0 }, 'PageDown', big, {}, 10)).toEqual({ row: 49, col: 0 });
    expect(moveCell({ row: 5, col: 1 }, 'PageUp', big, {}, 10)).toEqual({ row: 0, col: 1 });
  });

  it('wraps Tab across rows and leaves the grid at either end', () => {
    expect(moveCell({ row: 0, col: 3 }, 'Tab', size)).toEqual({ row: 1, col: 0 });
    expect(moveCell({ row: 1, col: 0 }, 'Tab', size, { shift: true })).toEqual({ row: 0, col: 3 });
    expect(moveCell({ row: 2, col: 3 }, 'Tab', size)).toBeNull();
    expect(moveCell({ row: 0, col: 0 }, 'Tab', size, { shift: true })).toBeNull();
  });

  it('clamps a position left outside a grid that shrank', () => {
    expect(moveCell({ row: 9, col: 9 }, 'ArrowUp', size)).toEqual({ row: 1, col: 3 });
    expect(clampPos({ row: 9, col: -1 }, size)).toEqual({ row: 2, col: 0 });
    expect(clampPos({ row: 3, col: 3 }, { rows: 0, cols: 4 })).toEqual({ row: 0, col: 0 });
    expect(moveCell({ row: 0, col: 0 }, 'ArrowDown', { rows: 0, cols: 4 })).toBeNull();
  });
});

describe('startsTyping', () => {
  it('starts on printable characters only', () => {
    expect(startsTyping('a', {})).toBe(true);
    expect(startsTyping('7', {})).toBe(true);
    expect(startsTyping(' ', {})).toBe(false);
    expect(startsTyping('a', { ctrl: true })).toBe(false);
    expect(startsTyping('Enter', {})).toBe(false);
  });
});

describe('rowRange', () => {
  it('spans both directions', () => {
    expect(rowRange(2, 4)).toEqual([2, 3, 4]);
    expect(rowRange(4, 2)).toEqual([2, 3, 4]);
  });
});
