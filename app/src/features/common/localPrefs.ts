// Device-local preferences kept per project in browser storage (filters, folded branches, list
// views). They hold only switches and opaque record ids, but they name a project id, so they go
// when the project does, and all of them go when the library is removed. Storage may be missing
// or throw (a private window): then there is nothing to remove.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

type KeyStore = Pick<Storage, 'length' | 'key' | 'removeItem'>;

function storage(): KeyStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function removeWhere(match: (key: string) => boolean, s: KeyStore | null = storage()): void {
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k !== null && k.startsWith('trama.') && match(k)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    // Nothing more can be done; what is left holds no research content.
  }
}

/** Removes what this device remembers about one project (after it is deleted). */
export function forgetProjectPrefs(projectId: string, s?: KeyStore | null): void {
  if (!projectId) return;
  removeWhere((k) => k.includes(projectId), s);
}

/** Removes what this device remembers about any project (after the library is removed). */
export function forgetAllProjectPrefs(s?: KeyStore | null): void {
  removeWhere((k) => UUID.test(k), s);
}
