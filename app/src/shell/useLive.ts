import { useCallback, useEffect, useRef, useState } from 'react';
import type { Kind } from '../core/model/types';
import type { Store } from '../core/store/store';
import { useProject } from './AppState';
import { ReloadGate } from './reloadGate';

/**
 * Loads data from the open project's store and reloads it whenever records of the given kinds
 * change, so every screen shows the current state without manual refreshes. A load that
 * finishes after its inputs (`deps`) changed is dropped, so a slow query never overwrites fresh
 * data. Change notices are coalesced (reloadGate.ts): one load at a time, and a burst of commits
 * — a whole pseudonymisation, an undo across many documents — reloads once, not per commit.
 */
export function useLive<T>(
  load: (store: Store) => Promise<T>,
  deps: unknown[],
  kinds: Kind[],
): { data: T | undefined; error: unknown; reload: () => void } {
  const project = useProject();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;
  const seq = useRef(0);
  const gate = useRef<ReloadGate | null>(null);

  const run = useCallback((): Promise<void> => {
    const mine = ++seq.current;
    if (!project.isOpen) return Promise.resolve();
    return loadRef
      .current(project.store)
      .then((d) => {
        if (mine === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        // A load cut short by locking is expected; anything else is shown by the screen.
        if (mine === seq.current && project.isOpen) {
          console.error(e);
          setError(e);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, ...deps]);

  useEffect(() => {
    // New inputs load at once (a load still running for the old ones is dropped when it ends).
    const g = new ReloadGate(run);
    gate.current = g;
    g.now();
    const off = project.store.subscribe((changed) => {
      if (kindsRef.current.some((k) => changed.has(k))) g.request();
    });
    return () => {
      off();
      g.dispose();
      if (gate.current === g) gate.current = null;
    };
  }, [run, project]);

  const reload = useCallback(() => {
    if (gate.current) gate.current.request();
    else void run();
  }, [run]);

  return { data, error, reload };
}
