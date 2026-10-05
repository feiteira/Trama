import { afterEach, describe, expect, it, vi } from 'vitest';
import { oneAtATime, SAVE_STAGE, Savers } from './savers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Savers', () => {
  it('runs stage by stage, and forgets removed savers', async () => {
    const savers = new Savers();
    const order: string[] = [];
    savers.register(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('backup');
    }, { stage: SAVE_STAGE.backup });
    savers.register(async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push('page');
    });
    savers.register(() => void order.push('sticky'));
    const remove = savers.register(() => void order.push('removed'));
    remove();
    await savers.run();
    expect(order).toEqual(['sticky', 'page', 'backup']);
  });

  it('logs a failing or overrunning saver and goes on', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const savers = new Savers();
    const done: string[] = [];
    savers.register(() => {
      throw new Error('disk full');
    });
    savers.register(() => new Promise<void>(() => undefined), { limitMs: 30 });
    savers.register(() => void done.push('later'), { stage: SAVE_STAGE.backup });
    await expect(savers.run()).resolves.toBeUndefined();
    expect(done).toEqual(['later']);
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe('oneAtATime', () => {
  it('shares a running call and starts a new one after it ends', async () => {
    let runs = 0;
    let finish: () => void = () => undefined;
    const slow = oneAtATime(() => {
      runs++;
      return new Promise<void>((resolve) => (finish = resolve));
    });
    const first = slow();
    expect(slow()).toBe(first);
    finish();
    await first;
    void slow();
    expect(runs).toBe(2);
  });

  it('starts again after a run that ended without awaiting anything', async () => {
    let runs = 0;
    const quick = oneAtATime(async () => {
      runs++;
    });
    await quick();
    await quick();
    expect(runs).toBe(2);
  });
});
