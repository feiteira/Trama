import { useCallback, useEffect, useRef, useState } from 'react';
import { useProject } from '../../shell/AppState';
import { docTextInfo, type DocTextInfo } from './view';

/** Documents whose text stays in memory at most (the ones on screen are re-read as needed). */
const KEEP = 48;

export interface DocTexts {
  get(id: string): DocTextInfo | undefined;
  /** Loads these documents' texts (those not loaded yet), in the background. */
  request(ids: readonly string[]): void;
  /** Changes when a text arrives, for memoised consumers. */
  version: number;
}

/**
 * Document texts for the segments on screen, loaded on demand and kept for a few dozen
 * documents, so a project of long transcripts never holds every text at once. Edited texts
 * (pseudonymisation, typo fixes) are re-read.
 */
export function useDocTexts(): DocTexts {
  const project = useProject();
  const cache = useRef(new Map<string, DocTextInfo>());
  const loading = useRef(new Set<string>());
  const wanted = useRef<readonly string[]>([]);
  const [version, setVersion] = useState(0);
  const alive = useRef(true);

  const load = useCallback(
    (ids: readonly string[]) => {
      for (const id of ids) {
        if (cache.current.has(id) || loading.current.has(id)) continue;
        loading.current.add(id);
        project.store
          .get('doctext', id)
          .then((dt) => {
            loading.current.delete(id);
            if (!alive.current || !dt || dt.deleted) return;
            cache.current.set(id, docTextInfo(dt.text));
            // Forget the oldest beyond the limit (Map keeps insertion order), never one in view.
            const keep = new Set(wanted.current);
            for (const k of cache.current.keys()) {
              if (cache.current.size <= KEEP) break;
              if (!keep.has(k)) cache.current.delete(k);
            }
            setVersion((v) => v + 1);
          })
          .catch((e: unknown) => {
            loading.current.delete(id);
            if (project.isOpen) console.error(e);
          });
      }
    },
    [project],
  );

  useEffect(() => {
    alive.current = true;
    const stop = project.store.subscribe((changed) => {
      if (!changed.has('doctext')) return;
      cache.current.clear();
      setVersion((v) => v + 1);
      load(wanted.current);
    });
    return () => {
      alive.current = false;
      stop();
    };
  }, [project, load]);

  const request = useCallback(
    (ids: readonly string[]) => {
      wanted.current = ids;
      load(ids);
    },
    [load],
  );
  const get = useCallback((id: string) => {
    const hit = cache.current.get(id);
    if (hit) {
      // Recently used goes to the end.
      cache.current.delete(id);
      cache.current.set(id, hit);
    }
    return hit;
  }, []);
  return { get, request, version };
}
