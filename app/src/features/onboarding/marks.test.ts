import { describe, expect, it } from 'vitest';
import { codesIn, parseMarks } from './marks';

describe('parseMarks', () => {
  it('splits marked spans from plain text', () => {
    expect(parseMarks('Honestly, [a]loneliness[/a]. And [b]friends[/b]')).toEqual([
      { text: 'Honestly, ', code: null },
      { text: 'loneliness', code: 'a' },
      { text: '. And ', code: null },
      { text: 'friends', code: 'b' },
    ]);
  });

  it('keeps malformed or mismatched marks as text', () => {
    expect(parseMarks('[a]open only')).toEqual([{ text: '[a]open only', code: null }]);
    expect(parseMarks('[a]x[/b]')).toEqual([{ text: '[a]x[/b]', code: null }]);
  });

  it('drops empty marks and handles empty input', () => {
    expect(parseMarks('[a][/a]')).toEqual([]);
    expect(parseMarks('')).toEqual([]);
  });

  it('keeps Unicode intact', () => {
    expect(parseMarks('[c]coração 🌱[/c]!')).toEqual([
      { text: 'coração 🌱', code: 'c' },
      { text: '!', code: null },
    ]);
  });

  it('lists codes in order of first use', () => {
    expect(codesIn('[b]x[/b] [a]y[/a] [b]z[/b]')).toEqual(['b', 'a']);
  });
});
