// Coding: applying codes to spans of text, removing them, resizing, recoding, autocoding search
// hits and in-vivo codes.
//
// The coding-merge rule: one coder never holds the same code twice on overlapping or touching
// spans of a document. Applying a code next to or over a span already coded with it by the same
// coder extends that coding to cover both, instead of adding a second one.

import type { Code, Coding, DocText, Document, Memo } from '../core/model/types';
import { LIMITS } from '../core/model/types';
import { expandToUnits, paragraphSpans, sentenceSpans, splitsPair, trimSpan, type Span } from '../core/qda/ranges';
import { createCode } from './codes';
import type { ProjectContext } from './context';
import { recentlyLogged } from './log';
import { combineUndo, commit, listIn, need, noopUndo, Plan, q, ServiceError, type LogSpec, type Undoable } from './undo';

export interface CodingResult {
  coding: Coding;
  /** false: an existing coding was extended (or already covered the span). */
  created: boolean;
  /** Other codings of mine absorbed into this one by the merge rule. */
  absorbed: number;
  undo: Undoable;
}

function joinComments(a: string, b: string): string {
  if (!b.trim() || a.includes(b)) return a;
  if (!a.trim()) return b;
  return `${a}\n${b}`.slice(0, LIMITS.commentMax);
}

async function codableCode(ctx: ProjectContext, codeId: string): Promise<Code> {
  const code = await need(ctx, 'code', codeId);
  if (!code.codable) throw new ServiceError('not_codable', `${code.name} only groups other codes`);
  return code;
}

/** The span clamped to the text and trimmed of whitespace; ServiceError when nothing is left. */
function cleanSpan(text: string, start: number, end: number): Span {
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new ServiceError('invalid_argument', 'bad span');
  const s = trimSpan(text, { start: Math.floor(Math.min(start, end)), end: Math.ceil(Math.max(start, end)) });
  if (!s) throw new ServiceError('empty_span', 'nothing to code in this span');
  return s;
}

/**
 * Places one span under the merge rule, within a plan. `mine` holds the current versions of
 * this coder's codings of this code in this document and is kept up to date, so several spans
 * can be placed in one plan (autocoding). `absorbed` maps codings that were merged away to the
 * one that took them over.
 */
function place(
  plan: Plan,
  mine: Coding[],
  span: Span,
  base: { document_id: string; code_id: string; coder_id: string },
  text: string,
  absorbed: Map<string, string>,
): { coding: Coding; created: boolean; absorbed: number; changed: boolean } {
  const touching = mine.filter((c) => c.start <= span.end && c.end >= span.start);
  if (!touching.length) {
    const draft = { ...base, start: span.start, end: span.end, text: text.slice(span.start, span.end), comment: '' };
    const id = plan.create('coding', draft);
    const coding = { ...draft, id } as Coding;
    mine.push(coding);
    return { coding, created: true, absorbed: 0, changed: true };
  }
  touching.sort((a, b) => a.start - b.start || (a.created_at < b.created_at ? -1 : 1));
  const keep = touching[0]!;
  let start = span.start;
  let end = span.end;
  let comment = keep.comment;
  for (const c of touching) {
    start = Math.min(start, c.start);
    end = Math.max(end, c.end);
  }
  for (const c of touching.slice(1)) {
    comment = joinComments(comment, c.comment);
    plan.remove('coding', c);
    absorbed.set(c.id, keep.id);
    mine.splice(mine.indexOf(c), 1);
  }
  const changed = start !== keep.start || end !== keep.end || comment !== keep.comment || touching.length > 1;
  let coding = keep;
  if (changed) {
    plan.change('coding', keep, { start, end, text: text.slice(start, end), comment });
    coding = { ...keep, start, end, text: text.slice(start, end), comment };
    mine[mine.indexOf(keep)] = coding;
  }
  return { coding, created: false, absorbed: touching.length - 1, changed };
}

/** Moves memos about absorbed codings to the coding that took them over. */
async function retargetMemos(ctx: ProjectContext, plan: Plan, absorbed: Map<string, string>): Promise<void> {
  if (!absorbed.size) return;
  const resolve = (id: string) => {
    let cur = id;
    for (let i = 0; absorbed.has(cur) && i <= absorbed.size; i++) cur = absorbed.get(cur)!;
    return cur;
  };
  for (const m of await listIn(ctx.store, 'memo', 'target_id', [...absorbed.keys()])) {
    if (m.target.kind === 'coding') plan.change('memo', m, { target: { kind: 'coding', id: resolve(m.target.id) } as Memo['target'] });
  }
}

const mineOf = (ctx: ProjectContext, documentId: string, codeId: string) =>
  ctx.store.list('coding', { where: 'document_id = ? AND code_id = ? AND coder_id = ?', params: [documentId, codeId, ctx.me.id] });

/**
 * Applies a code to a span of a document, as me. Leading and trailing whitespace is left out;
 * the merge rule may extend an existing coding instead of creating one.
 */
export async function applyCode(
  ctx: ProjectContext,
  input: { documentId: string; start: number; end: number; codeId: string },
): Promise<CodingResult> {
  const code = await codableCode(ctx, input.codeId);
  const doc = await need(ctx, 'document', input.documentId);
  const dt = await need(ctx, 'doctext', input.documentId);
  const span = cleanSpan(dt.text, input.start, input.end);
  const plan = new Plan();
  const absorbed = new Map<string, string>();
  const mine = await mineOf(ctx, doc.id, code.id);
  const r = place(plan, mine, span, { document_id: doc.id, code_id: code.id, coder_id: ctx.me.id }, dt.text, absorbed);
  if (!r.changed) return { coding: r.coding, created: false, absorbed: 0, undo: noopUndo('coding.add') };
  await retargetMemos(ctx, plan, absorbed);
  const summary = `${q(code.name)} → ${q(doc.name)}`;
  const { saved, undo } = await commit(ctx, plan, {
    label: 'coding.add',
    detail: summary,
    logs: [{ action: 'coding.add', summary, target: { kind: 'coding', id: r.coding.id } }],
  });
  return { coding: saved.find('coding', r.coding.id) ?? r.coding, created: r.created, absorbed: r.absorbed, undo };
}

/** Removes codings (with the memos attached to them) as one batch. */
export async function removeCoding(ctx: ProjectContext, ids: string[]): Promise<{ removed: number; undo: Undoable }> {
  const codings: Coding[] = [];
  for (const id of new Set(ids)) {
    const c = await ctx.store.get('coding', id);
    if (c && !c.deleted) codings.push(c);
  }
  if (!codings.length) return { removed: 0, undo: noopUndo('coding.remove') };
  const plan = new Plan();
  for (const m of await listIn(ctx.store, 'memo', 'target_id', codings.map((c) => c.id))) {
    if (m.target.kind === 'coding') plan.remove('memo', m);
  }
  for (const c of codings) plan.remove('coding', c);
  let summary = `×${codings.length}`;
  let target: LogSpec['target'];
  if (codings.length === 1) {
    const c = codings[0]!;
    const [code, doc] = await Promise.all([ctx.store.get('code', c.code_id), ctx.store.get('document', c.document_id)]);
    summary = `${q(code?.name ?? '?')} → ${q(doc?.name ?? '?')}`;
    target = { kind: 'coding', id: c.id };
  }
  const { undo } = await commit(ctx, plan, { label: 'coding.remove', detail: summary, logs: [{ action: 'coding.remove', summary, target }] });
  return { removed: codings.length, undo };
}

/**
 * Removes a code where the caret is: the codings of `codeId` in the document that contain
 * `pos` (edges included). Only my codings, unless `anyCoder`.
 */
export async function removeCodeAt(
  ctx: ProjectContext,
  documentId: string,
  pos: number,
  codeId: string,
  opts: { anyCoder?: boolean } = {},
): Promise<{ removed: number; undo: Undoable }> {
  const codings = await ctx.store.list('coding', {
    where: `document_id = ? AND code_id = ? AND start <= ? AND end_pos >= ?${opts.anyCoder ? '' : ' AND coder_id = ?'}`,
    params: opts.anyCoder ? [documentId, codeId, pos, pos] : [documentId, codeId, pos, pos, ctx.me.id],
  });
  return removeCoding(ctx, codings.map((c) => c.id));
}

export async function setComment(ctx: ProjectContext, id: string, comment: string): Promise<{ coding: Coding; undo: Undoable }> {
  const c = await need(ctx, 'coding', id);
  if (comment.length > LIMITS.commentMax) throw new ServiceError('too_large', `comments are up to ${LIMITS.commentMax} characters`);
  if (c.comment === comment) return { coding: c, undo: noopUndo('coding.edit') };
  const plan = new Plan();
  plan.change('coding', c, { comment });
  const code = await ctx.store.get('code', c.code_id);
  const summary = `${q(code?.name ?? '?')}: comment`;
  const logs: LogSpec[] = (await recentlyLogged(ctx, 'coding.edit', id)) ? [] : [{ action: 'coding.edit', summary, target: { kind: 'coding', id } }];
  const { saved, undo } = await commit(ctx, plan, { label: 'coding.edit', detail: summary, logs });
  return { coding: saved.get('coding', id), undo };
}

/**
 * Moves a coding to another code. If its coder already has the new code on an overlapping or
 * touching span, the two merge (the merge rule).
 */
export async function recode(ctx: ProjectContext, id: string, newCodeId: string): Promise<{ coding: Coding; undo: Undoable }> {
  const c = await need(ctx, 'coding', id);
  if (c.code_id === newCodeId) return { coding: c, undo: noopUndo('coding.edit') };
  const [oldCode, newCode] = [await ctx.store.get('code', c.code_id), await codableCode(ctx, newCodeId)];
  const plan = new Plan();
  const absorbed = new Map<string, string>();
  const others = await ctx.store.list('coding', {
    where: 'document_id = ? AND code_id = ? AND coder_id = ?',
    params: [c.document_id, newCodeId, c.coder_id],
  });
  let result: Coding;
  if (!others.some((o) => o.start <= c.end && o.end >= c.start)) {
    plan.change('coding', c, { code_id: newCodeId });
    result = { ...c, code_id: newCodeId };
  } else {
    // Fold this coding into the coder's existing coding of the new code.
    const dt = await need(ctx, 'doctext', c.document_id);
    const base = { document_id: c.document_id, code_id: newCodeId, coder_id: c.coder_id };
    const r = place(plan, others, { start: c.start, end: c.end }, base, dt.text, absorbed);
    const comment = joinComments(plan.view('coding', r.coding).comment, c.comment);
    if (comment !== plan.view('coding', r.coding).comment) plan.change('coding', r.coding, { comment });
    plan.remove('coding', c);
    absorbed.set(c.id, r.coding.id);
    result = plan.view('coding', r.coding);
  }
  await retargetMemos(ctx, plan, absorbed);
  const summary = `${q(oldCode?.name ?? '?')} → ${q(newCode.name)}`;
  const { saved, undo } = await commit(ctx, plan, { label: 'coding.edit', detail: summary, logs: [{ action: 'coding.edit', summary, target: { kind: 'coding', id: result.id } }] });
  return { coding: saved.find('coding', result.id) ?? result, undo };
}

/** Changes the span of a coding (trimmed of whitespace; merges with touching codings of its coder). */
export async function resizeCoding(ctx: ProjectContext, id: string, start: number, end: number): Promise<{ coding: Coding; undo: Undoable }> {
  const c = await need(ctx, 'coding', id);
  const dt = await need(ctx, 'doctext', c.document_id);
  const span = cleanSpan(dt.text, start, end);
  if (span.start === c.start && span.end === c.end) return { coding: c, undo: noopUndo('coding.edit') };
  const plan = new Plan();
  plan.change('coding', c, { start: span.start, end: span.end, text: dt.text.slice(span.start, span.end) });
  const self = plan.view('coding', c);
  const others = (
    await ctx.store.list('coding', { where: 'document_id = ? AND code_id = ? AND coder_id = ?', params: [c.document_id, c.code_id, c.coder_id] })
  ).filter((o) => o.id !== id);
  const absorbed = new Map<string, string>();
  // The resized coding is kept and absorbs every coding of its coder and code it now touches
  // (repeatedly: growing over one can bring it next to another).
  let result = self;
  for (let grew = true; grew; ) {
    grew = false;
    for (const o of others) {
      if (absorbed.has(o.id) || o.start > result.end || o.end < result.start) continue;
      const start = Math.min(result.start, o.start);
      const end = Math.max(result.end, o.end);
      plan.change('coding', c, { start, end, text: dt.text.slice(start, end), comment: joinComments(result.comment, o.comment) });
      plan.remove('coding', o);
      absorbed.set(o.id, id);
      result = plan.view('coding', c);
      grew = true;
    }
  }
  await retargetMemos(ctx, plan, absorbed);
  const code = await ctx.store.get('code', c.code_id);
  const summary = `${q(code?.name ?? '?')}: ${c.start}–${c.end} → ${result.start}–${result.end}`;
  const { saved, undo } = await commit(ctx, plan, { label: 'coding.edit', detail: summary, logs: [{ action: 'coding.edit', summary, target: { kind: 'coding', id } }] });
  return { coding: saved.get('coding', id), undo };
}

/** Live codings of a document by every coder, in text order. */
export async function codingsForDocument(ctx: ProjectContext, documentId: string): Promise<Coding[]> {
  return ctx.store.list('coding', { where: 'document_id = ?', params: [documentId], order: 'start, end_pos, id' });
}

export type AutocodeExpand = 'hit' | 'sentence' | 'paragraph';

export interface AutocodeResult {
  /** New codings plus extended ones. */
  count: number;
  created: number;
  extended: number;
  /** Hits already inside a coding of mine with this code. */
  skipped: number;
  undo: Undoable;
}

/**
 * Codes search hits (widened to their sentence or paragraph) with one code, as me, in one
 * batch. Hits already covered by my coding of that code are skipped; ones that overlap or
 * touch it extend it (the merge rule).
 */
export async function autocode(
  ctx: ProjectContext,
  input: { codeId: string; hits: { documentId: string; start: number; end: number }[]; expand: AutocodeExpand },
): Promise<AutocodeResult> {
  const code = await codableCode(ctx, input.codeId);
  const byDoc = new Map<string, Span[]>();
  for (const h of input.hits) {
    const list = byDoc.get(h.documentId) ?? [];
    list.push({ start: h.start, end: h.end });
    byDoc.set(h.documentId, list);
  }
  const plan = new Plan();
  const absorbed = new Map<string, string>();
  let created = 0;
  let extended = 0;
  let skipped = 0;
  for (const [docId, hits] of byDoc) {
    const doc = await ctx.store.get('document', docId);
    const dt = await ctx.store.get('doctext', docId);
    if (!doc || doc.deleted || !dt || dt.deleted) continue;
    const units = input.expand === 'sentence' ? sentenceSpans(dt.text) : input.expand === 'paragraph' ? paragraphSpans(dt.text) : null;
    const mine = await mineOf(ctx, docId, code.id);
    const originals = new Map(mine.map((c) => [c.id, c]));
    hits.sort((a, b) => a.start - b.start || a.end - b.end);
    for (const h of hits) {
      const raw = { start: Math.max(0, Math.min(h.start, dt.text.length)), end: Math.max(0, Math.min(h.end, dt.text.length)) };
      if (raw.end <= raw.start) continue;
      const span = trimSpan(dt.text, units ? expandToUnits(raw, units) : raw);
      if (!span) continue;
      if (mine.some((c) => c.start <= span.start && c.end >= span.end)) {
        skipped++;
        continue;
      }
      place(plan, mine, span, { document_id: docId, code_id: code.id, coder_id: ctx.me.id }, dt.text, absorbed);
    }
    // Count what is left once every hit is placed (a new coding may have been absorbed later).
    for (const c of mine) {
      const before = originals.get(c.id);
      if (!before) created++;
      else if (before !== c) extended++;
    }
  }
  if (plan.isEmpty) return { count: 0, created: 0, extended: 0, skipped, undo: noopUndo('coding.autocode') };
  await retargetMemos(ctx, plan, absorbed);
  const count = created + extended;
  const summary = `${q(code.name)} ×${count}`;
  const { undo } = await commit(ctx, plan, {
    label: 'coding.autocode',
    detail: summary,
    logs: [{ action: 'coding.autocode', summary, target: { kind: 'code', id: code.id } }],
  });
  return { count, created, extended, skipped, undo };
}

const IN_VIVO_MAX = 60;
const RE_EDGE_PUNCT = /^[\s"'“”‘’«»„‚‹›()[\]{}.,;:!?¿¡…–—-]+|[\s"'“”‘’«»„‚‹›()[\]{}.,;:!?¿¡…–—-]+$/gu;

/** The name an in-vivo code gets from the coded words: tidied, at most 60 characters. */
export function inVivoName(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  let name = collapsed.replace(RE_EDGE_PUNCT, '') || collapsed;
  if (name.length > IN_VIVO_MAX) {
    let cut = IN_VIVO_MAX - 1;
    if (splitsPair(name, cut)) cut--;
    const space = name.lastIndexOf(' ', cut);
    name = `${name.slice(0, space > IN_VIVO_MAX / 2 ? space : cut).trimEnd()}…`;
  }
  return name;
}

/** Creates a code named after the selected words and applies it to them. */
export async function inVivo(
  ctx: ProjectContext,
  input: { documentId: string; start: number; end: number; parent_id?: string | null },
): Promise<{ code: Code; coding: Coding; undo: Undoable }> {
  const dt: DocText = await need(ctx, 'doctext', input.documentId);
  const doc: Document = await need(ctx, 'document', input.documentId);
  const span = cleanSpan(dt.text, input.start, input.end);
  const name = inVivoName(dt.text.slice(span.start, span.end));
  const made = await createCode(ctx, { name, parent_id: input.parent_id ?? null });
  try {
    const applied = await applyCode(ctx, { documentId: doc.id, start: span.start, end: span.end, codeId: made.code.id });
    return { code: made.code, coding: applied.coding, undo: combineUndo('code.create', q(name), [made.undo, applied.undo]) };
  } catch (e) {
    await made.undo.undo().catch(() => undefined);
    throw e;
  }
}
