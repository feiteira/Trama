import { useCallback, useEffect, useRef, useState } from 'react';
import type { Kind } from '../core/model/types';
import type { Store } from '../core/store/store';
import { usePractice } from './AppState';

/**
 * Loads data from the store and reloads it whenever records of the given kinds change,
 * so every screen shows the current state without manual refreshes.
 */
export function useLive<T>(load: (store: Store) => Promise<T>, deps: unknown[], kinds: Kind[]): { data: T | undefined; reload: () => void } {
  const practice = usePractice();
  const [data, setData] = useState<T>();
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    loadRef
      .current(practice.store)
      .then((d) => {
        if (mine === seq.current) setData(d);
      })
      .catch((e) => console.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice, ...deps]);

  useEffect(() => {
    reload();
    return practice.store.subscribe((changed) => {
      if (kinds.some((k) => changed.has(k))) reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  return { data, reload };
}
