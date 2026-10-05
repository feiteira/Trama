import { useCallback, useEffect, useState } from 'react';

// The workbench's device-local preferences (font size, stripes, filters, panel sizes). They hold
// no research content: only switches, sizes and record ids. localStorage may be missing or
// throw (a private window); the defaults apply then.

const PREFIX = 'trama.workbench.';

export function readPref<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const v: unknown = JSON.parse(raw);
    return valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not remembered; it still applies now.
  }
}

export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isStr = (v: unknown): v is string => typeof v === 'string';
export const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A remembered value: state that writes itself to localStorage. */
export function usePref<T>(key: string, fallback: T, valid: (v: unknown) => v is T): [T, (v: T | ((cur: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback, valid));
  const set = useCallback(
    (v: T | ((cur: T) => T)) =>
      setValue((cur) => {
        const next = typeof v === 'function' ? (v as (cur: T) => T)(cur) : v;
        writePref(key, next);
        return next;
      }),
    [key],
  );
  return [value, set];
}

/** True while the dark theme shows (chosen, or followed from the system). */
export function useDarkTheme(): boolean {
  const compute = () => {
    if (typeof document === 'undefined') return false;
    const chosen = document.documentElement.getAttribute('data-theme');
    if (chosen === 'dark') return true;
    if (chosen === 'light') return false;
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [dark, setDark] = useState(compute);
  useEffect(() => {
    const update = () => setDark(compute());
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
    mq?.addEventListener('change', update);
    return () => {
      mo.disconnect();
      mq?.removeEventListener('change', update);
    };
  }, []);
  return dark;
}

export const FONT_SIZES = [14, 15, 16, 17, 18, 20, 22, 24] as const;
export const DEFAULT_FONT = 17;
