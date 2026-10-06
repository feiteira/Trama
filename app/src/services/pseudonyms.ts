// Pseudonymisation: the key (original → replacement), suggestions of names to review, a preview
// of what would change, and applying it across every document with codings remapped.
//
// The key is personal data. It never goes into the audit log (which is exported): logs say how
// many replacements were made in which documents, never what was replaced.

import type { Case, Document, Pseudonym } from '../core/model/types';
import { LIMITS } from '../core/model/types';
import { findMatches, planFileName, planText, pseudonymiseText } from '../core/qda/pseudonymise';
import { replaceAll } from '../core/qda/ranges';
import type { ProjectContext } from './context';
import { applyTextEdits, uniqueName } from './documents';
import { combineUndo, commit, need, noopUndo, Plan, q, ServiceError, undoKey, type Undoable } from './undo';

// ---------------------------------------------------------------------------------------------
// The key

export interface NewPseudonym {
  original: string;
  replacement: string;
  note?: string;
  whole_word?: boolean;
  case_sensitive?: boolean;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const tidy = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

async function checkUnique(ctx: ProjectContext, original: string, exceptId?: string): Promise<void> {
  const o = tidy(original);
  if (!o) throw new ServiceError('invalid_argument', 'the original is required');
  for (const p of await ctx.store.list('pseudonym')) {
    if (p.id !== exceptId && tidy(p.original) === o) throw new ServiceError('invalid_argument', 'this original is already in the key');
  }
}

export async function createPseudonym(ctx: ProjectContext, input: NewPseudonym): Promise<{ pseudonym: Pseudonym; undo: Undoable }> {
  await checkUnique(ctx, input.original);
  const plan = new Plan();
  const id = plan.create('pseudonym', {
    original: tidy(input.original),
    replacement: tidy(input.replacement),
    note: input.note ?? '',
    whole_word: input.whole_word ?? true,
    case_sensitive: input.case_sensitive ?? true,
    applied_at: null,
    applied_count: 0,
  });
  const { saved, undo } = await commit(ctx, plan, { label: 'pseudonym.edit', detail: '', logs: [] });
  return { pseudonym: saved.get('pseudonym', id), undo };
}

export async function updatePseudonym(
  ctx: ProjectContext,
  id: string,
  patch: Partial<Pick<Pseudonym, 'original' | 'replacement' | 'note' | 'whole_word' | 'case_sensitive'>>,
): Promise<{ pseudonym: Pseudonym; undo: Undoable }> {
  const p = await need(ctx, 'pseudonym', id);
  if (patch.original !== undefined) await checkUnique(ctx, patch.original, id);
  const clean = { ...patch };
  if (clean.original !== undefined) clean.original = tidy(clean.original);
  if (clean.replacement !== undefined) clean.replacement = tidy(clean.replacement);
  const plan = new Plan();
  plan.change('pseudonym', p, clean);
  const { saved, undo } = await commit(ctx, plan, { label: 'pseudonym.edit', detail: '', logs: [] });
  return { pseudonym: saved.get('pseudonym', id), undo };
}

/**
 * Deletes an entry of the key. With `erase`, its content is wiped from the database at once
 * (not undoable): a deleted key entry would otherwise keep the original name in its tombstone.
 * The Undoable returned then carries `forget`: recording it on the UndoManager drops every
 * earlier step about this entry (creating or editing it), which hold the name in memory and
 * could otherwise bring it back. The store refuses to write over the erased record anyway.
 */
export async function deletePseudonym(ctx: ProjectContext, id: string, opts: { erase?: boolean } = {}): Promise<Undoable> {
  const p = await need(ctx, 'pseudonym', id);
  const plan = new Plan();
  plan.remove('pseudonym', p);
  const { undo } = await commit(ctx, plan, { label: 'pseudonym.edit', detail: '', logs: [] });
  if (!opts.erase) return undo;
  await ctx.store.scrub('pseudonym', [id], (r) => ({
    original: '∅',
    replacement: '∅',
    note: '',
    whole_word: r.whole_word,
    case_sensitive: r.case_sensitive,
    applied_at: null,
    applied_count: 0,
  }));
  return { ...noopUndo('pseudonym.edit'), forget: [undoKey('pseudonym', id)] };
}

/** The key, sorted by original. */
export async function listPseudonyms(ctx: ProjectContext): Promise<Pseudonym[]> {
  return (await ctx.store.list('pseudonym')).sort((a, b) => collator.compare(a.original, b.original));
}

// ---------------------------------------------------------------------------------------------
// Matching

export { findMatches } from '../core/qda/pseudonymise';
async function selected(ctx: ProjectContext, ids?: string[]): Promise<Pseudonym[]> {
  const all = await ctx.store.list('pseudonym');
  if (!ids) return all;
  const want = new Set(ids);
  return all.filter((p) => want.has(p.id));
}

export interface PreviewSample {
  pseudonymId: string;
  before: string;
  match: string;
  after: string;
}

export interface PreviewDocument {
  documentId: string;
  name: string;
  count: number;
  /** Up to 3 places with some context, for the researcher to check. */
  samples: PreviewSample[];
}

/** Where an original occurs outside document texts: a name, a comment, a memo, a definition. */
export type FieldKind = 'document' | 'case' | 'coding' | 'memo' | 'code' | 'docgroup';

export interface PreviewField {
  kind: FieldKind;
  id: string;
  /** The field: name, description, comment, title, body, inclusion, exclusion, example, or `values.<attribute id>`. */
  field: string;
  /** What the record is called (its name or title as it is now), to show it. */
  label: string;
  count: number;
  sample: PreviewSample;
}

export interface Preview {
  documents: PreviewDocument[];
  /**
   * Hits outside document texts, replaced by `apply` too: document, case, code and group names,
   * case descriptions and text attribute values, code definitions, segment comments, memos.
   */
  fields: PreviewField[];
  /** Replacements per pseudonym id (texts and fields). */
  counts: Map<string, number>;
  /** Every replacement: in document texts and in fields. */
  total: number;
  /** Replacements in document texts. */
  textTotal: number;
  /**
   * Audit-trail entries that mention an original. The trail is never edited: they keep the name
   * (and travel in .trama copies of the project).
   */
  logEntries: number;
}

const CONTEXT = 40;

interface FieldHit {
  kind: FieldKind;
  record: { id: string };
  field: string;
  label: string;
  value: string;
  planned: ReturnType<typeof planText>;
}

/**
 * Free-text fields outside document texts that hold an original of the rules: names,
 * descriptions, comments, memos, definitions, and the file names a document keeps (its source
 * file, original and recording). `only` limits it to some records (`kind:id`).
 */
async function fieldHits(ctx: ProjectContext, rules: readonly Pseudonym[], opts: { only?: ReadonlySet<string>; protect?: boolean } = {}): Promise<FieldHit[]> {
  const out: FieldHit[] = [];
  const { only, protect } = opts;
  const look = (kind: FieldKind, record: { id: string }, label: string, field: string, value: unknown) => {
    if (typeof value !== 'string' || !value) return;
    if (only && !only.has(`${kind}:${record.id}`)) return;
    const planned = field.endsWith('filename') ? planFileName(value, rules) : planText(value, rules, { protect });
    if (planned.matches.length) out.push({ kind, record, field, label, value, planned });
  };
  for (const d of await ctx.store.list('document', { order: 'sort, id' })) {
    look('document', d, d.name, 'name', d.name);
    look('document', d, d.name, 'source.filename', d.source?.filename);
    look('document', d, d.name, 'original.filename', d.original?.filename);
    look('document', d, d.name, 'media.filename', d.media?.filename);
  }
  const textAttributes = new Set((await ctx.store.list('attribute')).filter((a) => a.type === 'text').map((a) => a.id));
  for (const c of await ctx.store.list('case')) {
    look('case', c, c.name, 'name', c.name);
    look('case', c, c.name, 'description', c.description);
    for (const [k, v] of Object.entries(c.values)) if (textAttributes.has(k)) look('case', c, c.name, `values.${k}`, v);
  }
  for (const c of await ctx.store.list('code')) {
    for (const f of ['name', 'description', 'inclusion', 'exclusion', 'example'] as const) look('code', c, c.name, f, c[f]);
  }
  for (const g of await ctx.store.list('docgroup')) look('docgroup', g, g.name, 'name', g.name);
  for (const c of await ctx.store.list('coding', { where: "json_extract(data, '$.comment') != ''" })) look('coding', c, c.text.slice(0, 60), 'comment', c.comment);
  for (const m of await ctx.store.list('memo')) {
    look('memo', m, m.title, 'title', m.title);
    look('memo', m, m.title, 'body', m.body);
  }
  return out;
}

async function logMentions(ctx: ProjectContext, rules: readonly Pseudonym[]): Promise<number> {
  let n = 0;
  for (const l of await ctx.store.list('log')) if (rules.some((r) => findMatches(l.summary, r).length > 0)) n++;
  return n;
}

/** What applying the key (or some entries of it) would replace, per document. Changes nothing. */
export async function preview(
  ctx: ProjectContext,
  pseudonymIds?: string[],
  opts: { appliedOnly?: boolean; only?: ReadonlySet<string>; protect?: boolean } = {},
): Promise<Preview> {
  const { only, protect } = opts;
  const rules = (await selected(ctx, pseudonymIds)).filter((p) => !opts.appliedOnly || p.applied_at !== null);
  const counts = new Map<string, number>();
  const documents: PreviewDocument[] = [];
  let total = 0;
  if (!rules.length) return { documents, fields: [], counts, total, textTotal: 0, logEntries: 0 };
  for (const doc of await ctx.store.list('document', { order: 'sort, id' })) {
    if (only && !only.has(`document:${doc.id}`)) continue;
    const dt = await ctx.store.get('doctext', doc.id);
    if (!dt || dt.deleted) continue;
    const plan = planText(dt.text, rules, { protect });
    if (!plan.matches.length) continue;
    for (const [id, n] of plan.counts) counts.set(id, (counts.get(id) ?? 0) + n);
    total += plan.matches.length;
    documents.push({
      documentId: doc.id,
      name: doc.name,
      count: plan.matches.length,
      samples: plan.matches.slice(0, 3).map((m) => ({
        pseudonymId: m.pseudonymId,
        before: dt.text.slice(Math.max(0, m.start - CONTEXT), m.start),
        match: dt.text.slice(m.start, m.end),
        after: dt.text.slice(m.end, m.end + CONTEXT),
      })),
    });
  }
  const textTotal = total;
  const fields: PreviewField[] = [];
  for (const h of await fieldHits(ctx, rules, { only, protect })) {
    for (const [id, n] of h.planned.counts) counts.set(id, (counts.get(id) ?? 0) + n);
    total += h.planned.matches.length;
    const m = h.planned.matches[0]!;
    fields.push({
      kind: h.kind,
      id: h.record.id,
      field: h.field,
      label: h.label,
      count: h.planned.matches.length,
      sample: {
        pseudonymId: m.pseudonymId,
        before: h.value.slice(Math.max(0, m.start - CONTEXT), m.start),
        match: h.value.slice(m.start, m.end),
        after: h.value.slice(m.end, m.end + CONTEXT),
      },
    });
  }
  return { documents, fields, counts, total, textTotal, logEntries: only ? 0 : await logMentions(ctx, rules) };
}

export interface ApplyResult {
  /** Every replacement made: in document texts and in fields. */
  replacements: number;
  documents: number;
  /** Replacements made outside document texts (names, comments, memos, definitions, file names). */
  fieldReplacements: number;
  /** Codings removed because their whole text was replaced by nothing (never with a non-empty replacement). */
  removedCodings: number;
  undo: Undoable;
}

export interface ApplyOptions {
  /** Called with how many documents are done out of how many, before the first and after each; awaited. */
  onProgress?: (done: number, total: number) => void | Promise<void>;
}

/** Meta key held while `apply` runs: which documents are done, so an interruption is known. */
export const APPLY_PENDING = 'pseudonym.apply.pending';

/** What an `apply` cut short (a lock, the window closed) left: see `interruptedApply`. */
export interface InterruptedApply {
  /** When it started. */
  at: string;
  /** Documents whose text was pseudonymised before it stopped. */
  documents: number;
  /** Whether the interruption is in the audit trail already. */
  logged: boolean;
}

/**
 * Replaces the originals by their replacements across every document, then in every other
 * free-text field and file name, as one undo step. Each document is edited through
 * `applyTextEdits`, so codings stay on their words (and their text shows the replacement) and
 * transcript timestamps move along. Each document is written on its own, so a meta key
 * (`APPLY_PENDING`) records progress: an apply cut short is known (`interruptedApply`) and
 * logged when the project next opens.
 */
export async function apply(ctx: ProjectContext, pseudonymIds?: string[], opts: ApplyOptions = {}): Promise<ApplyResult> {
  const rules = await selected(ctx, pseudonymIds);
  if (!rules.length) return { replacements: 0, documents: 0, fieldReplacements: 0, removedCodings: 0, undo: noopUndo('pseudonym.apply') };
  return pseudonymise(ctx, rules, { ...opts, markApplied: true });
}

/** What `reapplyKey` replaced, where (never what). */
export interface ReappliedHit {
  kind: FieldKind | 'text';
  id: string;
  /** For 'text' the document's id; else the field, as in `PreviewField`. */
  field: string;
  /** What the record is called now (pseudonymised). */
  label: string;
}

export interface ReapplyResult {
  replacements: number;
  hits: ReappliedHit[];
  undo: Undoable;
}

/**
 * Applies the entries of the key that were applied already to some records again: records a
 * merge brought in or back, or a restore brought back, may hold text from before the key was
 * applied (a teammate's older copy, the trash). `records` are `kind:id` keys; for a document,
 * its name, file names and text. Text that already reads as a replacement is left alone. Logged
 * (never naming what was replaced); returns where replacements were made.
 */
export async function reapplyKey(ctx: ProjectContext, records: Iterable<string>, reason: 'merge' | 'restore'): Promise<ReapplyResult> {
  const only = new Set(records);
  const rules = (await ctx.store.list('pseudonym')).filter((p) => p.applied_at !== null);
  if (!rules.length || !only.size) return { replacements: 0, hits: [], undo: noopUndo('pseudonym.apply') };
  const hits: ReappliedHit[] = [];
  const r = await pseudonymise(ctx, rules, { markApplied: false, only, protect: true, hits, reason });
  return { replacements: r.replacements, hits, undo: r.undo };
}

/** What an interrupted `apply` left (null when the last one finished). */
export async function interruptedApply(ctx: ProjectContext): Promise<InterruptedApply | null> {
  const raw = await ctx.store.getMeta(APPLY_PENDING);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { at?: string; done?: string[]; logged?: boolean };
    return { at: o.at ?? '', documents: o.done?.length ?? 0, logged: !!o.logged };
  } catch {
    return { at: '', documents: 0, logged: false };
  }
}

/**
 * Writes the audit-trail entry for an `apply` that was cut short, once (called when a project
 * opens). The notice stays (`interruptedApply`) until the key is applied again to the end.
 */
export async function logInterruptedApply(ctx: ProjectContext): Promise<boolean> {
  const raw = await ctx.store.getMeta(APPLY_PENDING);
  if (!raw) return false;
  let o: { at?: string; done?: string[]; logged?: boolean; summary?: string } = {};
  try {
    o = JSON.parse(raw) as typeof o;
  } catch {
    // A damaged note is still an interruption.
  }
  if (o.logged) return false;
  const summary = `⚠ ×${o.done?.length ?? 0} → ${o.summary || '∅'} (interrupted)`;
  const puts = ctx.logRecord ? [{ kind: 'log' as const, draft: ctx.logRecord('pseudonym.apply', summary) }] : [];
  await ctx.store.write({ puts, meta: [{ key: APPLY_PENDING, value: JSON.stringify({ ...o, logged: true }) }] });
  if (!ctx.logRecord) await ctx.log('pseudonym.apply', summary);
  return true;
}

async function pseudonymise(
  ctx: ProjectContext,
  rules: Pseudonym[],
  opts: ApplyOptions & { markApplied: boolean; only?: ReadonlySet<string>; protect?: boolean; hits?: ReappliedHit[]; reason?: string },
): Promise<ApplyResult> {
  const counts = new Map<string, number>();
  const parts: Undoable[] = [];
  const docNames: string[] = [];
  const done: string[] = [];
  let replacements = 0;
  let removedCodings = 0;
  const { only, protect } = opts;
  const docs = (await ctx.store.list('document', { order: 'sort, id' })).filter((d) => !only || only.has(`document:${d.id}`));
  const at = new Date().toISOString();
  const shownNames = () => docNames.slice(0, 5).map((n) => q(pseudonymiseText(n, rules, { protect }))).join(', ') + (docNames.length > 5 ? ', …' : '');
  const pending = () => (opts.markApplied ? [{ key: APPLY_PENDING, value: JSON.stringify({ at, done, summary: shownNames() }) }] : undefined);
  await opts.onProgress?.(0, docs.length);
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!;
    const dt = await ctx.store.get('doctext', doc.id);
    const planned = dt && !dt.deleted ? planText(dt.text, rules, { protect }) : null;
    if (dt && planned?.matches.length) {
      const { edits } = replaceAll(dt.text, planned.edits);
      for (const [id, n] of planned.counts) counts.set(id, (counts.get(id) ?? 0) + n);
      replacements += planned.matches.length;
      docNames.push(doc.name);
      done.push(doc.id);
      if (edits.length) {
        const r = await applyTextEdits(ctx, doc.id, edits, { log: false, current: dt, extraMeta: pending() });
        parts.push(r.undo);
        removedCodings += r.removedCodings;
      }
      opts.hits?.push({ kind: 'text', id: doc.id, field: doc.id, label: pseudonymiseText(doc.name, rules, { protect }) });
    }
    // The last step reports once the key's entries are marked applied too.
    if (i + 1 < docs.length) await opts.onProgress?.(i + 1, docs.length);
  }
  // Then every other free-text field, in the same undo step: names, comments, memos, definitions,
  // file names. Codings' own text already follows their document's text (applyTextEdits).
  const plan = new Plan();
  let fieldReplacements = 0;
  const hits = await fieldHits(ctx, rules, { only, protect });
  const docNamesTaken = new Set((await ctx.store.list('document')).map((d) => d.name));
  const patches = new Map<string, { kind: FieldKind; record: { id: string }; patch: Record<string, unknown> }>();
  for (const h of hits) {
    const { text } = replaceAll(h.value, h.planned.edits);
    for (const [id, n] of h.planned.counts) counts.set(id, (counts.get(id) ?? 0) + n);
    fieldReplacements += h.planned.matches.length;
    const key = `${h.kind}:${h.record.id}`;
    const entry = patches.get(key) ?? patches.set(key, { kind: h.kind, record: h.record, patch: {} }).get(key)!;
    if (h.field.startsWith('values.')) {
      const current = (entry.patch.values as Record<string, unknown> | undefined) ?? { ...(h.record as Case).values };
      current[h.field.slice('values.'.length)] = text;
      entry.patch.values = current;
    } else if (h.field.endsWith('.filename')) {
      // source, original or media: the reference stays, only the name it shows changes.
      const slot = h.field.slice(0, -'.filename'.length) as 'source' | 'original' | 'media';
      const current = (entry.patch[slot] as Record<string, unknown> | undefined) ?? (h.record as Document)[slot];
      entry.patch[slot] = { ...current, filename: text };
    } else entry.patch[h.field] = text;
    opts.hits?.push({ kind: h.kind, id: h.record.id, field: h.field, label: pseudonymiseText(h.label, rules, { protect }) });
  }
  for (const { kind, record, patch } of patches.values()) {
    if (kind === 'document' && typeof patch.name === 'string') {
      const own = (record as Document).name;
      docNamesTaken.delete(own);
      const name = uniqueName(patch.name, docNamesTaken);
      patch.name = name;
      docNamesTaken.add(name);
    }
    if (kind === 'code' && typeof patch.name === 'string') patch.name = patch.name.slice(0, LIMITS.codeNameMax);
    if (kind === 'coding' && typeof patch.comment === 'string') patch.comment = patch.comment.slice(0, LIMITS.commentMax);
    plan.change(kind, record as never, patch as never);
  }
  replacements += fieldReplacements;

  if (opts.markApplied) {
    const now = new Date().toISOString();
    for (const p of rules) plan.change('pseudonym', p, { applied_at: now, applied_count: counts.get(p.id) ?? 0 });
  }
  if (!opts.markApplied && !replacements) return { replacements: 0, documents: 0, fieldReplacements: 0, removedCodings, undo: combineUndo('pseudonym.apply', '', parts) };
  // The log never names what was replaced: document names are logged as they now read.
  const shown = shownNames();
  const summary = `${opts.reason ? '↻ ' : ''}×${replacements} → ${shown || '∅'}${opts.reason ? ` (${opts.reason})` : ''}`;
  const { undo } = await commit(ctx, plan, {
    label: 'pseudonym.apply',
    detail: summary,
    logs: [{ action: 'pseudonym.apply', summary }],
    // Finished: the progress note goes in the same write.
    ...(opts.markApplied ? { extraMeta: [{ key: APPLY_PENDING, value: null }] } : {}),
  });
  parts.push(undo);
  await opts.onProgress?.(docs.length, docs.length);
  return { replacements, documents: docNames.length, fieldReplacements, removedCodings, undo: combineUndo('pseudonym.apply', summary, parts) };
}

// ---------------------------------------------------------------------------------------------
// Suggestions

// Capitalised words that are rarely names, in the languages of the interface: function words,
// the words people start spoken sentences with ("Now…", "Well…", "Então…", "Bueno…"), fillers,
// days and months. A short list on purpose: suggestions are a starting point the researcher
// reviews, not a detector, and a word that is also a name (Rosa, Will, Grace) stays out of it.
const COMMON = new Set(
  [
    // en
    'i', 'the', 'a', 'an', 'and', 'but', 'or', 'so', 'then', 'this', 'that', 'these', 'those', 'it', 'he', 'she', 'we',
    'they', 'you', 'my', 'our', 'your', 'his', 'her', 'their', 'yes', 'no', 'ok', 'okay', 'well', 'oh', 'mr', 'mrs', 'ms',
    'dr', 'what', 'when', 'where', 'why', 'how', 'who', 'if', 'in', 'on', 'at', 'of', 'for', 'with', 'to', 'is', 'was',
    'not', 'also', 'there', 'here', 'just', 'like', 'yeah', 'um', 'uh', 'god', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays',
    'sundays', 'english', 'portuguese', 'spanish', 'interviewer', 'interviewee',
    'respondent', 'participant', 'speaker', 'facilitator', 'moderator',
    'now', 'maybe', 'actually', 'anyway', 'anyways', 'still', 'sure', 'right', 'alright', 'really', 'because', 'although',
    'though', 'basically', 'honestly', 'obviously', 'perhaps', 'sometimes', 'usually', 'exactly', 'absolutely',
    'definitely', 'probably', 'certainly', 'indeed', 'let', 'after', 'before', 'even', 'only', 'first', 'finally', 'yep',
    'nope', 'nah', 'hmm', 'hm', 'mm', 'mhm', 'mm-hmm', 'uh-huh', 'ah', 'er', 'erm', 'eh', 'hi', 'hello', 'hey', 'thanks',
    'please', 'sorry', 'nothing', 'everything', 'something', 'someone', 'everyone', 'nobody', 'all', 'some', 'every',
    'do', 'did', 'does', 'are', 'were', 'be', 'have', 'had', 'can', 'could', 'would', 'should', 'ma’am', 'y’all',
    // pt
    'o', 'os', 'as', 'um', 'uma', 'e', 'mas', 'então', 'eu', 'ele', 'ela', 'nós', 'eles', 'elas', 'você', 'sim', 'não',
    'isso', 'isto', 'esse', 'essa', 'este', 'esta', 'aqui', 'ali', 'quando', 'onde', 'porque', 'como', 'que', 'se',
    'também', 'já', 'bem', 'pois', 'entrevistador', 'entrevistadora', 'entrevistado', 'entrevistada', 'participante',
    'sr', 'sra', 'dra', 'deus', 'pronto', 'olha', 'portanto', 'agora', 'talvez', 'claro', 'depois', 'antes', 'bom',
    'exato', 'exatamente', 'enfim', 'aliás', 'hum', 'nada', 'mesmo', 'realmente', 'obrigado', 'obrigada', 'acho', 'ora',
    'tipo', 'lá', 'cá', 'só', 'nem', 'ou', 'mais', 'muito', 'tudo', 'todos', 'ninguém', 'alguém', 'sempre', 'nunca',
    'ainda', 'assim', 'primeiro', 'desculpe', 'olá', 'hoje', 'ontem', 'amanhã', 'pá', 'epá', 'quer', 'na', 'no', 'nas', 'nos',
    'em', 'ao', 'aos', 'à', 'pelo', 'pela', 'meu', 'minha', 'seu', 'sua', 'foi', 'era', 'há', 'é', 'são', 'está', 'estava',
    'tem', 'tinha', 'qual', 'quem', 'senhor', 'senhora', 'dona', 'moderador', 'moderadora', 'inglês', 'espanhol', 'português',
    // es
    'el', 'la', 'los', 'las', 'una', 'y', 'pero', 'entonces', 'yo', 'él', 'nosotros', 'ellos', 'ellas', 'usted', 'sí',
    'eso', 'esto', 'ese', 'aquí', 'allí', 'cuando', 'donde', 'si', 'ya', 'bueno', 'pues', 'dios', 'vale', 'mira',
    'ahora', 'quizás', 'quizá', 'oye', 'vamos', 'bien', 'después', 'luego', 'además', 'también', 'hombre', 'venga',
    'exacto', 'exactamente', 'vaya', 'gracias', 'hola', 'total', 'sea', 'digamos', 'igual', 'todo', 'todos', 'nadie',
    'alguien', 'siempre', 'nunca', 'primero', 'todavía', 'aún', 'así', 'perdón', 'perdone', 'hoy', 'ayer', 'mañana',
    'muy', 'más', 'ni', 'em', 'ehm', 'mi', 'mis', 'tu', 'su', 'sus', 'en', 'es', 'al', 'lo', 'le', 'les', 'por', 'para',
    'con', 'sin', 'un', 'unos', 'unas', 'me', 'te', 'nos', 'fue', 'hay', 'ha', 'he', 'son', 'está', 'estaba', 'tan', 'qué',
    'cómo', 'dónde', 'cuándo', 'quién', 'señor', 'señora', 'don', 'doña', 'inglés', 'español', 'portugués',
  ].map((w) => w.normalize('NFC')),
);
// Lower-case particles inside names: "Maria da Silva", "Juan de la Cruz", "Ludwig van Beethoven".
const PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'del', 'di', 'du', 'van', 'von', 'der', 'den', 'la', 'le']);

const RE_WORD = /[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu;
const RE_CAPITALISED = /^[\p{Lu}\p{Lt}][\p{Ll}\p{M}'’-]/u;
// English contractions are never names: I’m, I'll, We're, I've, She'd, Don't, Can't…
const RE_CONTRACTION = /['’](?:m|ll|re|ve|d|t)$/iu;
// A possessive (or "it's") counts as the word without it: Ana's → Ana, It's → It.
const RE_POSSESSIVE = /^(.+?)['’]s$/iu;
const isCommon = (w: string) => COMMON.has(w.normalize('NFC').replace(/'/g, '’').toLocaleLowerCase());

/** A word as matched by RE_WORD: trailing marks dropped, a possessive taken off; null for a contraction. */
function wordOf(raw: string): string | null {
  const w = raw.replace(/['’-]+$/, '');
  if (RE_CONTRACTION.test(w)) return null;
  return RE_POSSESSIVE.exec(w)?.[1] ?? w;
}

export interface Candidate {
  text: string;
  count: number;
}

/**
 * Likely names in the texts, for the researcher to review: capitalised words and runs of them
 * ("Ana Lima", "Maria da Silva") that are not just the first word of a sentence, with how often
 * each occurs. A word seen only at the start of sentences is left out; one also seen elsewhere
 * counts every occurrence. Speaker labels ("Rui: …") count as names.
 */
export function suggestCandidates(texts: readonly string[], opts: { exclude?: readonly string[]; limit?: number } = {}): Candidate[] {
  const qualified = new Map<string, number>();
  const atStart = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const text of texts) {
    for (const para of text.split('\n')) {
      const words: { w: string; name: boolean; start: number; end: number }[] = [];
      let m: RegExpExecArray | null;
      const re = new RegExp(RE_WORD.source, 'gu');
      while ((m = re.exec(para))) {
        const w = wordOf(m[0]);
        words.push({ w: w ?? m[0], name: w !== null, start: m.index, end: m.index + m[0].length });
      }
      const sentenceStart = (i: number): boolean => {
        let j = words[i]!.start - 1;
        for (;;) {
          while (j >= 0 && /[\s"'“”‘’«»„(\[¿¡—–-]/.test(para[j]!)) j--;
          // A transcriber's note ("[laughs]", "(pausa)") does not end a sentence: look past it.
          const close = para[j];
          if (close !== ']' && close !== ')') break;
          const open = para.lastIndexOf(close === ']' ? '[' : '(', j);
          if (open < 0) break;
          j = open - 1;
        }
        return j < 0 || /[.!?…:;]/.test(para[j]!);
      };
      const cap = (i: number) => !!words[i] && words[i]!.name && RE_CAPITALISED.test(words[i]!.w);
      const gapOk = (i: number) => /^[ \u00A0]$/.test(para.slice(words[i - 1]!.end, words[i]!.start));
      for (let i = 0; i < words.length; ) {
        if (!cap(i)) {
          i++;
          continue;
        }
        // Grow a run of capitalised words, allowing particles between them.
        const run = [i];
        let j = i + 1;
        while (j < words.length && gapOk(j)) {
          if (cap(j)) {
            run.push(j++);
            continue;
          }
          let k = j;
          while (k < words.length && gapOk(k) && PARTICLES.has(words[k]!.w.toLowerCase())) k++;
          if (k > j && cap(k) && gapOk(k)) {
            for (let x = j; x <= k; x++) run.push(x);
            j = k + 1;
          } else break;
        }
        let first = 0;
        let start = sentenceStart(run[0]!);
        while (first < run.length && isCommon(words[run[first]!]!.w)) {
          first++;
          start = false;
        }
        const kept = run.slice(first);
        // Nor start on one, once a leading common word is gone ("E das Amoreiras").
        while (kept.length && PARTICLES.has(words[kept[0]!]!.w.toLowerCase())) kept.shift();
        // A run cannot end on a particle.
        while (kept.length && PARTICLES.has(words[kept[kept.length - 1]!]!.w.toLowerCase())) kept.pop();
        if (kept.length) {
          const phrase = kept.map((x) => words[x]!.w).join(' ').normalize('NFC');
          const lastEnd = words[kept[kept.length - 1]!]!.end;
          const label = run[0] === 0 && para.slice(lastEnd).startsWith(':');
          const single = kept.length === 1;
          if (single && isCommon(phrase)) {
            // nothing
          } else if (label || !start || !single) bump(qualified, phrase);
          else bump(atStart, phrase);
        }
        i = j;
      }
    }
  }
  for (const [k, n] of atStart) if (qualified.has(k)) qualified.set(k, qualified.get(k)! + n);
  const excluded = new Set((opts.exclude ?? []).map((e) => tidy(e).toLocaleLowerCase()));
  return [...qualified]
    .filter(([k]) => !excluded.has(k.toLocaleLowerCase()))
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || collator.compare(a.text, b.text))
    .slice(0, opts.limit ?? 200);
}
