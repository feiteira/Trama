// Search syntax errors for the reader: the parser (core/qda/search.ts) names the token it
// stopped at ('rp', 'and', 'end'…), which means nothing to a researcher.

import type { SearchError } from '../../../core/qda/search';

export type SyntaxProblem = 'closing' | 'operator' | 'end' | 'other';

/** What went wrong, and the part of the query from where it went wrong ('' at the end). */
export function describeSyntaxError(e: Pick<SearchError, 'detail' | 'position'>, typed: string): { what: SyntaxProblem; near: string } {
  const what: SyntaxProblem = e.detail === 'rp' ? 'closing' : e.detail === 'and' || e.detail === 'or' ? 'operator' : e.detail === 'end' ? 'end' : 'other';
  const near = what !== 'end' && e.position !== null ? typed.slice(e.position).trim().slice(0, 24) : '';
  return { what, near };
}

export type RegexProblem = 'unclosedGroup' | 'unmatchedClose' | 'badGroup' | 'unclosedClass' | 'range' | 'nothingToRepeat' | 'quantifier' | 'escape' | 'other';

// The engines' own messages: V8 (the browser demo, tests) and JavaScriptCore (WebKit, the desktop
// app on Linux and macOS). Checked in order; matched without case.
const REGEX_PROBLEMS: [RegExp, RegexProblem][] = [
  [/unterminated group|missing \)/i, 'unclosedGroup'],
  [/unmatched '?\)'?|unmatched parenthes/i, 'unmatchedClose'],
  [/invalid group|unrecognized character after \(\?|group specifier name|capture group name|invalid named (reference|capture)/i, 'badGroup'],
  [/unterminated character class|missing terminating \]/i, 'unclosedClass'],
  [/range out of order/i, 'range'],
  [/nothing to repeat|lone quantifier/i, 'nothingToRepeat'],
  [/out of order in \{\}|incomplete quantifier|too large in \{\}/i, 'quantifier'],
  [/escape|\\ at end of pattern|property (name|expression)|backreference/i, 'escape'],
];

/** What is wrong with a regular expression, from the engine's message (never shown as such: it is English and quotes the pattern Trama rewrote). */
export function regexProblem(engineMessage: string): RegexProblem {
  for (const [re, problem] of REGEX_PROBLEMS) if (re.test(engineMessage)) return problem;
  return 'other';
}

/**
 * Leading inline flags, as other tools write them: "(?i)" makes the search ignore case, "(?m)"
 * changes nothing (^ and $ already match at every paragraph). JavaScript has no inline flags and
 * would reject the group.
 */
export function inlineFlags(pattern: string): { pattern: string; ignoreCase: boolean } {
  const m = /^\(\?([im]+)\)/.exec(pattern);
  if (!m) return { pattern, ignoreCase: false };
  return { pattern: pattern.slice(m[0].length), ignoreCase: m[1]!.includes('i') };
}
