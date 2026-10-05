import { describe, expect, it } from 'vitest';
import { compareHlc, formatHlc, Hlc, parseHlc } from './hlc';

describe('Hlc', () => {
  it('is strictly increasing even when the wall clock stalls or goes back', () => {
    let t = 1000;
    const c = new Hlc('dev1', () => t);
    const a = c.tick();
    const b = c.tick();
    t = 500;
    const d = c.tick();
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, d)).toBe(-1);
  });

  it('moves past stamps it observes from elsewhere', () => {
    const c = new Hlc('aaaa', () => 1000);
    const remote = formatHlc({ ms: 5000, counter: 7, device: 'bbbb' });
    c.observe(remote);
    const next = c.tick();
    expect(compareHlc(next, remote)).toBe(1);
    expect(parseHlc(next).device).toBe('aaaa');
  });

  it('orders by string comparison', () => {
    const early = formatHlc({ ms: 9, counter: 35, device: 'z' });
    const late = formatHlc({ ms: 10, counter: 0, device: 'a' });
    expect(early < late).toBe(true);
  });
});
