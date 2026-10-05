// The retrieval screen's filter as the researcher sets it (serialisable, remembered per
// project), and its translation to core/qda/segments.ts's SegmentFilter.
//
// Every list here follows one rule the researcher can predict: nothing ticked means "any".
// (The core filter treats an empty list as "nothing matches"; that is a query-builder rule,
// not a screen one.)

import type { Attribute, Coding } from '../../core/model/types';
import type { ConditionOp } from '../../core/qda/attributes';
import type { AttributeCondition, OverlapMode, SegmentFilter, SegmentSort } from '../../core/qda/segments';
import { fold } from '../../core/text/normalize';

export type ContextMode = 'none' | 'sentence' | 'paragraph';
export type SortMode = 'document' | 'code' | 'length' | 'newest';

export const CONTEXT_MODES: readonly ContextMode[] = ['none', 'sentence', 'paragraph'];
export const SORT_MODES: readonly SortMode[] = ['document', 'code', 'length', 'newest'];
export const OVERLAP_MODES: readonly OverlapMode[] = ['overlap', 'within', 'contains'];
export const CONDITION_OPS: readonly ConditionOp[] = ['eq', 'neq', 'lt', 'gt', 'contains', 'empty', 'notEmpty'];

/** Operators that compare with a value (the others only look at whether there is one). */
export const opNeedsValue = (op: ConditionOp): boolean => op !== 'empty' && op !== 'notEmpty';

export interface ConditionRow {
  /** Stable key for the row's controls. */
  key: string;
  attributeId: string;
  op: ConditionOp;
  value: string;
}

export interface FilterState {
  codeIds: string[];
  includeChildren: boolean;
  documentIds: string[];
  groupIds: string[];
  caseIds: string[];
  conditions: ConditionRow[];
  attributeMatch: 'all' | 'any';
  coderIds: string[];
  text: string;
  /** Co-location: keep segments that relate to a segment of these codes. */
  overlap: { on: boolean; codeIds: string[]; mode: OverlapMode; includeChildren: boolean };
  sort: SortMode;
  context: ContextMode;
}

export const DEFAULT_FILTER: FilterState = {
  codeIds: [],
  includeChildren: true,
  documentIds: [],
  groupIds: [],
  caseIds: [],
  conditions: [],
  attributeMatch: 'all',
  coderIds: [],
  text: '',
  overlap: { on: false, codeIds: [], mode: 'overlap', includeChildren: true },
  sort: 'document',
  context: 'none',
};

/** The filter a route asks for: these codes only, keeping how the list is read (sort, context). */
export function filterForCodes(codeIds: readonly string[], base: FilterState): FilterState {
  return { ...DEFAULT_FILTER, codeIds: [...new Set(codeIds)], sort: base.sort, context: base.context };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))] : []);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/**
 * A filter read back from storage. Anything unexpected (an older shape, a hand-edited value)
 * falls back to the default for that field rather than failing.
 */
export function parseFilter(raw: string | null): FilterState {
  if (!raw) return DEFAULT_FILTER;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_FILTER;
  }
  if (!v || typeof v !== 'object') return DEFAULT_FILTER;
  const o = v as Record<string, unknown>;
  const ov = (o.overlap && typeof o.overlap === 'object' ? o.overlap : {}) as Record<string, unknown>;
  const conditions: ConditionRow[] = Array.isArray(o.conditions)
    ? o.conditions
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c, i) => ({
          key: typeof c.key === 'string' && c.key ? c.key : `c${i}`,
          attributeId: typeof c.attributeId === 'string' ? c.attributeId : '',
          op: oneOf(c.op, CONDITION_OPS, 'eq'),
          value: typeof c.value === 'string' ? c.value : '',
        }))
    : [];
  return {
    codeIds: strings(o.codeIds),
    includeChildren: typeof o.includeChildren === 'boolean' ? o.includeChildren : DEFAULT_FILTER.includeChildren,
    documentIds: strings(o.documentIds),
    groupIds: strings(o.groupIds),
    caseIds: strings(o.caseIds),
    conditions,
    attributeMatch: o.attributeMatch === 'any' ? 'any' : 'all',
    coderIds: strings(o.coderIds),
    text: typeof o.text === 'string' ? o.text : '',
    overlap: {
      on: ov.on === true,
      codeIds: strings(ov.codeIds),
      mode: oneOf(ov.mode, OVERLAP_MODES, 'overlap'),
      includeChildren: typeof ov.includeChildren === 'boolean' ? ov.includeChildren : true,
    },
    sort: oneOf(o.sort, SORT_MODES, 'document'),
    context: oneOf(o.context, CONTEXT_MODES, 'none'),
  };
}

export const serializeFilter = (f: FilterState): string => JSON.stringify(f);

/** localStorage key of a project's last filter. */
export const filterStorageKey = (projectId: string): string => `trama.segments.filter.${projectId}`;

/** Ids that still exist, for every list in the filter. */
export interface KnownIds {
  codes: ReadonlySet<string>;
  documents: ReadonlySet<string>;
  groups: ReadonlySet<string>;
  cases: ReadonlySet<string>;
  coders: ReadonlySet<string>;
  attributes: ReadonlySet<string>;
}

const keep = (ids: readonly string[], known: ReadonlySet<string>) => ids.filter((id) => known.has(id));

/** A condition row complete enough to apply. */
export function isCompleteCondition(c: ConditionRow, known?: ReadonlySet<string>): boolean {
  if (!c.attributeId || (known && !known.has(c.attributeId))) return false;
  return !opNeedsValue(c.op) || c.value.trim() !== '';
}

/** Typed condition value: numbers stay text (core coerces by attribute type), booleans become booleans. */
function conditionValue(c: ConditionRow, attr: Attribute | undefined): AttributeCondition['value'] {
  if (!opNeedsValue(c.op)) return undefined;
  if (attr?.type === 'boolean') return c.value === 'true' ? true : c.value === 'false' ? false : c.value;
  return c.value.trim();
}

/**
 * The core filter for a screen filter. Ids of records that no longer exist are dropped; a list
 * left empty puts no constraint. `undefined` fields mean "no constraint" in the core filter.
 */
export function toSegmentFilter(f: FilterState, known: KnownIds, attributes: readonly Attribute[] = []): SegmentFilter {
  const out: SegmentFilter = {};
  const codes = keep(f.codeIds, known.codes);
  if (codes.length) {
    out.codeIds = codes;
    out.includeChildren = f.includeChildren;
  }
  const docs = keep(f.documentIds, known.documents);
  if (docs.length) out.documentIds = docs;
  const groups = keep(f.groupIds, known.groups);
  if (groups.length) out.groupIds = groups;
  const cases = keep(f.caseIds, known.cases);
  if (cases.length) out.caseIds = cases;
  const coders = keep(f.coderIds, known.coders);
  if (coders.length) out.coderIds = coders;
  const attrs = new Map(attributes.map((a) => [a.id, a]));
  const conds = f.conditions
    .filter((c) => isCompleteCondition(c, known.attributes))
    .map((c): AttributeCondition => ({ attributeId: c.attributeId, op: c.op, value: conditionValue(c, attrs.get(c.attributeId)) }));
  if (conds.length) {
    out.attributeConditions = conds;
    out.attributeMatch = f.attributeMatch;
  }
  if (f.overlap.on) {
    const others = keep(f.overlap.codeIds, known.codes);
    if (others.length) out.overlapWith = { codeIds: others, mode: f.overlap.mode, includeChildren: f.overlap.includeChildren };
  }
  return out;
}

/** The core sort for a screen sort: 'newest' is creation order, reversed. */
export function coreSort(s: SortMode): { by: SegmentSort; descending: boolean } {
  return s === 'newest' ? { by: 'created', descending: true } : { by: s, descending: false };
}

/**
 * Segments whose text contains every word of `query` (case and accents ignored). `folded`
 * gives a coding's folded text, so a caller can cache it between keystrokes.
 */
export function matchText(codings: readonly Coding[], query: string, folded: (c: Coding) => string = (c) => fold(c.text)): Coding[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return codings as Coding[];
  return codings.filter((c) => {
    const t = folded(c);
    return words.every((w) => t.includes(w));
  });
}

/** How many filter groups are narrowing the list (for the "Clear filters" affordance). */
export function activeFilterCount(f: FilterState, known?: KnownIds): number {
  const n = (ids: readonly string[], set?: ReadonlySet<string>) => (set ? keep(ids, set).length : ids.length) > 0;
  let count = 0;
  if (n(f.codeIds, known?.codes)) count++;
  if (n(f.documentIds, known?.documents) || n(f.groupIds, known?.groups)) count++;
  if (n(f.caseIds, known?.cases) || f.conditions.some((c) => isCompleteCondition(c, known?.attributes))) count++;
  if (n(f.coderIds, known?.coders)) count++;
  if (f.text.trim()) count++;
  if (f.overlap.on && n(f.overlap.codeIds, known?.codes)) count++;
  return count;
}

/** The filter with every narrowing removed; the reading options (sort, context) stay. */
export const clearedFilter = (f: FilterState): FilterState => ({ ...DEFAULT_FILTER, sort: f.sort, context: f.context });

/** Toggles one id in a list (keeping order of the others). */
export function toggleId(ids: readonly string[], id: string, on?: boolean): string[] {
  const has = ids.includes(id);
  const want = on ?? !has;
  if (want === has) return ids as string[];
  return want ? [...ids, id] : ids.filter((x) => x !== id);
}

export interface DescribeLabels {
  all: string;
  codes: (list: string) => string;
  codesWithChildren: (list: string) => string;
  documents: (list: string) => string;
  groups: (list: string) => string;
  cases: (list: string) => string;
  conditions: (match: 'all' | 'any', list: string) => string;
  coders: (list: string) => string;
  text: (q: string) => string;
  colocation: (mode: OverlapMode, list: string) => string;
  /** "age is more than 40" */
  condition: (attribute: string, op: ConditionOp, value: string) => string;
}

export interface DescribeNames {
  code(id: string): string | undefined;
  document(id: string): string | undefined;
  group(id: string): string | undefined;
  case(id: string): string | undefined;
  coder(id: string): string | undefined;
  attribute(id: string): string | undefined;
}

/** What a filter retrieves, one line per narrowing, in words (for the head of a report). */
export function describeFilter(f: FilterState, names: DescribeNames, labels: DescribeLabels): string[] {
  const list = (ids: readonly string[], name: (id: string) => string | undefined) =>
    ids.map(name).filter((x): x is string => !!x).join(', ');
  const out: string[] = [];
  const codes = list(f.codeIds, names.code);
  if (codes) out.push(f.includeChildren ? labels.codesWithChildren(codes) : labels.codes(codes));
  const groups = list(f.groupIds, names.group);
  if (groups) out.push(labels.groups(groups));
  const docs = list(f.documentIds, names.document);
  if (docs) out.push(labels.documents(docs));
  const cases = list(f.caseIds, names.case);
  if (cases) out.push(labels.cases(cases));
  const conds = f.conditions
    .filter((c) => isCompleteCondition(c) && names.attribute(c.attributeId))
    .map((c) => labels.condition(names.attribute(c.attributeId)!, c.op, c.value.trim()));
  if (conds.length) out.push(labels.conditions(f.attributeMatch, conds.join('; ')));
  const coders = list(f.coderIds, names.coder);
  if (coders) out.push(labels.coders(coders));
  if (f.text.trim()) out.push(labels.text(f.text.trim()));
  if (f.overlap.on) {
    const others = list(f.overlap.codeIds, names.code);
    if (others) out.push(labels.colocation(f.overlap.mode, others));
  }
  return out.length ? out : [labels.all];
}
