import { describe, expect, it } from 'vitest';
import { DraftClaims, isDirty, startDraft } from './editDraft';

describe('edit drafts', () => {
  it('is dirty only once the text differs from where the edit started', () => {
    const d = startDraft('d1', 'Interview 1', 'Hello');
    expect(isDirty(d)).toBe(false);
    expect(isDirty({ ...d, text: 'Hello!' })).toBe(true);
    expect(isDirty({ ...d, text: 'Hello!', busy: true })).toBe(false);
    expect(isDirty(null)).toBe(false);
  });

  it('does not depend on the text the viewer shows now (a switch empties it while loading)', () => {
    // The draft compares with its own base: switching documents must not make an untouched
    // edit look changed, nor a changed one look clean.
    const d = { ...startDraft('d1', 'A', 'abc'), text: 'abc' };
    expect(isDirty(d)).toBe(false);
  });

  it('hands out a dirty draft once, so leaving and locking do not save it twice', () => {
    const claims = new DraftClaims();
    const d = { ...startDraft('d1', 'A', 'abc'), text: 'abcd' };
    expect(claims.claim(d)).toBe(d);
    expect(claims.claim(d)).toBeNull();
    const later = { ...d, text: 'abcde' };
    expect(claims.claim(later)).toBe(later);
    expect(claims.claim(startDraft('d2', 'B', 'x'))).toBeNull();
  });
});
