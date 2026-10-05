import React, { type ComponentType, lazy, type LazyExoticComponent } from 'react';
import type { Route, RouteName, ScreenProps } from '../shell/router';

// Route name → screen. Each screen is features/<folder>/index.tsx with a default export taking
// ScreenProps<'<name>'>, loaded on first visit so the app starts quickly.

type Screens = { [N in RouteName]: LazyExoticComponent<ComponentType<ScreenProps<N>>> };

export const SCREENS: Screens = {
  workbench: lazy(() => import('./workbench')),
  codes: lazy(() => import('./codes')),
  segments: lazy(() => import('./segments')),
  memos: lazy(() => import('./memos')),
  cases: lazy(() => import('./cases')),
  analysis: lazy(() => import('./analysis')),
  agreement: lazy(() => import('./agreement')),
  import: lazy(() => import('./importer')),
  project: lazy(() => import('./exporter')),
  pseudonyms: lazy(() => import('./pseudonyms')),
  log: lazy(() => import('./log')),
  settings: lazy(() => import('./settings')),
  help: lazy(() => import('./help')),
};

/**
 * The current route's screen. Keyed by name: moving between screens starts each afresh, while
 * a change of parameters (another document) reaches the mounted screen as new props.
 */
export function ScreenView({ route }: { route: Route }) {
  const Screen = SCREENS[route.name] as LazyExoticComponent<ComponentType<ScreenProps>>;
  return <Screen key={route.name} route={route} />;
}
