// Whole project files brought into the library: a .trama (Trama's own, maybe protected by a
// password or by another library's key) or a REFI-QDA .qdpx from NVivo, MAXQDA, ATLAS.ti…
// The dialog (ImportProjectDialog.tsx) walks through these steps; the decisions live here.

import { unzipSync } from 'fflate';
import { DecryptError } from '../../core/crypto/frames';
import { WrongSecretError } from '../../core/crypto/keyring';
import type { Kdf } from '../../core/crypto/kdf';
import type { ProjectBundle } from '../../core/export/bundle';
import { RefiError } from '../../core/export/refi';
import { decryptTrama, NotTramaFileError, protectionOf, readTramaZip, type TramaBundle, type Unlock, UnlockRequiredError } from '../../core/export/trama';
import type { Kind } from '../../core/model/types';
import { DataFileError } from '../../services/datafile';
import { uniqueName } from '../../services/documents';
import { JobStopped } from '../../services/jobs';
import { LibraryError } from '../../services/library';
import type { LibraryKeys } from '../../services/project';
import type { Msg } from './messages';
import { nameKey } from './model';

export type ProjectFileType = 'trama' | 'qdpx';

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6));

function zipNames(bytes: Uint8Array): string[] | null {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    return null;
  }
  return names;
}

/** What kind of project file this is, from its contents (the extension only breaks ties). */
export function detectProjectFile(filename: string, bytes: Uint8Array): ProjectFileType | null {
  const ext = (/\.([a-z0-9]+)$/i.exec(filename)?.[1] ?? '').toLowerCase();
  if (isZip(bytes)) {
    const names = zipNames(bytes);
    if (!names) return ext === 'trama' ? 'trama' : ext === 'qdpx' ? 'qdpx' : null;
    if (names.includes('manifest.json')) return 'trama';
    if (names.some((n) => /\.qde$/i.test(n))) return 'qdpx';
    return ext === 'trama' ? 'trama' : ext === 'qdpx' ? 'qdpx' : null;
  }
  try {
    protectionOf(bytes);
    return 'trama';
  } catch {
    return null;
  }
}

export type TramaOpen =
  | { status: 'opened'; bundle: TramaBundle; protection: 'none' | 'password' | 'library-key'; ownLibrary: boolean }
  | { status: 'locked'; protection: 'password' | 'library-key' };

/**
 * Opens a .trama file. Without `unlock`, a password file comes back `locked`; a library-key file
 * (a backup) is tried with this library's own key first and is `locked` only when another
 * library made it. Throws DecryptError / WrongSecretError for a wrong password or passphrase.
 */
export async function openTrama(bytes: Uint8Array, unlock: Unlock | null, ownKeys: () => LibraryKeys, kdf: Kdf): Promise<TramaOpen> {
  const protection = protectionOf(bytes);
  if (protection === 'none') return { status: 'opened', bundle: readTramaZip(bytes), protection, ownLibrary: false };
  if (!unlock) {
    if (protection === 'password') return { status: 'locked', protection };
    const own = ownKeys();
    try {
      const { zip } = await decryptTrama(bytes, { kind: 'library-key', libraryKey: own.libraryKey }, kdf);
      return { status: 'opened', bundle: readTramaZip(zip), protection, ownLibrary: true };
    } catch (e) {
      if (e instanceof DecryptError) return { status: 'locked', protection };
      throw e;
    } finally {
      own.wipe();
    }
  }
  const opened = await decryptTrama(bytes, unlock, kdf);
  if (opened.libraryKey) opened.libraryKey.fill(0);
  return { status: 'opened', bundle: readTramaZip(opened.zip), protection, ownLibrary: false };
}

export interface BundleSummary {
  name: string;
  description: string;
  origin: string | null;
  counts: Record<'document' | 'code' | 'coding' | 'memo' | 'case' | 'coder', number>;
  coders: { id: string; name: string }[];
}

/** Live records per kind and the coders, for the summary before importing. */
export function summariseBundle(bundle: ProjectBundle): BundleSummary {
  const counts: BundleSummary['counts'] = { document: 0, code: 0, coding: 0, memo: 0, case: 0, coder: 0 };
  const coders: { id: string; name: string }[] = [];
  for (const r of bundle.records) {
    if (r.record.deleted) continue;
    const k = r.kind as Kind;
    if (k in counts) counts[k as keyof typeof counts]++;
    if (r.kind === 'coder') coders.push({ id: r.record.id, name: r.record.name });
  }
  return { name: bundle.project.name, description: bundle.project.description, origin: bundle.project.origin, counts, coders };
}

/** The coder of the file who is me on this computer: one with the name I go by, if any. */
export function meIn(coders: readonly { id: string; name: string }[], myName: string): string | null {
  if (!myName.trim()) return null;
  const hits = coders.filter((c) => nameKey(c.name) === nameKey(myName));
  return hits.length === 1 ? hits[0]!.id : null;
}

/** The project already in the library that this file is a copy of (same project id). */
export function sameProjectIn<P extends { id: string }>(bundle: ProjectBundle, projects: readonly P[]): P | null {
  const id = bundle.project.id;
  return id ? projects.find((p) => p.id === id) ?? null : null;
}

/** A name for a separate copy, unique in the library. */
export function copyName(name: string, taken: readonly string[]): string {
  return uniqueName(name.trim() || 'Project', taken);
}

/**
 * The name suggested for an imported project: its own (or the file's), never one a project in
 * the library already has. A .qdpx of one's own project comes back with a new id but the same
 * name, and two identical entries make deleting the wrong one easy.
 */
export function importName(projectName: string, fileName: string, taken: readonly string[]): string {
  return copyName(projectName.trim() || fileName.replace(/\.[^.]+$/, ''), taken);
}

/** Why a project file could not be read or imported. */
export function projectFileError(e: unknown, protection?: 'password' | 'library-key' | 'none'): Msg {
  if (e instanceof NotTramaFileError) {
    if (e.reason === 'newer-version') return { key: 'importer.project.errors.newer' };
    if (e.reason === 'unknown-type' || e.reason === 'not-zip' || e.reason === 'no-manifest' || e.reason === 'format') return { key: 'importer.project.errors.notProject' };
    return { key: 'importer.project.errors.damaged' };
  }
  if (e instanceof WrongSecretError) return { key: 'importer.project.errors.wrongSecret' };
  if (e instanceof DecryptError) return { key: protection === 'library-key' ? 'importer.project.errors.wrongSecret' : 'importer.project.errors.wrongPassword' };
  if (e instanceof UnlockRequiredError) return { key: 'importer.project.errors.locked' };
  if (e instanceof RefiError) return { key: 'importer.project.errors.notQdpx', vars: { message: e.message } };
  if (e instanceof DataFileError) return { key: 'importer.project.errors.different' };
  if (e instanceof LibraryError) {
    if (e.code === 'EXISTS') return { key: 'importer.project.errors.exists' };
    if (e.code === 'LOCKED') return { key: 'importer.project.errors.libraryLocked' };
  }
  if (e instanceof JobStopped) return { key: 'importer.project.errors.libraryLocked' };
  return { key: 'importer.project.errors.other', vars: { message: e instanceof Error ? e.message : String(e) } };
}
