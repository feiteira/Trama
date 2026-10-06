import { describe, expect, it } from 'vitest';
import { SearchError, validateQuery } from '../../../core/qda/search';
import { describeSyntaxError } from './searchErrors';

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
