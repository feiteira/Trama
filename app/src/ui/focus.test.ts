import { describe, expect, it } from 'vitest';
import { OpenerTracker } from './focus';

describe('OpenerTracker', () => {
  it('keeps what had the focus when the dialog opened, not the field it focused itself', () => {
    const t = new OpenerTracker<string>();
    let focused = 'merge-button';
    t.update(false, () => focused);
    expect(t.opener).toBeNull();
    t.update(true, () => focused); // render that opens the dialog
    focused = 'codepick-search'; // an autoFocus field inside takes the focus during commit
    t.update(true, () => focused); // later renders while open
    expect(t.opener).toBe('merge-button');
  });

  it('records a new opener each time it opens again', () => {
    const t = new OpenerTracker<string>();
    t.update(true, () => 'a');
    t.update(false, () => 'x');
    t.update(true, () => 'b');
    expect(t.opener).toBe('b');
  });
});
