// Team work without a cloud: previewing a teammate's copy before merging it, and plain-language
// reasons when a file cannot be merged. The preview mirrors services/datafile.mergeTeammateCopy's
// rule (the newer version of each record wins) without writing anything.

import type { BundleRecord, ProjectBundle } from '../../core/export/bundle';
import { NotTramaFileError, UnlockRequiredError } from '../../core/export/trama';
import { DecryptError } from '../../core/crypto/frames';
import { compareHlc } from '../../core/hlc';
import { type Kind, KINDS } from '../../core/model/types';
import type { Store } from '../../core/store/store';
import { TABLES } from '../../core/store/schema';
import { DataFileError } from '../../services/datafile';

/** The kinds a preview lists by name; everything else is summed as "other records". */
export const PREVIEW_KINDS = ['document', 'code', 'coding', 'memo', 'case'] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

export interface KindCounts {
  added: number;
  updated: number;
}

export interface MergePreview {
  projectName: string;
  added: number;
  updated: number;
  unchanged: number;
  byKind: Record<PreviewKind | 'other', KindCounts>;
  /** Coders the copy brings that this project does not have yet. */
  newCoders: { id: string; name: string; color: string }[];
}

/** Write stamps of the records here, by kind and id. */
export type LocalStamps = ReadonlyMap<Kind, ReadonlyMap<string, string>>;

/** What merging `records` into a project holding `local` would change (pure). */
export function classifyMerge(projectName: string, records: readonly BundleRecord[], local: LocalStamps): MergePreview {
  const zero = (): KindCounts => ({ added: 0, updated: 0 });
  const byKind: MergePreview['byKind'] = { document: zero(), code: zero(), coding: zero(), memo: zero(), case: zero(), other: zero() };
  const newCoders: MergePreview['newCoders'] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const r of records) {
    const mine = local.get(r.kind)?.get(r.record.id);
    const bucket = byKind[(PREVIEW_KINDS as readonly string[]).includes(r.kind) ? (r.kind as PreviewKind) : 'other'];
    if (mine === undefined) {
      added++;
      // A record that arrives already deleted changes nothing anyone sees.
      if (!r.record.deleted) bucket.added++;
      if (r.kind === 'coder' && !r.record.deleted) newCoders.push({ id: r.record.id, name: r.record.name, color: r.record.color });
    } else if (compareHlc(mine, r.record.updated_at_hlc) < 0) {
      updated++;
      bucket.updated++;
    } else unchanged++;
  }
  return { projectName, added, updated, unchanged, byKind, newCoders };
}

/** Reads only ids and stamps (no record data), so a large project previews quickly. */
export async function localStamps(store: Store): Promise<LocalStamps> {
  const out = new Map<Kind, Map<string, string>>();
  for (const kind of KINDS) {
    const rows = await store.db.query<{ id: string; hlc: string }>(`SELECT id, hlc FROM ${TABLES[kind].table}`);
    out.set(kind, new Map(rows.map((r) => [r.id, r.hlc])));
  }
  return out;
}

export async function previewMerge(store: Store, bundle: ProjectBundle): Promise<MergePreview> {
  return classifyMerge(bundle.project.name, bundle.records, await localStamps(store));
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
