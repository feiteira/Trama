// Documents: creating one with its text, renaming, grouping, ordering, deleting with everything
// that points into it, and editing its text with every coding and sync point remapped.

import { sha256 } from '@noble/hashes/sha2.js';
import { toHex } from '../core/bytes';
import type { Coding, DocKind, DocSource, DocText, Document, MediaRef, SyncPoint } from '../core/model/types';
import { LIMITS } from '../core/model/types';
import { applyEdits, computeEdits, mapOffset, mapRange, normalizeEdits, splitsPair, type Assoc, type TextEdit } from '../core/qda/ranges';
import { orderAfterLast, placeBefore } from '../core/qda/tree';
import type { ProjectContext } from './context';
import {
  commit,
  listIn,
  need,
  noopUndo,
  Plan,
  q,
  restoreBatch,
  ServiceError,
  type LogSpec,
  type Undoable,
} from './undo';

// ---------------------------------------------------------------------------------------------
// Canonical text

// Characters canonical text never holds: BOMs, carriage returns, control characters other than
// tab and line feed (C0 and C1), Unicode line/paragraph separators (become line feeds) and
// unpaired surrogates (become U+FFFD: they cannot be stored as UTF-8).
const RE_NON_CANONICAL =
  /\uFEFF|\r\n?|[\u2028\u2029]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export interface Canonical {
  text: string;
  /** Where a position in the raw text lands in the canonical text. */
  mapOffset(pos: number, assoc?: Assoc): number;
}

/**
 * Canonical form of a document's text: no BOM, LF line endings, NFC, no control characters
 * except tab and line feed. Offsets into the raw text can be carried over with `mapOffset`
 * (sync points of an imported transcript, say).
 */
export function canonicalise(raw: string): Canonical {
  const stage1: TextEdit[] = [];
  const t1 = raw.replace(RE_NON_CANONICAL, (m: string, offset: number) => {
    let insert = '';
    if (m === '\r\n') {
      stage1.push({ start: offset, end: offset + 1, insert: '' });
      return '\n';
    }
    if (m === '\r' || m === '\u2028' || m === '\u2029') insert = '\n';
    else if (m.length === 1 && m.charCodeAt(0) >= 0xd800 && m.charCodeAt(0) <= 0xdfff) insert = '\uFFFD';
    stage1.push({ start: offset, end: offset + m.length, insert });
    return insert;
  });
  // NFC never combines across a line feed, so lines can be normalised one by one: an edit list
  // stays exact (and cheap) even for a long text written in decomposed form.
  const stage2: TextEdit[] = [];
  let text = t1;
  if (t1.normalize('NFC') !== t1) {
    const out: string[] = [];
    let at = 0;
    for (const line of t1.split('\n')) {
      const n = line.normalize('NFC');
      if (n !== line) {
        let p = 0;
        const min = Math.min(n.length, line.length);
        while (p < min && n.charCodeAt(p) === line.charCodeAt(p)) p++;
        // Back up so a base character and its marks are replaced together, never splitting
        // a surrogate pair.
        if (p > 0) p--;
        if (splitsPair(line, p)) p--;
        let s = 0;
        while (s < min - p && n.charCodeAt(n.length - 1 - s) === line.charCodeAt(line.length - 1 - s)) s++;
        if (s > 0) s--;
        if (splitsPair(line, line.length - s)) s--;
        stage2.push({ start: at + p, end: at + line.length - s, insert: n.slice(p, n.length - s) });
      }
      out.push(n);
      at += line.length + 1;
    }
    text = out.join('\n');
  }
  const e1 = normalizeEdits(stage1);
  const e2 = normalizeEdits(stage2);
  return {
    text,
    mapOffset: (pos, assoc = 'before') => Math.min(text.length, Math.max(0, mapOffset(mapOffset(pos, e1, assoc), e2, assoc))),
  };
}

export function canonicalText(raw: string): string {
  return canonicalise(raw).text;
}

const textSha256 = (text: string) => toHex(sha256(new TextEncoder().encode(text)));

// ---------------------------------------------------------------------------------------------
// Names

const tidyName = (s: string) => s.replace(/\s+/g, ' ').trim();
const nameKey = (s: string) => tidyName(s).normalize('NFC').toLocaleLowerCase();

/**
 * `name`, or `name (2)`, `name (3)`… when it is already taken (case-insensitively). A name that
 * already ends in a number in brackets counts on from it. Stays within `max` characters.
 */
export function uniqueName(name: string, taken: Iterable<string>, max: number = LIMITS.nameMax): string {
  const clean = tidyName(name).slice(0, max).trim();
  const keys = new Set([...taken].map(nameKey));
  if (!keys.has(nameKey(clean))) return clean;
  const m = /^(.*?) \((\d{1,6})\)$/.exec(clean);
  const base = m ? m[1]! : clean;
  for (let n = m ? Number(m[2]) + 1 : 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, max - suffix.length).trimEnd()}${suffix}`;
    if (!keys.has(nameKey(candidate))) return candidate;
  }
}

function requireName(name: string): string {
  const t = tidyName(name);
  if (!t) throw new ServiceError('invalid_argument', 'a name is required');
  return t;
}

// ---------------------------------------------------------------------------------------------
// Create, read, update

export interface FileInput {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}

export interface NewDocument {
  name: string;
  kind: DocKind;
  text: string;
  /** Transcript timestamps, as offsets into `text` (they follow its canonicalisation). */
  sync?: SyncPoint[];
  source?: { filename: string; format: string; imported_at?: string };
  original?: FileInput;
  media?: FileInput;
  case_id?: string | null;
  group_ids?: string[];
  color?: string | null;
}

export async function createDocument(ctx: ProjectContext, input: NewDocument): Promise<{ document: Document; undo: Undoable }> {
  const name = requireName(input.name);
  const canon = canonicalise(input.text);
  const text = canon.text;
  if (text.length > LIMITS.textMax) throw new ServiceError('too_large', 'the text is too long');
  for (const f of [input.original, input.media]) {
    if (f && f.bytes.length > LIMITS.mediaMaxBytes) throw new ServiceError('too_large', 'the file is too large');
  }
  if (input.case_id) await need(ctx, 'case', input.case_id);
  for (const g of input.group_ids ?? []) await need(ctx, 'docgroup', g);

  const docs = await ctx.store.list('document');
  const sync = (input.sync ?? [])
    .filter((s) => Number.isFinite(s.pos) && Number.isFinite(s.ms))
    .map((s) => ({ pos: canon.mapOffset(Math.max(0, Math.floor(s.pos))), ms: Math.max(0, Math.round(s.ms)) }));
  const source: DocSource = {
    filename: input.source?.filename ?? '',
    format: (input.source?.format ?? 'new').toLowerCase(),
    imported_at: input.source?.imported_at ?? new Date().toISOString(),
    text_sha256: textSha256(text),
  };

  const blobs: MediaRef[] = [];
  try {
    const original = input.original ? await ctx.addBlob(input.original.bytes, input.original.filename, input.original.mime) : null;
    if (original) blobs.push(original);
    const media = input.media ? await ctx.addBlob(input.media.bytes, input.media.filename, input.media.mime) : null;
    if (media) blobs.push(media);

    const plan = new Plan();
    const docName = uniqueName(name, docs.map((d) => d.name));
    const id = plan.create('document', {
      name: docName,
      kind: input.kind,
      group_ids: [...new Set(input.group_ids ?? [])],
      case_id: input.case_id ?? null,
      source,
      original,
      media,
      chars: text.length,
      order: orderAfterLast(docs),
      color: input.color ?? null,
    });
    plan.create('doctext', { id, text, sync });
    const { saved, undo } = await commit(ctx, plan, {
      label: 'document.add',
      detail: q(docName),
      logs: [{ action: 'document.add', summary: q(docName), target: { kind: 'document', id } }],
    });
    return { document: saved.get('document', id), undo };
  } catch (e) {
    // Nothing points to the files: do not leave them behind.
    for (const b of blobs) await ctx.removeBlob(b).catch(() => undefined);
    throw e;
  }
}

/** A document's text and sync points. */
export async function getText(ctx: ProjectContext, id: string): Promise<DocText> {
  return need(ctx, 'doctext', id);
}

export async function renameDocument(ctx: ProjectContext, id: string, name: string): Promise<{ document: Document; undo: Undoable }> {
  const doc = await need(ctx, 'document', id);
  const others = (await ctx.store.list('document')).filter((d) => d.id !== id).map((d) => d.name);
  const next = uniqueName(requireName(name), others);
  if (next === doc.name) return { document: doc, undo: noopUndo('document.rename') };
  const plan = new Plan();
  plan.change('document', doc, { name: next });
  const summary = `${q(doc.name)} → ${q(next)}`;
  const { saved, undo } = await commit(ctx, plan, {
    label: 'document.rename',
    detail: summary,
    logs: [{ action: 'document.rename', summary, target: { kind: 'document', id } }],
  });
  return { document: saved.get('document', id), undo };
}

export async function setDocumentCase(ctx: ProjectContext, id: string, caseId: string | null): Promise<{ document: Document; undo: Undoable }> {
  const doc = await need(ctx, 'document', id);
  const c = caseId ? await need(ctx, 'case', caseId) : null;
  if (doc.case_id === caseId) return { document: doc, undo: noopUndo('document.edit') };
  const plan = new Plan();
  plan.change('document', doc, { case_id: caseId });
  const summary = `${q(doc.name)} → ${c ? q(c.name) : '∅'}`;
  const { saved, undo } = await commit(ctx, plan, {
    label: 'document.edit',
    detail: summary,
    logs: [{ action: 'document.edit', summary, target: { kind: 'document', id } }],
  });
  return { document: saved.get('document', id), undo };
}

export async function setDocumentGroups(ctx: ProjectContext, id: string, groupIds: string[]): Promise<{ document: Document; undo: Undoable }> {
  const doc = await need(ctx, 'document', id);
  const groups = [];
  for (const g of new Set(groupIds)) groups.push(await need(ctx, 'docgroup', g));
  const ids = groups.map((g) => g.id);
  if (ids.length === doc.group_ids.length && ids.every((g) => doc.group_ids.includes(g))) {
    return { document: doc, undo: noopUndo('group.edit') };
  }
  const plan = new Plan();
  plan.change('document', doc, { group_ids: ids });
  const summary = `${q(doc.name)} → ${groups.map((g) => q(g.name)).join(', ') || '∅'}`;
  const { saved, undo } = await commit(ctx, plan, {
    label: 'group.edit',
    detail: summary,
    logs: [{ action: 'document.edit', summary, target: { kind: 'document', id } }],
  });
  return { document: saved.get('document', id), undo };
}

export async function setDocumentColor(ctx: ProjectContext, id: string, color: string | null): Promise<{ document: Document; undo: Undoable }> {
  const doc = await need(ctx, 'document', id);
  const plan = new Plan();
  plan.change('document', doc, { color });
  const { saved, undo } = await commit(ctx, plan, { label: 'document.edit', detail: q(doc.name), logs: [] });
  return { document: saved.get('document', id), undo };
}

/** Moves a document just before `beforeId` in the list (or to the end, for null). */
export async function reorderDocument(ctx: ProjectContext, id: string, beforeId: string | null): Promise<Undoable> {
  const doc = await need(ctx, 'document', id);
  if (beforeId === id) return noopUndo('document.order');
  const docs = await ctx.store.list('document');
  const { order, renumber } = placeBefore(docs, id, beforeId);
  const plan = new Plan();
  if (renumber) {
    for (const d of docs) {
      const o = renumber.get(d.id);
      if (o !== undefined && o !== d.order) plan.change('document', d, { order: o });
    }
  } else plan.change('document', doc, { order });
  if (plan.isEmpty) return noopUndo('document.order');
  // Reordering is not an analytical change: it is not logged.
  return (await commit(ctx, plan, { label: 'document.order', detail: q(doc.name), logs: [] })).undo;
}

// ---------------------------------------------------------------------------------------------
// Delete and restore

export interface DeletedDocuments {
  /** The delete batch (for "recently deleted" and `restoreDocuments`). */
  batch: string;
  documents: number;
  codings: number;
  memos: number;
  undo: Undoable;
}

/**
 * Deletes documents with their text, codings and the memos attached to them or to their
 * codings, as one batch. Files (original, media) stay until the delete is made final.
 */
export async function deleteDocuments(ctx: ProjectContext, ids: string[]): Promise<DeletedDocuments> {
  const docs = [];
  for (const id of new Set(ids)) {
    const d = await ctx.store.get('document', id);
    if (d && !d.deleted) docs.push(d);
  }
  const plan = new Plan();
  const docIds = docs.map((d) => d.id);
  const codings = await listIn(ctx.store, 'coding', 'document_id', docIds);
  const memos = [
    ...(await listIn(ctx.store, 'memo', 'target_id', docIds)).filter((m) => m.target.kind === 'document'),
    ...(await listIn(ctx.store, 'memo', 'target_id', codings.map((c) => c.id))).filter((m) => m.target.kind === 'coding'),
  ];
  for (const m of memos) plan.remove('memo', m);
  for (const c of codings) plan.remove('coding', c);
  for (const d of docs) {
    const t = await ctx.store.get('doctext', d.id);
    if (t && !t.deleted) plan.remove('doctext', t);
    plan.remove('document', d);
  }
  const logs: LogSpec[] = docs.map((d) => ({ action: 'document.delete', summary: q(d.name), target: { kind: 'document', id: d.id } }));
  const { batch, undo } = await commit(ctx, plan, {
    label: 'document.delete',
    detail: docs.map((d) => q(d.name)).join(', '),
    logs,
  });
  return { batch, documents: docs.length, codings: codings.length, memos: memos.length, undo };
}

/** Brings back what one `deleteDocuments` removed (from "recently deleted"). */
export async function restoreDocuments(ctx: ProjectContext, batch: string): Promise<{ documents: number; codings: number; memos: number }> {
  const restored = await restoreBatch(ctx, batch, ['document', 'doctext', 'coding', 'memo']);
  const docIds = restored.get('document') ?? [];
  for (const id of docIds) {
    const d = await ctx.store.get('document', id);
    if (d) await ctx.log('document.restore', q(d.name), { kind: 'document', id });
  }
  return { documents: docIds.length, codings: restored.get('coding')?.length ?? 0, memos: restored.get('memo')?.length ?? 0 };
}

// ---------------------------------------------------------------------------------------------
// Editing the text

export interface TextEditResult {
  /** Codings left with no text, removed. */
  removedCodings: number;
  /** Codings whose position or text changed. */
  remappedCodings: number;
  edits: TextEdit[];
  undo: Undoable;
}

/**
 * Replaces a document's text (canonicalised first). Every coding is remapped through the
 * change so it stays on the same words, its `text` refreshed; codings left empty are removed
 * with their memos; sync points move along.
 */
export async function editDocumentText(ctx: ProjectContext, id: string, newText: string): Promise<TextEditResult> {
  const dt = await need(ctx, 'doctext', id);
  const text = canonicalText(newText);
  if (text.length > LIMITS.textMax) throw new ServiceError('too_large', 'the text is too long');
  return applyTextEdits(ctx, id, computeEdits(dt.text, text), { current: dt });
}

/**
 * Applies edits (in the coordinates of the current text) to a document, remapping codings and
 * sync points. Used by `editDocumentText` and by pseudonymisation, which knows its edits.
 * `log: false` leaves the logging to the caller.
 */
export async function applyTextEdits(
  ctx: ProjectContext,
  id: string,
  rawEdits: readonly TextEdit[],
  opts: { log?: boolean; current?: DocText } = {},
): Promise<TextEditResult> {
  const doc = await need(ctx, 'document', id);
  const dt = opts.current ?? (await need(ctx, 'doctext', id));
  const edits = normalizeEdits(rawEdits);
  const text = applyEdits(dt.text, edits);
  if (!edits.length || text === dt.text) {
    return { removedCodings: 0, remappedCodings: 0, edits: [], undo: noopUndo('document.edit', q(doc.name)) };
  }
  if (text.length > LIMITS.textMax) throw new ServiceError('too_large', 'the text is too long');
  const plan = new Plan();
  const sync = dt.sync.map((s) => ({ pos: Math.min(text.length, mapOffset(s.pos, edits, 'before')), ms: s.ms }));
  plan.change('doctext', dt, { text, sync });
  plan.change('document', doc, { chars: text.length });

  const codings = await ctx.store.list('coding', { where: 'document_id = ?', params: [id] });
  const removed: Coding[] = [];
  let remapped = 0;
  for (const c of codings) {
    const r = mapRange(c, edits);
    if (!r) {
      removed.push(c);
      plan.remove('coding', c);
      continue;
    }
    const t = text.slice(r.start, r.end);
    if (r.start !== c.start || r.end !== c.end || t !== c.text) {
      plan.change('coding', c, { start: r.start, end: r.end, text: t });
      remapped++;
    }
  }
  if (removed.length) {
    for (const m of await listIn(ctx.store, 'memo', 'target_id', removed.map((c) => c.id))) {
      if (m.target.kind === 'coding') plan.remove('memo', m);
    }
  }
  const logs: LogSpec[] = [];
  if (opts.log !== false) {
    logs.push({ action: 'document.edit', summary: `${q(doc.name)} ×${edits.length}`, target: { kind: 'document', id } });
    if (removed.length) logs.push({ action: 'coding.remove', summary: `${q(doc.name)} ×${removed.length}`, target: { kind: 'document', id } });
  }
  const { undo } = await commit(ctx, plan, { label: 'document.edit', detail: q(doc.name), logs });
  return { removedCodings: removed.length, remappedCodings: remapped, edits, undo };
}

// ---------------------------------------------------------------------------------------------
// Files

export type FileSlot = 'media' | 'original';

/**
 * Attaches (or replaces) the recording of a transcript, or the original file. The previous
 * file is removed once the document points to the new one. Not undoable: files are large.
 */
export async function attachMedia(ctx: ProjectContext, id: string, file: FileInput, slot: FileSlot = 'media'): Promise<MediaRef> {
  const doc = await need(ctx, 'document', id);
  if (file.bytes.length > LIMITS.mediaMaxBytes) throw new ServiceError('too_large', 'the file is too large');
  const ref = await ctx.addBlob(file.bytes, file.filename, file.mime);
  try {
    await ctx.store.update('document', id, { [slot]: ref } as Partial<Document>);
  } catch (e) {
    await ctx.removeBlob(ref).catch(() => undefined);
    throw e;
  }
  const old = doc[slot];
  if (old && old.blob_id !== ref.blob_id) await ctx.removeBlob(old).catch(() => undefined);
  await ctx.log('document.edit', `${q(doc.name)} ← ${file.mime || '?'}`, { kind: 'document', id });
  return ref;
}

/** Detaches and erases the recording (or original file) of a document. Not undoable. */
export async function detachMedia(ctx: ProjectContext, id: string, slot: FileSlot = 'media'): Promise<void> {
  const doc = await need(ctx, 'document', id);
  const old = doc[slot];
  if (!old) return;
  await ctx.store.update('document', id, { [slot]: null } as Partial<Document>);
  await ctx.removeBlob(old).catch(() => undefined);
  await ctx.log('document.edit', `${q(doc.name)} − ${old.mime || '?'}`, { kind: 'document', id });
}

// ---------------------------------------------------------------------------------------------
// Statistics

export interface DocumentStats {
  chars: number;
  words: number;
  paragraphs: number;
  codings: number;
  /** Distinct codes applied. */
  codes: number;
  /** Distinct coders who coded it. */
  coders: number;
  memos: number;
  /** Characters covered by at least one coding. */
  codedChars: number;
  /** codedChars / chars (0 for an empty document). */
  coverage: number;
}

export async function documentStats(ctx: ProjectContext, id: string): Promise<DocumentStats> {
  const dt = await need(ctx, 'doctext', id);
  const codings = await ctx.store.list('coding', { where: 'document_id = ?', params: [id], order: 'start, end_pos' });
  const memos = await ctx.store.count('memo', "target_kind = 'document' AND target_id = ?", [id]);
  let words = 0;
  const re = /[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*/gu;
  while (re.exec(dt.text)) words++;
  let paragraphs = 0;
  for (const p of dt.text.split('\n')) if (p.trim()) paragraphs++;
  let covered = 0;
  let reach = 0;
  for (const c of codings) {
    const s = Math.max(c.start, reach);
    if (c.end > s) covered += c.end - s;
    reach = Math.max(reach, c.end);
  }
  return {
    chars: dt.text.length,
    words,
    paragraphs,
    codings: codings.length,
    codes: new Set(codings.map((c) => c.code_id)).size,
    coders: new Set(codings.map((c) => c.coder_id)).size,
    memos,
    codedChars: covered,
    coverage: dt.text.length ? covered / dt.text.length : 0,
  };
}
