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
