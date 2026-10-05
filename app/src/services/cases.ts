// Cases (participants, sites…) and their attributes (age, role, cohort…), including importing
// an attribute table from a spreadsheet.

import type { Attribute, AttributeType, AttributeValue, Case, Document } from '../core/model/types';
import { orderAfterLast, placeBefore } from '../core/qda/tree';
import type { ProjectContext } from './context';
import { recentlyLogged } from './log';
import { commit, listIn, need, noopUndo, Plan, q, ServiceError, type LogSpec, type Undoable } from './undo';

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const nameKey = (s: string) => tidy(s).normalize('NFC').toLocaleLowerCase();
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

// ---------------------------------------------------------------------------------------------
// Values

/**
 * A number written either way: "1.5", "1,5", "-3", "1 234,5", "1.234,5", "1,234.5". With one
 * separator only, a single one is the decimal mark (so "1,234" is 1.234, as in Portuguese and
 * Spanish) and repeated ones group thousands. Returns null for anything else.
 */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/[\s\u00A0\u202F']/g, '');
  if (!s) return null;
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  if (commas && dots) {
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const group = decimal === ',' ? '.' : ',';
    if ((s.match(new RegExp(`\\${decimal}`, 'g')) ?? []).length > 1) return null;
    s = s.split(group).join('').replace(decimal, '.');
  } else if (commas) {
    s = commas === 1 ? s.replace(',', '.') : s.split(',').join('');
  } else if (dots > 1) {
    s = s.split('.').join('');
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** An ISO calendar date (YYYY-MM-DD, optionally followed by a time, which is dropped). */
export function parseDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const TRUE_WORDS = new Set(['yes', 'y', 'true', 't', '1', 'sim', 's', 'si', 'verdadeiro', 'verdadero', 'v', 'x', '✓', '✔']);
const FALSE_WORDS = new Set(['no', 'n', 'false', 'f', '0', 'nao', 'falso']);

/** yes/no in English, Portuguese and Spanish (sim/não, sí/no), true/false and 1/0. */
export function parseBoolean(raw: string): boolean | null {
  const s = fold(raw);
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return null;
}

export type Coerced = { ok: true; value: AttributeValue } | { ok: false };

/** A value converted to an attribute type; empty becomes null. Choice options are not checked. */
export function coerceValue(type: AttributeType, value: AttributeValue | undefined): Coerced {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === 'string' && !value.trim()) return { ok: true, value: null };
  if (typeof value === 'number' && !Number.isFinite(value)) return { ok: false };
  switch (type) {
    case 'text':
    case 'choice':
      return { ok: true, value: typeof value === 'string' ? tidy(value) : String(value) };
    case 'number': {
      if (typeof value === 'number') return { ok: true, value };
      if (typeof value === 'boolean') return { ok: false };
      const n = parseNumber(value);
      return n === null ? { ok: false } : { ok: true, value: n };
    }
    case 'date': {
      if (typeof value !== 'string') return { ok: false };
      const d = parseDate(value);
      return d === null ? { ok: false } : { ok: true, value: d };
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value };
      if (typeof value === 'number') return value === 1 || value === 0 ? { ok: true, value: value === 1 } : { ok: false };
      const b = parseBoolean(value);
      return b === null ? { ok: false } : { ok: true, value: b };
    }
  }
}

/**
 * The type a column of values most likely has: number when every value is one, date when every
 * value is an ISO date, choice when there are at most 12 distinct short values, else text.
 */
export function inferAttributeType(values: readonly string[]): { type: AttributeType; options: string[] } {
  const vals = values.map((v) => tidy(v)).filter(Boolean);
  if (!vals.length) return { type: 'text', options: [] };
  if (vals.every((v) => parseNumber(v) !== null)) return { type: 'number', options: [] };
  if (vals.every((v) => parseDate(v) !== null)) return { type: 'date', options: [] };
  const distinct = [...new Map(vals.map((v) => [nameKey(v), v])).values()];
  if (distinct.length <= 12 && distinct.every((v) => v.length <= 60)) return { type: 'choice', options: distinct };
  return { type: 'text', options: [] };
}

/** For a choice attribute: the option matching `value` (case-insensitively), if any. */
function matchOption(options: readonly string[], value: string): string | undefined {
  const k = nameKey(value);
  return options.find((o) => nameKey(o) === k);
}

// ---------------------------------------------------------------------------------------------
// Cases

export interface NewCase {
  name: string;
  description?: string;
  color?: string | null;
  values?: Record<string, AttributeValue>;
}

function requireName(name: string): string {
  const n = tidy(name);
  if (!n) throw new ServiceError('invalid_argument', 'a name is required');
  return n;
}

export async function createCase(ctx: ProjectContext, input: NewCase): Promise<{ case: Case; undo: Undoable }> {
  const name = requireName(input.name);
  const plan = new Plan();
  const id = plan.create('case', { name, description: input.description ?? '', values: input.values ?? {}, color: input.color ?? null });
  const { saved, undo } = await commit(ctx, plan, {
    label: 'case.create',
    detail: q(name),
    logs: [{ action: 'case.create', summary: q(name), target: { kind: 'case', id } }],
  });
  return { case: saved.get('case', id), undo };
}

export async function updateCase(
  ctx: ProjectContext,
  id: string,
  patch: Partial<Pick<Case, 'name' | 'description' | 'color'>>,
): Promise<{ case: Case; undo: Undoable }> {
  const c = await need(ctx, 'case', id);
  const clean = { ...patch };
  if (patch.name !== undefined) clean.name = requireName(patch.name);
  if (!(Object.keys(clean) as (keyof typeof clean)[]).some((k) => clean[k] !== undefined && clean[k] !== c[k])) {
    return { case: c, undo: noopUndo('case.edit', q(c.name)) };
  }
  const plan = new Plan();
  plan.change('case', c, clean);
  const summary = clean.name && clean.name !== c.name ? `${q(c.name)} → ${q(clean.name)}` : q(c.name);
  const logs: LogSpec[] = clean.name === undefined && (await recentlyLogged(ctx, 'case.edit', id)) ? [] : [{ action: 'case.edit', summary, target: { kind: 'case', id } }];
  const { saved, undo } = await commit(ctx, plan, { label: 'case.edit', detail: summary, logs });
  return { case: saved.get('case', id), undo };
}

/**
 * Sets one attribute value of a case, converted to the attribute's type (ServiceError
 * 'invalid_value' when it cannot be). A new value of a choice attribute becomes an option.
 * Values are not written to the log: they may describe a participant.
 */
export async function setCaseValue(
  ctx: ProjectContext,
  caseId: string,
  attributeId: string,
  value: AttributeValue,
): Promise<{ case: Case; undo: Undoable }> {
  const c = await need(ctx, 'case', caseId);
  const attr = await need(ctx, 'attribute', attributeId);
  const r = coerceValue(attr.type, value);
  if (!r.ok) throw new ServiceError('invalid_value', `not a valid ${attr.type}`);
  const plan = new Plan();
  let v = r.value;
  if (attr.type === 'choice' && typeof v === 'string') {
    const opt = matchOption(attr.options, v);
    if (opt) v = opt;
    else plan.change('attribute', attr, { options: [...attr.options, v] });
  }
  const values = { ...c.values };
  if (v === null) delete values[attributeId];
  else values[attributeId] = v;
  if ((c.values[attributeId] ?? null) === v && plan.isEmpty) return { case: c, undo: noopUndo('case.edit', q(c.name)) };
  plan.change('case', c, { values });
  const summary = `${q(c.name)}: ${q(attr.name)}`;
  const logs: LogSpec[] = (await recentlyLogged(ctx, 'case.edit', caseId)) ? [] : [{ action: 'case.edit', summary, target: { kind: 'case', id: caseId } }];
  const { saved, undo } = await commit(ctx, plan, { label: 'case.edit', detail: summary, logs });
  return { case: saved.get('case', caseId), undo };
}

/** Deletes a case (and memos about it); its documents stay, without a case. */
export async function deleteCase(ctx: ProjectContext, id: string): Promise<{ batch: string; documents: number; undo: Undoable }> {
  const c = await need(ctx, 'case', id);
  const plan = new Plan();
  const docs = await ctx.store.list('document', { where: 'case_id = ?', params: [id] });
  for (const d of docs) plan.change('document', d, { case_id: null });
  for (const m of await listIn(ctx.store, 'memo', 'target_id', [id])) if (m.target.kind === 'case') plan.remove('memo', m);
  plan.remove('case', c);
  const { batch, undo } = await commit(ctx, plan, {
    label: 'case.delete',
    detail: q(c.name),
    logs: [{ action: 'case.delete', summary: q(c.name), target: { kind: 'case', id } }],
  });
  return { batch, documents: docs.length, undo };
}

/**
 * One case per document, named after it, and the document linked to it. A case that already
 * has the document's name is reused; documents that already have a case are skipped.
 */
export async function casesFromDocuments(
  ctx: ProjectContext,
  docIds: string[],
): Promise<{ created: number; linked: number; skipped: number; undo: Undoable }> {
  const cases = await ctx.store.list('case');
  const byName = new Map(cases.map((c) => [nameKey(c.name), c.id]));
  const plan = new Plan();
  let created = 0;
  let linked = 0;
  let skipped = 0;
  for (const id of new Set(docIds)) {
    const d: Document = await need(ctx, 'document', id);
    if (d.case_id) {
      skipped++;
      continue;
    }
    let caseId = byName.get(nameKey(d.name));
    if (!caseId) {
      caseId = plan.create('case', { name: d.name, description: '', values: {}, color: null });
      byName.set(nameKey(d.name), caseId);
      created++;
    }
    plan.change('document', d, { case_id: caseId });
    linked++;
  }
  if (plan.isEmpty) return { created, linked, skipped, undo: noopUndo('case.create') };
  const summary = `×${created} (${linked})`;
  const { undo } = await commit(ctx, plan, { label: 'case.create', detail: summary, logs: [{ action: 'case.create', summary }] });
  return { created, linked, skipped, undo };
}

// ---------------------------------------------------------------------------------------------
// Attributes

export interface NewAttribute {
  name: string;
  type: AttributeType;
  options?: string[];
  description?: string;
}

export async function createAttribute(ctx: ProjectContext, input: NewAttribute): Promise<{ attribute: Attribute; undo: Undoable }> {
  const name = requireName(input.name);
  const attrs = await ctx.store.list('attribute');
  const plan = new Plan();
  const id = plan.create('attribute', {
    name,
    type: input.type,
    options: input.type === 'choice' ? input.options ?? [] : [],
    description: input.description ?? '',
    order: orderAfterLast(attrs),
  });
  const summary = `+ ${q(name)}: ${input.type}`;
  const { saved, undo } = await commit(ctx, plan, { label: 'attribute.edit', detail: summary, logs: [{ action: 'attribute.edit', summary, target: { kind: 'attribute', id } }] });
  return { attribute: saved.get('attribute', id), undo };
}

/**
 * Edits an attribute. Changing its type converts every case's value; values that do not
 * convert (or, for a choice, are no longer an option) are cleared, and counted in `cleared`.
 * Turning an attribute into a choice makes its existing values the options.
 */
export async function updateAttribute(
  ctx: ProjectContext,
  id: string,
  patch: Partial<Pick<Attribute, 'name' | 'type' | 'options' | 'description'>>,
): Promise<{ attribute: Attribute; cleared: number; undo: Undoable }> {
  const attr = await need(ctx, 'attribute', id);
  const type = patch.type ?? attr.type;
  const plan = new Plan();
  const cases = await ctx.store.list('case');
  let cleared = 0;
  let options = type === 'choice' ? (patch.options ?? attr.options).map(tidy).filter(Boolean) : [];
  if (type !== attr.type || patch.options) {
    if (type === 'choice' && attr.type !== 'choice') {
      // Existing values become options, after any given ones.
      for (const c of cases) {
        const r = coerceValue('choice', c.values[id]);
        if (r.ok && typeof r.value === 'string' && !matchOption(options, r.value)) options.push(r.value);
      }
    }
    for (const c of cases) {
      if (!(id in c.values)) continue;
      const r = coerceValue(type, c.values[id]);
      let v: AttributeValue = r.ok ? r.value : null;
      if (type === 'choice' && typeof v === 'string') v = matchOption(options, v) ?? null;
      if (v === c.values[id]) continue;
      const values = { ...c.values };
      if (v === null) {
        delete values[id];
        cleared++;
      } else values[id] = v;
      plan.change('case', c, { values });
    }
  }
  options = [...new Map(options.map((o) => [nameKey(o), o])).values()];
  const next: Partial<Attribute> = { type, options };
  if (patch.name !== undefined) next.name = requireName(patch.name);
  if (patch.description !== undefined) next.description = patch.description;
  plan.change('attribute', attr, next);
  const summary = type !== attr.type ? `${q(next.name ?? attr.name)}: ${attr.type} → ${type}` : next.name && next.name !== attr.name ? `${q(attr.name)} → ${q(next.name)}` : q(attr.name);
  const { saved, undo } = await commit(ctx, plan, { label: 'attribute.edit', detail: summary, logs: [{ action: 'attribute.edit', summary, target: { kind: 'attribute', id } }] });
  return { attribute: saved.get('attribute', id), cleared, undo };
}

/** Deletes an attribute and its values in every case. */
export async function deleteAttribute(ctx: ProjectContext, id: string): Promise<{ batch: string; undo: Undoable }> {
  const attr = await need(ctx, 'attribute', id);
  const plan = new Plan();
  for (const c of await ctx.store.list('case')) {
    if (!(id in c.values)) continue;
    const values = { ...c.values };
    delete values[id];
    plan.change('case', c, { values });
  }
  plan.remove('attribute', attr);
  const summary = `− ${q(attr.name)}`;
  const { batch, undo } = await commit(ctx, plan, { label: 'attribute.edit', detail: summary, logs: [{ action: 'attribute.edit', summary, target: { kind: 'attribute', id } }] });
  return { batch, undo };
}

export async function reorderAttribute(ctx: ProjectContext, id: string, beforeId: string | null): Promise<Undoable> {
  const attr = await need(ctx, 'attribute', id);
  const attrs = await ctx.store.list('attribute');
  const { order, renumber } = placeBefore(attrs, id, beforeId === id ? null : beforeId);
  const plan = new Plan();
  if (renumber) {
    for (const a of attrs) {
      const o = renumber.get(a.id);
      if (o !== undefined && o !== a.order) plan.change('attribute', a, { order: o });
    }
  } else plan.change('attribute', attr, { order });
  if (plan.isEmpty) return noopUndo('attribute.edit');
  return (await commit(ctx, plan, { label: 'attribute.edit', detail: q(attr.name), logs: [] })).undo;
}

/** Live attributes in their order. */
export async function listAttributes(ctx: ProjectContext): Promise<Attribute[]> {
  return ctx.store.list('attribute', { order: 'sort, id' });
}

// ---------------------------------------------------------------------------------------------
// Attribute table import

export interface AttributeImport {
  /** Rows that matched an existing case. */
  matched: number;
  /** Cases created for rows that matched none (with `createMissing`). */
  created: number;
  /** Case names of rows that matched no case and were not created. */
  unmatched: string[];
  attributesCreated: number;
  /** Cells that could not be converted to their attribute's type (left unchanged). */
  invalid: number;
  undo: Undoable;
}

/**
 * Imports a table of case attributes (one row per case, one column per attribute, e.g. from
 * a spreadsheet). Rows match cases by name (case-insensitively); columns match attributes by
 * name, and unknown columns become attributes of an inferred type. Empty cells leave values
 * as they are.
 */
export async function importAttributeTable(
  ctx: ProjectContext,
  rows: string[][],
  opts: { header: boolean; nameColumn: number; createMissing: boolean },
): Promise<AttributeImport> {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (opts.nameColumn < 0 || opts.nameColumn >= Math.max(width, 1)) throw new ServiceError('invalid_argument', 'no such name column');
  const head = opts.header ? rows[0] ?? [] : Array.from({ length: width }, (_, i) => `#${i + 1}`);
  const body = (opts.header ? rows.slice(1) : rows).filter((r) => r.some((cell) => (cell ?? '').trim()));
  const plan = new Plan();

  const attrs = await ctx.store.list('attribute');
  const attrByName = new Map(attrs.map((a) => [nameKey(a.name), a]));
  let order = orderAfterLast(attrs);
  let attributesCreated = 0;
  // Column → the attribute it fills (a plain record for ones created by this import).
  const columns: { index: number; attr: Attribute }[] = [];
  for (let i = 0; i < width; i++) {
    if (i === opts.nameColumn) continue;
    const name = tidy(head[i] ?? '');
    if (!name) continue;
    let attr = attrByName.get(nameKey(name));
    if (!attr) {
      const { type, options } = inferAttributeType(body.map((r) => r[i] ?? ''));
      const draft = { name, type, options, description: '', order: order++ };
      const id = plan.create('attribute', draft);
      attr = { ...draft, id } as Attribute;
      attrByName.set(nameKey(name), attr);
      attributesCreated++;
    }
    columns.push({ index: i, attr });
  }

  const cases = await ctx.store.list('case');
  const caseByName = new Map<string, Case>(cases.map((c) => [nameKey(c.name), c]));
  const touched = new Map<string, { record: Case; values: Record<string, AttributeValue>; isNew: boolean }>();
  const unmatched: string[] = [];
  let matched = 0;
  let created = 0;
  let invalid = 0;
  const optionsOf = new Map<string, string[]>(columns.map((c) => [c.attr.id, [...c.attr.options]]));

  for (const row of body) {
    const name = tidy(row[opts.nameColumn] ?? '');
    if (!name) continue;
    let entry = touched.get(nameKey(name));
    if (!entry) {
      const existing = caseByName.get(nameKey(name));
      if (existing) {
        entry = { record: existing, values: { ...existing.values }, isNew: false };
        matched++;
      } else if (opts.createMissing) {
        const draft = { name, description: '', values: {}, color: null };
        const id = plan.create('case', draft);
        entry = { record: { ...draft, id } as Case, values: {}, isNew: true };
        caseByName.set(nameKey(name), entry.record);
        created++;
      } else {
        if (!unmatched.includes(name)) unmatched.push(name);
        continue;
      }
      touched.set(nameKey(name), entry);
    } else if (!entry.isNew) matched++;
    for (const { index, attr } of columns) {
      const cell = (row[index] ?? '').trim();
      if (!cell) continue;
      const r = coerceValue(attr.type, cell);
      if (!r.ok || r.value === null) {
        invalid++;
        continue;
      }
      let v = r.value;
      if (attr.type === 'choice' && typeof v === 'string') {
        const opts2 = optionsOf.get(attr.id)!;
        const opt = matchOption(opts2, v);
        if (opt) v = opt;
        else opts2.push(v);
      }
      entry.values[attr.id] = v;
    }
  }

  for (const { record, values, isNew } of touched.values()) {
    if (isNew) plan.change('case', record, { values });
    else if (JSON.stringify(values) !== JSON.stringify(record.values)) plan.change('case', record, { values });
  }
  for (const { attr } of columns) {
    const opts2 = optionsOf.get(attr.id)!;
    if (attr.type === 'choice' && opts2.length !== attr.options.length) plan.change('attribute', attr, { options: opts2 });
  }
  if (plan.isEmpty) return { matched, created, unmatched, attributesCreated, invalid, undo: noopUndo('attribute.edit') };
  const summary = `×${matched + created} (+${created}), ${columns.map((c) => q(c.attr.name)).join(', ')}`;
  const logs: LogSpec[] = [{ action: 'attribute.edit', summary }];
  const { undo } = await commit(ctx, plan, { label: 'attribute.edit', detail: summary, logs });
  return { matched, created, unmatched, attributesCreated, invalid, undo };
}
