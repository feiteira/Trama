import { describe, expect, it } from 'vitest';
import { MIN_PASSPHRASE, passphraseProblem, pickCheckPositions, strength, wordMatches } from './passphrase';

describe('strength', () => {
  it('is weak below the minimum, whatever the variety', () => {
    expect(strength('')).toBe(0);
    expect(strength('Ab1!Ab1!a')).toBe(0);
    expect(MIN_PASSPHRASE).toBe(10);
  });

  it('counts characters, not UTF-16 units', () => {
    // 9 emoji are 18 UTF-16 units but 9 characters: still too short.
    expect(strength('🌱🌱🌱🌱🌱🌱🌱🌱🌱')).toBe(0);
    expect(strength('maçã pão açúcar')).toBeGreaterThan(0);
  });

  it('rates a long run of one character as weak, not strong', () => {
    expect(strength('a'.repeat(60))).toBe(1);
    expect(strength('ab'.repeat(30))).toBe(1);
  });

  it('rewards length and several words', () => {
    expect(strength('abcdefghij')).toBe(1);
    expect(strength('Abcdefghij12')).toBe(1);
    expect(strength('Abcdefghij12!x')).toBe(2);
    expect(strength('purple tractor sings loudly')).toBe(3);
    expect(strength('Correct horse battery staple 42!')).toBe(3);
  });

  it('copes with a huge input', () => {
    expect(strength('x y z '.repeat(100_000))).toBe(3);
  });
});

describe('passphraseProblem', () => {
  it('checks length first, then that both match', () => {
    expect(passphraseProblem('short', 'short')).toBe('tooShort');
    expect(passphraseProblem('long enough pass', 'long enough pas')).toBe('mismatch');
    expect(passphraseProblem('long enough pass', 'long enough pass')).toBeNull();
  });

  it('treats composed and decomposed accents as the same passphrase', () => {
    expect(passphraseProblem('café com leite', 'café com leite')).toBeNull();
  });
});

describe('pickCheckPositions', () => {
  it('picks three distinct positions from 1 to 12, ascending', () => {
    for (let i = 0; i < 200; i++) {
      const p = pickCheckPositions();
      expect(p).toHaveLength(3);
      expect(new Set(p).size).toBe(3);
      expect([...p].sort((a, b) => a - b)).toEqual(p);
      for (const n of p) expect(n >= 1 && n <= 12).toBe(true);
    }
  });

  it('survives a random source at its edges', () => {
    expect(pickCheckPositions(() => 0)).toEqual([1, 2, 3]);
    expect(pickCheckPositions(() => 1)).toEqual([10, 11, 12]);
    expect(pickCheckPositions(() => 0.9999999)).toEqual([10, 11, 12]);
  });

  it('never asks for more words than there are', () => {
    expect(pickCheckPositions(Math.random, 2, 3)).toEqual([1, 2]);
  });
});

describe('wordMatches', () => {
  it('ignores case and spaces', () => {
    expect(wordMatches('  Abandon ', 'abandon')).toBe(true);
    expect(wordMatches('abandon', 'ability')).toBe(false);
    expect(wordMatches('', '')).toBe(false);
  });
});
