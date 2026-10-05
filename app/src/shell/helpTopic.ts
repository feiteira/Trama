import { ROUTE_TOPICS } from '../features/help/manualModel';
import type { RouteName } from './router';

// Which part of the manual "?" and F1 open: the topic the screen on show declared in its
// ScreenHeader, else the one for its route. Module state: one screen shows at a time.

let declared: { topic: string } | null = null;

/** The manual topic for a route (ROUTE_TOPICS), or null on Help itself. */
export function routeTopic(name: RouteName): string | null {
  return name === 'help' ? null : ROUTE_TOPICS[name];
}

/** Declares the topic of the screen being shown; returns the function that withdraws it. */
export function declareHelpTopic(topic: string): () => void {
  const mine = { topic };
  declared = mine;
  return () => {
    if (declared === mine) declared = null;
  };
}

/** The topic F1 opens on `route`. */
export function currentHelpTopic(route: RouteName): string | null {
  if (route === 'help') return null;
  return declared?.topic ?? routeTopic(route);
}
