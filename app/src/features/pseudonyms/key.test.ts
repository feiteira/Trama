import { describe, expect, it } from 'vitest';
import type { Pseudonym } from '../../core/model/types';
import { fillPattern, filterCandidates, inKey, keyRows, nextNumber, numberedReplacements, trimContext } from './key';

const p = (id: string, original: string, replacement: string, extra: Partial<Pseudonym> = {}): Pseudonym => ({
  id,
  original,
  replacement,
  note: '',
  whole_word: true,
  case_sensitive: true,
  applied_at: null,
  applied_count: 0,
  created_at: '',
  updated_at_hlc: '',
  deleted: false,
  ...extra,
});

describe('patterns', () => {
  it('fills {n}, or appends the number', () => {
    expect(fillPattern('[Participant {n}]', 3)).toBe('[Participant 3]');
    expect(fillPattern('P{n}-{n}', 2)).toBe('P2-2');
    expect(fillPattern('Person', 4)).toBe('Person 4');
    expect(fillPattern('  ', 1)).toBe('[1]');
  });

  it('numbers on from replacements already in the key', () => {
    expect(nextNumber('[Participant {n}]', ['[Participant 1]', '[participant 7]', '[Place 9]', 'Participant 12'])).toBe(8);
    expect(nextNumber('Person', ['Person 2'])).toBe(3);
    expect(nextNumber('[P{n}]', [])).toBe(1);
    expect(numberedReplacements('[P{n}]', 3, ['[P1]'])).toEqual(['[P2]', '[P3]', '[P4]']);
  });
});

describe('keyRows', () => {
  it('writes a header and one sorted row per entry', () => {
    const rows = keyRows(
      [p('1', 'Rui', '[P2]', { whole_word: false, applied_count: 3, applied_at: '2026-10-01T10:00:00Z', note: 'site lead' }), p('2', 'Ana Lima', '[P1]')],
      { original: 'Original', replacement: 'Replacement', wholeWord: 'Whole word', caseSensitive: 'Case sensitive', note: 'Note', appliedAt: 'Applied', appliedCount: 'Count' },
      'yes',
      'no',
    );
    expect(rows[0]).toEqual(['Original', 'Replacement', 'Whole word', 'Case sensitive', 'Note', 'Applied', 'Count']);
    expect(rows[1]).toEqual(['Ana Lima', '[P1]', 'yes', 'yes', '', '', '0']);
    expect(rows[2]).toEqual(['Rui', '[P2]', 'no', 'yes', 'site lead', '2026-10-01T10:00:00Z', '3']);
  });
});

describe('inKey', () => {
  it('compares like the service, ignoring the entry being edited', () => {
    const entries = [p('1', 'Ana  Lima', 'x')];
    expect(inKey(' Ana Lima ', entries)).toBe(true);
    expect(inKey('Ana Lima', entries, '1')).toBe(false);
    expect(inKey('Ana', entries)).toBe(false);
    expect(inKey('  ', entries)).toBe(false);
  });
});

describe('trimContext', () => {
  it('cuts partial words at the outer ends of long samples', () => {
    const r = trimContext('abcdefghij klmnopqrst uvwxyz and so on we', ' said that it was the best day of all of them');
    expect(r.before.startsWith('…klmnopqrst')).toBe(true);
    expect(r.after.endsWith('of…')).toBe(true);
    expect(trimContext('short ', ' one')).toEqual({ before: 'short ', after: ' one' });
  });
});

describe('filterCandidates', () => {
  it('filters ignoring accents', () => {
    expect(filterCandidates([{ text: 'José' }, { text: 'Ana' }], 'jose')).toEqual([{ text: 'José' }]);
  });
});
