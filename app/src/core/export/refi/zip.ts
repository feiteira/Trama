// Reading the ZIP container of a .qdpx: listing, safe paths, case-insensitive lookup.
import { unzipSync } from 'fflate';
import { LIMITS } from '../../model/types';
import { RefiError } from './common';

/** Most project.qde may hold uncompressed: an XML string much larger than this cannot be parsed. */
export const MAX_QDE_BYTES = 256 * 1024 * 1024;
/** Uncompressed bytes any archive may expand to, whatever its size. */
const MIN_BUDGET = 1024 * 1024 * 1024;
/** Beyond that floor, how much larger than the file its contents may be (media barely compress). */
const MAX_RATIO = 32;

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
  /** Declared uncompressed size of each entry (stored name). */
  private readonly sizes = new Map<string, number>();
  /** Bytes inflated so far, against the archive's budget. */
  private inflated = 0;

  constructor(private readonly zip: Uint8Array) {
    let duplicate: string | null = null;
    try {
      unzipSync(zip, {
        filter: (f) => {
          if (f.name.endsWith('/')) return false;
          if (isUnsafeEntry(f.name)) {
            this.refused.push(f.name);
            return false;
          }
          // fflate inflates every entry the read filter accepts, so a name stored twice would be
          // inflated twice while counted once against the budget; and lookups ignore case and
          // path spelling, so two entries one lookup could mean make the archive ambiguous.
          const key = normPath(f.name).toLowerCase();
          if (this.byLower.has(key) || this.sizes.has(f.name)) {
            duplicate ??= f.name;
            return false;
          }
          this.sizes.set(f.name, f.originalSize);
          this.byLower.set(key, f.name);
          this.names.push(f.name);
          return false;
        },
      });
    } catch {
      throw new RefiError('This file is not a ZIP archive (a .qdpx file is one).');
    }
    if (duplicate !== null) throw new RefiError(`This archive is damaged: it holds ${duplicate} more than once.`);
  }

  /** The stored name of an entry, looked up case-insensitively, or null. */
  find(path: string): string | null {
    return this.byLower.get(normPath(path).toLowerCase()) ?? null;
  }

  /**
   * Reads the given entries (stored names). Only these are inflated. fflate inflates an entry
   * into a buffer of exactly its declared size, so checking declared sizes first refuses a zip
   * bomb before gigabytes are allocated.
   */
  read(names: Iterable<string>, maxEntry: number = LIMITS.mediaMaxBytes): Map<string, Uint8Array> {
    const want = new Set(names);
    if (!want.size) return new Map();
    let total = this.inflated;
    const budget = Math.max(MIN_BUDGET, this.zip.length * MAX_RATIO);
    for (const name of want) {
      const size = this.sizes.get(name) ?? 0;
      total += size;
      if (size > maxEntry || total > budget) throw new RefiError(`This file is too large to open: ${name} would take ${Math.ceil(size / 1048576)} MB.`);
    }
    this.inflated = total;
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(this.zip, { filter: (f) => want.has(f.name) });
    } catch (e) {
      throw new RefiError(`This archive is damaged (${e instanceof Error ? e.message : String(e)}).`);
    }
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
