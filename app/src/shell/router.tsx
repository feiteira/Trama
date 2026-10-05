import React, { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

// Where the researcher is inside the open project. A plain history stack in memory: the app
// has no URL bar, and nothing about where one was is ever written to disk.

export type AnalysisTool = 'search' | 'cooccurrence' | 'matrix' | 'crosstab' | 'words' | 'charts';

export type Route =
  | { name: 'workbench'; docId?: string; codeId?: string; select?: { start: number; end: number } }
  | { name: 'codes'; codeId?: string }
  | { name: 'segments'; codeIds?: string[] }
  | { name: 'memos'; memoId?: string }
  | { name: 'cases'; caseId?: string }
  | { name: 'analysis'; tool?: AnalysisTool; query?: string }
  | { name: 'agreement' }
  | { name: 'import' }
  | { name: 'project' }
  | { name: 'pseudonyms' }
  | { name: 'log' }
  | { name: 'settings' }
  | { name: 'help'; topic?: string };

export type RouteName = Route['name'];
export type RouteOf<N extends RouteName> = Extract<Route, { name: N }>;

/** What every screen in features/<name>/index.tsx receives (its default export). */
export interface ScreenProps<N extends RouteName = RouteName> {
  route: RouteOf<N>;
}

export const ROUTE_NAMES: readonly RouteName[] = [
  'workbench', 'codes', 'segments', 'memos', 'cases', 'analysis', 'agreement', 'import', 'project', 'pseudonyms', 'log', 'settings', 'help',
];

export const isRouteName = (s: string | null | undefined): s is RouteName => (ROUTE_NAMES as readonly string[]).includes(s ?? '');

/** One place in the history. `key` stays the same while the place is only updated (`replace`). */
export interface Entry {
  key: number;
  route: Route;
}

export const MAX_STEPS = 50;

/** A route as a comparable string: key order and fields left unset do not count. */
export function routeId(route: Route): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined && x !== '' && !(Array.isArray(x) && x.length === 0))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, norm(x)]);
    }
    return v;
  };
  return JSON.stringify(norm(route));
}

export const sameRoute = (a: Route, b: Route): boolean => routeId(a) === routeId(b);

/** Adds a step, unless it is the place already showing. Keeps at most MAX_STEPS. */
export function pushEntry(stack: Entry[], route: Route, key: number): Entry[] {
  const top = stack[stack.length - 1];
  if (top && sameRoute(top.route, route)) return stack;
  return [...stack.slice(-(MAX_STEPS - 1)), { key, route }];
}

/** Changes the current place without adding a step. */
export function replaceTop(stack: Entry[], route: Route, key: number): Entry[] {
  const top = stack[stack.length - 1];
  if (top && sameRoute(top.route, route)) return stack;
  return [...stack.slice(0, -1), { key: top?.key ?? key, route }];
}

/** One step back; the first place stays. */
export function popEntry(stack: Entry[]): Entry[] {
  return stack.length > 1 ? stack.slice(0, -1) : stack;
}

/**
 * Removes the places that `drop` says no longer exist (a deleted document or memo), joining
 * neighbours that become equal. Never empty: `fallback` is used when nothing is left.
 */
export function dropEntries(stack: Entry[], drop: (r: Route) => boolean, fallback: Entry): Entry[] {
  const kept: Entry[] = [];
  for (const e of stack) {
    if (drop(e.route)) continue;
    const prev = kept[kept.length - 1];
    if (prev && sameRoute(prev.route, e.route)) kept[kept.length - 1] = e;
    else kept.push(e);
  }
  return kept.length ? kept : [fallback];
}

export interface RouterValue {
  route: Route;
  /** The current place's key: a screen keyed on it keeps its state through `replace`. */
  routeKey: number;
  /** Goes to `route`, unless it is where we already are. */
  go: (route: Route) => void;
  /** Changes the current place without adding a step to Back (a screen recording its selection). */
  replace: (route: Route) => void;
  back: () => void;
  canGoBack: boolean;
  /** Forgets places that no longer exist, so Back never lands on a deleted record. */
  drop: (predicate: (r: Route) => boolean) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const seq = useRef(0);
  const [stack, setStack] = useState<Entry[]>(() => [{ key: 0, route: initial }]);
  const go = useCallback((route: Route) => setStack((s) => pushEntry(s, route, ++seq.current)), []);
  const replace = useCallback((route: Route) => setStack((s) => replaceTop(s, route, ++seq.current)), []);
  const back = useCallback(() => setStack(popEntry), []);
  const drop = useCallback(
    (predicate: (r: Route) => boolean) => setStack((s) => dropEntries(s, predicate, { key: ++seq.current, route: { name: 'workbench' } })),
    [],
  );
  const value = useMemo<RouterValue>(() => {
    const top = stack[stack.length - 1]!;
    return { route: top.route, routeKey: top.key, go, replace, back, drop, canGoBack: stack.length > 1 };
  }, [stack, go, replace, back, drop]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const r = useContext(RouterContext);
  if (!r) throw new Error('useRouter outside RouterProvider (only inside an open project)');
  return r;
}
