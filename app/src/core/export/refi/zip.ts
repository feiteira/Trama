// Reading the ZIP container of a .qdpx: listing, safe paths, case-insensitive lookup.
import { unzipSync } from 'fflate';
import { RefiError } from './common';

/** Whether a ZIP entry name could escape the folder it is extracted to (zip-slip). */
export function isUnsafeEntry(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  return n.startsWith('/') || /^[a-z]:/i.test(n) || n.split('/').some((seg) => seg === '..') || n.includes('\0');
}

export class ZipIndex {
  /** Lower-cased, slash-normalised path → entry name as stored. */
  private readonly byLower = new Map<string, string>();
  readonly names: string[] = [];
  /** Entries refused because their name was unsafe. */
  readonly refused: string[] = [];

  constructor(private readonly zip: Uint8Array) {
    try {
      unzipSync(zip, {
        filter: (f) => {
          if (f.name.endsWith('/')) return false;
          if (isUnsafeEntry(f.name)) {
            this.refused.push(f.name);
            return false;
          }
          const key = normPath(f.name).toLowerCase();
          if (!this.byLower.has(key)) {
            this.byLower.set(key, f.name);
            this.names.push(f.name);
          }
          return false;
        },
      });
    } catch {
      throw new RefiError('This file is not a ZIP archive (a .qdpx file is one).');
    }
  }

  /** The stored name of an entry, looked up case-insensitively, or null. */
  find(path: string): string | null {
    return this.byLower.get(normPath(path).toLowerCase()) ?? null;
  }

  /** Reads the given entries (stored names). Only these are inflated. */
  read(names: Iterable<string>): Map<string, Uint8Array> {
    const want = new Set(names);
    if (!want.size) return new Map();
    const files = unzipSync(this.zip, { filter: (f) => want.has(f.name) });
    return new Map(Object.entries(files));
  }
}

export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/');
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}
