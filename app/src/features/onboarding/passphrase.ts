// Passphrase rules and the recovery-phrase check (adapted from Sala's onboarding).

export const MIN_PASSPHRASE = 10;

export type Strength = 0 | 1 | 2 | 3;

/**
 * A rough strength estimate for the meter: 0 weak … 3 strong. Length matters most; character
 * variety and several words help. Counts code points, so "ã" or an emoji is one character.
 */
export function strength(p: string): Strength {
  const length = [...p].length;
  if (length < MIN_PASSPHRASE) return 0;
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{Nd}\s]/u, /\s/].filter((r) => r.test(p)).length;
  const words = p.trim().split(/\s+/).filter(Boolean).length;
  // A run of one repeated character ("aaaaaaaaaa") is long but weak.
  const distinct = new Set(p).size;
  if (distinct <= 2) return 1;
  const score = length / 6 + classes * 0.6 + (words >= 3 ? 1 : 0) + (words >= 4 ? 1 : 0);
  if (score >= 6) return 3;
  if (score >= 4.2) return 2;
  return 1;
}

export type PassphraseProblem = 'tooShort' | 'mismatch' | null;

/** What is wrong with a new passphrase typed twice, if anything. */
export function passphraseProblem(p: string, confirm: string): PassphraseProblem {
  if ([...p].length < MIN_PASSPHRASE) return 'tooShort';
  if (p.normalize('NFC') !== confirm.normalize('NFC')) return 'mismatch';
  return null;
}

/** Picks three distinct word positions (1-based, ascending) of a 12-word phrase to confirm. */
export function pickCheckPositions(random: () => number = Math.random, words = 12, count = 3): number[] {
  const all = Array.from({ length: words }, (_, i) => i + 1);
  const out: number[] = [];
  while (out.length < Math.min(count, words)) {
    const r = Math.min(Math.max(random(), 0), 0.999999);
    const [n] = all.splice(Math.floor(r * all.length), 1);
    out.push(n!);
  }
  return out.sort((a, b) => a - b);
}

/** A typed word against the phrase's word: case and surrounding spaces do not count. */
export function wordMatches(typed: string, word: string): boolean {
  return typed.trim().toLowerCase() === word.trim().toLowerCase() && word.trim() !== '';
}
