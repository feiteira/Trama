// Each analysis tool remembers its last settings per project, on this computer only
// (localStorage). Only options and opaque record ids are kept, never typed text such as a
// search query or stop words: browser storage is not encrypted, and a query can name a person.

export const settingsKey = (projectId: string, tool: string): string => `trama.analysis.${projectId}.${tool}`;

export type Allowed<T> = { [K in keyof T]?: readonly T[K][] };

function storageOf(storage?: Pick<Storage, 'getItem' | 'setItem'> | null): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The stored settings merged over `defaults`: a stored field is used only when it has the
 * default's type (arrays: of the same element type) and, for fields listed in `allowed`, one
 * of the allowed values. Anything unreadable falls back to the default.
 */
export function readSettings<T extends object>(key: string, defaults: T, allowed: Allowed<T> = {}, storage?: Pick<Storage, 'getItem' | 'setItem'> | null): T {
  const s = storageOf(storage);
  if (!s) return { ...defaults };
  let raw: unknown;
  try {
    const text = s.getItem(key);
    if (!text) return { ...defaults };
    raw = JSON.parse(text);
  } catch {
    return { ...defaults };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...defaults };
  const out = { ...defaults } as Record<string, unknown>;
  const stored = raw as Record<string, unknown>;
  for (const k of Object.keys(defaults)) {
    const d = (defaults as Record<string, unknown>)[k];
    const v = stored[k];
    if (v === undefined) continue;
    if (Array.isArray(d)) {
      if (!Array.isArray(v)) continue;
      const elemType = d.length ? typeof d[0] : 'string';
      if (!v.every((x) => typeof x === elemType)) continue;
    } else if (d === null ? v !== null && typeof v !== 'string' : typeof v !== typeof d) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    const list = (allowed as Record<string, readonly unknown[] | undefined>)[k];
    if (list && !list.includes(v)) continue;
    out[k] = v;
  }
  return out as T;
}

export function writeSettings<T extends object>(key: string, value: T, storage?: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  const s = storageOf(storage);
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the settings still apply until the screen closes.
  }
}
