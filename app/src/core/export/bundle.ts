import type { Entity, Kind } from '../model/types';

/**
 * A whole project as plain data, the common currency of every project file format:
 * `.trama` (core/export/trama.ts) and REFI-QDA `.qdpx` (core/export/refi) both read into
 * and write from a bundle, and `Library.importBundle` turns one into a new project.
 */
export interface ProjectBundle {
  project: {
    /** Kept when a bundle is a copy of a Trama project (merging a teammate's copy needs it). */
    id: string | null;
    name: string;
    description: string;
    /** The program that wrote the file, when known (e.g. "MAXQDA 24", "Trama 0.1.0"). */
    origin: string | null;
  };
  /** Full records with base fields (tombstones included for .trama, live records only for qdpx). */
  records: BundleRecord[];
  /** Plaintext bytes of every file a MediaRef points to, keyed by MediaRef.blob_id. */
  blobs: Map<string, Uint8Array>;
  /** What could not be carried over, in plain language for the import summary. */
  warnings: string[];
}

export type BundleRecord = { [K in Kind]: { kind: K; record: Entity<K> } }[Kind];
