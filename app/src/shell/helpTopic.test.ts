import { describe, expect, it } from 'vitest';
import { ROUTE_TOPICS } from '../features/help/manualModel';
import { currentHelpTopic, declareHelpTopic, routeTopic } from './helpTopic';

describe('help topics for F1 and the header’s "?"', () => {
  it('uses the route’s topic, and none on Help itself', () => {
    expect(routeTopic('codes')).toBe(ROUTE_TOPICS.codes);
    expect(routeTopic('help')).toBeNull();
    expect(currentHelpTopic('memos')).toBe(ROUTE_TOPICS.memos);
  });

  it('prefers the topic the showing screen declared, until it withdraws it', () => {
    const withdraw = declareHelpTopic('03-coding#recording');
    expect(currentHelpTopic('workbench')).toBe('03-coding#recording');
    expect(currentHelpTopic('help')).toBeNull();
    withdraw();
    expect(currentHelpTopic('workbench')).toBe(ROUTE_TOPICS.workbench);
  });

  it('keeps a newer declaration when an older one is withdrawn late', () => {
    const first = declareHelpTopic('a');
    const second = declareHelpTopic('b');
    first();
    expect(currentHelpTopic('codes')).toBe('b');
    second();
    expect(currentHelpTopic('codes')).toBe(ROUTE_TOPICS.codes);
  });
});
