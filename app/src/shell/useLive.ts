import { useCallback, useEffect, useRef, useState } from 'react';
import type { Kind } from '../core/model/types';
import type { Store } from '../core/store/store';
import { useProject } from './AppState';

/**
 * Loads data from the open project's store and reloads it whenever records of the given kinds
 * change, so every screen shows the current state without manual refreshes. A load that
 * finishes after a newer one started is dropped, so a slow query never overwrites fresh data.
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

  const reload = useCallback(() => {
    const mine = ++seq.current;
    if (!project.isOpen) return;
    loadRef
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
    reload();
    return project.store.subscribe((changed) => {
      if (kindsRef.current.some((k) => changed.has(k))) reload();
    });
  }, [reload, project]);

  return { data, error, reload };
}
