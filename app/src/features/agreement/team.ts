// Team work without a cloud: the preview of a teammate's copy as the merge dialog lists it, and
// plain-language reasons when a file cannot be merged. What a merge would do is worked out by
// services/datafile.previewMerge, with the same rule and checks as the merge itself.

import type { ProjectBundle } from '../../core/export/bundle';
import { NotTramaFileError, UnlockRequiredError } from '../../core/export/trama';
import { DecryptError } from '../../core/crypto/frames';
import type { Kind } from '../../core/model/types';
import { DataFileError, type KindCounts, type MergePreview } from '../../services/datafile';

/** The kinds a preview lists by name; everything else is summed as "other records". */
export const PREVIEW_KINDS = ['document', 'code', 'coding', 'memo', 'case'] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

/** A preview's counts by the rows the merge dialog shows. */
export function previewRows(preview: Pick<MergePreview, 'byKind'>): Record<PreviewKind | 'other', KindCounts> {
  const zero = (): KindCounts => ({ added: 0, updated: 0 });
  const rows: Record<PreviewKind | 'other', KindCounts> = { document: zero(), code: zero(), coding: zero(), memo: zero(), case: zero(), other: zero() };
  for (const [kind, c] of Object.entries(preview.byKind) as [Kind, KindCounts][]) {
    const row = rows[(PREVIEW_KINDS as readonly string[]).includes(kind) ? (kind as PreviewKind) : 'other'];
    row.added += c.added;
    row.updated += c.updated;
  }
  return rows;
}

/** True when a bundle is a copy of the project open here (merging needs the same project id). */
export function sameProject(bundle: Pick<ProjectBundle, 'project'>, projectId: string): boolean {
  return !!bundle.project.id && bundle.project.id === projectId;
}

export type FileProblem = 'differentProject' | 'notTrama' | 'wrongPassword' | 'backup' | 'unknown';

/** Why a file could not be merged, for the message shown. */
export function fileProblem(e: unknown): FileProblem {
  if (e instanceof DataFileError && e.code === 'DIFFERENT_PROJECT') return 'differentProject';
  if (e instanceof NotTramaFileError) return 'notTrama';
  if (e instanceof DecryptError) return 'wrongPassword';
  if (e instanceof UnlockRequiredError && e.protection === 'library-key') return 'backup';
  return 'unknown';
}

/** A file name for a teammate's copy: "<project> – for <name>.trama", safe on every system. */
export function copyFileName(project: string, teammate: string): string {
  const clean = (s: string) =>
    s
      .normalize('NFC')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  const p = clean(project) || 'project';
  const who = clean(teammate);
  return `${who ? `${p} - ${who}` : p}.trama`;
}
