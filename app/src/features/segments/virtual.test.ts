import { describe, expect, it } from 'vitest';
import { firstVisible, offsetsOf } from './virtual';

describe('virtual list layout', () => {
  it('offsets with gap and padding', () => {
    const h: Record<string, number> = { a: 10, b: 20, c: 30 };
    expect([...offsetsOf(['a', 'b', 'c'], (k) => h[k]!, 4, 8)]).toEqual([8, 22, 46, 84]);
    expect([...offsetsOf([], () => 1, 4, 8)]).toEqual([16]);
  });

  it('finds the item at a position', () => {
    const o = offsetsOf(['a', 'b', 'c'], () => 10, 0, 0); // 0, 10, 20, 30
    expect(firstVisible(o, -5, 3)).toBe(0);
    expect(firstVisible(o, 0, 3)).toBe(0);
    expect(firstVisible(o, 9.9, 3)).toBe(0);
    expect(firstVisible(o, 10, 3)).toBe(1);
    expect(firstVisible(o, 25, 3)).toBe(2);
    expect(firstVisible(o, 1000, 3)).toBe(2);
    expect(firstVisible(o, 5, 0)).toBe(0);
  });
});
