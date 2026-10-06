import { describe, expect, it } from 'vitest';
import { SearchError, validateQuery } from '../../../core/qda/search';
import { catalogs } from '../../../core/i18n/catalogs';
import { UI_LOCALES } from '../../../core/i18n/languages';
import { translate } from '../../../core/i18n/translate';
import { describeSyntaxError, inlineFlags, regexProblem } from './searchErrors';

const describeQuery = (query: string) => {
  const e = validateQuery({ query, mode: 'words' });
  expect(e).toBeInstanceOf(SearchError);
  return describeSyntaxError(e!, query);
};

describe('describeSyntaxError', () => {
  it('names the problem and where, never a token code', () => {
    expect(describeQuery('garden)')).toEqual({ what: 'closing', near: ')' });
    expect(describeQuery('garden OR')).toEqual({ what: 'end', near: '' });
    expect(describeQuery('garden AND AND plot')).toEqual({ what: 'operator', near: 'AND plot' });
  });
});

describe('regular expression errors', () => {
  const engine = (query: string, accentSensitive = false) => {
    const e = validateQuery({ query, mode: 'regex', accentSensitive });
    expect(e?.code).toBe('invalid-regex');
    return e!.detail;
  };
  it('names the problem from the engine’s message, never echoing it', () => {
    expect(regexProblem(engine('café('))).toBe('unclosedGroup');
    expect(regexProblem(engine('garden)'))).toBe('unmatchedClose');
    expect(regexProblem(engine('(?m)^Entrevistadora'))).toBe('badGroup');
    expect(regexProblem(engine('[z-a]'))).toBe('range');
    expect(regexProblem(engine('*garden'))).toBe('nothingToRepeat');
    expect(regexProblem(engine('[abc'))).toBe('unclosedClass');
    expect(regexProblem(engine('a{3,1}'))).toBe('quantifier');
    expect(regexProblem(engine('end\\'))).toBe('escape');
    // WebKit (the desktop app) words them differently.
    expect(regexProblem('Invalid regular expression: missing )')).toBe('unclosedGroup');
    expect(regexProblem('Invalid regular expression: unmatched parentheses')).toBe('unmatchedClose');
    expect(regexProblem('Invalid regular expression: unrecognized character after (?')).toBe('badGroup');
    expect(regexProblem('Invalid regular expression: missing terminating ] for character class')).toBe('unclosedClass');
    expect(regexProblem('Invalid regular expression: range out of order in character class')).toBe('range');
    expect(regexProblem('Invalid regular expression: nothing to repeat')).toBe('nothingToRepeat');
    expect(regexProblem('Invalid regular expression: \\ at end of pattern')).toBe('escape');
    expect(regexProblem('something new')).toBe('other');
  });

  it('every problem reads in every language, quoting what was typed', () => {
    for (const locale of UI_LOCALES) {
      for (const p of ['unclosedGroup', 'unmatchedClose', 'badGroup', 'unclosedClass', 'range', 'nothingToRepeat', 'quantifier', 'escape', 'other'] as const) {
        const detail = translate(catalogs[locale], catalogs.en, `analysis.search.errors.regexProblems.${p}`);
        const text = translate(catalogs[locale], catalogs.en, 'analysis.search.errors.regex', { query: 'café(', detail });
        expect(text).toContain('café(');
        expect(text).not.toMatch(/Invalid regular expression|\/gim|\{\w+\}/);
      }
    }
  });

  it('accepts leading inline flags: (?i) ignores case, (?m) is already how ^ and $ work', () => {
    expect(inlineFlags('(?m)^Interviewer')).toEqual({ pattern: '^Interviewer', ignoreCase: false });
    expect(inlineFlags('(?mi)^ana')).toEqual({ pattern: '^ana', ignoreCase: true });
    expect(inlineFlags('(?<name>x)')).toEqual({ pattern: '(?<name>x)', ignoreCase: false });
    expect(inlineFlags('(?:a|b)')).toEqual({ pattern: '(?:a|b)', ignoreCase: false });
    expect(validateQuery({ query: inlineFlags('(?m)^Entrevistadora').pattern, mode: 'regex' })).toBeNull();
  });
});
