import { describe, expect, it } from 'vitest';
import { closedUnder, DraftClaims, isDirty, SaveInFlight, startDraft } from './editDraft';

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

describe('a save in flight when the project locks', () => {
  it('lets the lock wait for a running save, then saves nothing more when it went through', async () => {
    const inFlight = new SaveInFlight();
    const claims = new DraftClaims();
    const d = { ...startDraft('d1', 'A', 'long text'), text: 'short', busy: true };
    let finish!: () => void;
    const order: string[] = [];
    const work = new Promise<void>((r) => (finish = r)).then(() => void order.push('save'));
    void inFlight.track(d, work);
    // The lock's saver, as in Viewer: wait, then claim what is left (the busy draft is not dirty).
    const saver = (async () => {
      const failed = await inFlight.settle();
      order.push('settled');
      return claims.claim(failed ?? d);
    })();
    await Promise.resolve();
    expect(order).toEqual([]);
    finish();
    expect(await saver).toBeNull();
    expect(order).toEqual(['save', 'settled']);
    expect(await inFlight.settle()).toBeNull();
  });

  it('hands the draft to the lock when the running save failed, once', async () => {
    const inFlight = new SaveInFlight();
    const claims = new DraftClaims();
    const d = { ...startDraft('d1', 'A', 'long text'), text: 'short', busy: true };
    let fail!: (e: Error) => void;
    void inFlight.track(d, new Promise<void>((_, rej) => (fail = rej))).catch(() => undefined);
    const waiting = inFlight.settle();
    fail(new Error('disk'));
    const failed = await waiting;
    expect(failed).toMatchObject({ docId: 'd1', text: 'short', busy: false });
    expect(claims.claim(failed)).toBe(failed);
    // The viewer's own copy of the same edit (busy cleared after the failure) is not saved again.
    expect(claims.claim({ ...d, busy: false })).toBeNull();
  });

  it('treats a project closed under the save as no failure to show', () => {
    expect(closedUnder(new Error('x'), false)).toBe(true);
    expect(closedUnder(Object.assign(new Error('project p is not open'), { code: 'NOT_OPEN' }), true)).toBe(true);
    expect(closedUnder(Object.assign(new Error('closed'), { code: 'LOCKED' }), true)).toBe(true);
    expect(closedUnder(Object.assign(new Error('closed'), { code: 'DB_NOT_OPEN' }), true)).toBe(true);
    expect(closedUnder(new Error('disk full'), true)).toBe(false);
  });
});
