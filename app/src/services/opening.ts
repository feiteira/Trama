// What a project needs put right when it opens: work that a lock, a crash or a full disk cut
// short. Each check is cheap when there is nothing to do, and none of them keeps the project
// from opening: a failure is logged to the console and the project opens anyway.

import type { Document, MediaRef } from '../core/model/types';
import { finishPendingMerge } from './datafile';
import type { Project } from './project';
import { eraseDeletedKeyEntries, logInterruptedApply } from './pseudonyms';
import { checkIntegrity } from './reconcile';

export async function afterOpen(project: Project): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ['finishing an interrupted merge', () => finishPendingMerge(project)],
    ['checking documents and codings', () => checkIntegrity(project.store)],
    ['noting an interrupted pseudonymisation', () => logInterruptedApply(project)],
    ['erasing deleted key entries', () => eraseDeletedKeyEntries(project)],
    ['removing files nothing points to', () => sweepBlobs(project)],
  ];
  for (const [what, run] of steps) {
    if (!project.isOpen) return;
    try {
      await run();
    } catch (e) {
      console.error(`${what} failed`, e);
    }
  }
}

/**
 * Removes the project's stored files that no document (live or in the trash) points to: files
 * an import or an attachment stored before a lock or a crash stopped it from writing the
 * document. Returns how many were removed.
 */
export async function sweepBlobs(project: Project): Promise<number> {
  const onDisk = await project.platform.blobs.list(project.id);
  if (!onDisk.length) return 0;
  const used = new Set<string>();
  for (const d of (await project.store.list('document', { includeDeleted: true })) as Document[]) {
    for (const ref of [d.original, d.media] as (MediaRef | null)[]) if (ref) used.add(ref.blob_id);
  }
  let removed = 0;
  for (const id of onDisk) {
    if (used.has(id) || !project.isOpen) continue;
    await project.platform.blobs.remove(project.id, id);
    removed++;
  }
  return removed;
}
