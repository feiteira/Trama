// Case attribute values for analysis: coercion by attribute type, filter conditions, and
// value buckets (the columns of a code × attribute table).

import type { Attribute, AttributeType, AttributeValue, Case } from '../model/types';
import { type Bin, binIndex, quantileBins } from './stats';

/** Compares text values ignoring case, accents and surrounding/duplicate spaces. */
export function foldValue(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True for a missing value: null, undefined, NaN or a blank string. */
export function isEmptyValue(v: AttributeValue | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && Number.isNaN(v));
}

const NUMERIC = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/;
const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'sim', 'si', 'sí', 's', 'verdadeiro', 'verdadero', 'oui', 'ja', 'vrai']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'nao', 'não', 'falso', 'non', 'nein', 'nee', 'faux']);

/** A number from a number or a numeric string ("3,5" too: decimal commas are common); NaN otherwise. */
export function toNumber(v: AttributeValue | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const s = v.trim();
    if (NUMERIC.test(s)) return Number(s.replace(',', '.'));
  }
  return NaN;
}

/** A boolean from common spellings in the supported languages; null when unrecognised. */
export function toBoolean(v: AttributeValue | undefined): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 0 ? false : v === 1 ? true : null;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (TRUE_WORDS.has(s)) return true;
    if (FALSE_WORDS.has(s)) return false;
  }
  return null;
}

/** A case's value for an attribute, null when missing (or when there is no case). */
export function attributeValue(c: Case | null | undefined, attributeId: string): AttributeValue {
  if (!c) return null;
  const v = c.values[attributeId];
  return v === undefined || isEmptyValue(v) ? null : v;
}

// ---------------------------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------------------------

export type ConditionOp = 'eq' | 'neq' | 'lt' | 'gt' | 'contains' | 'empty' | 'notEmpty';

export interface AttributeCondition {
  attributeId: string;
  op: ConditionOp;
  /** The value to compare with (ignored by empty/notEmpty). Strings are coerced by type. */
  value?: AttributeValue;
}

function inferType(v: AttributeValue, w: AttributeValue | undefined): AttributeType {
  if (typeof v === 'number' || (typeof w === 'number' && !Number.isNaN(toNumber(v)))) return 'number';
  if (typeof v === 'boolean' || typeof w === 'boolean') return 'boolean';
  return 'text';
}

/** -1, 0, 1, or null when the two values are not comparable under the attribute's type. */
function compareValues(v: AttributeValue, w: AttributeValue | undefined, type: AttributeType, options: readonly string[]): number | null {
  if (isEmptyValue(v) || isEmptyValue(w)) return null;
  switch (type) {
    case 'number': {
      const a = toNumber(v);
      const b = toNumber(w);
      if (Number.isNaN(a) || Number.isNaN(b)) return null;
      return a < b ? -1 : a > b ? 1 : 0;
    }
    case 'boolean': {
      const a = toBoolean(v);
      const b = toBoolean(w);
      if (a === null || b === null) return null;
      return a === b ? 0 : a ? 1 : -1;
    }
    case 'choice': {
      // Options are ordered (education levels, Likert points…), so < and > follow that order.
      const fa = foldValue(String(v));
      const fb = foldValue(String(w));
      if (fa === fb) return 0;
      const ia = options.findIndex((o) => foldValue(o) === fa);
      const ib = options.findIndex((o) => foldValue(o) === fb);
      if (ia >= 0 && ib >= 0) return ia < ib ? -1 : 1;
      return fa < fb ? -1 : 1;
    }
    case 'date': {
      // Dates are ISO strings (YYYY-MM-DD…), which sort as text.
      const a = String(v).trim();
      const b = String(w).trim();
      return a < b ? -1 : a > b ? 1 : 0;
    }
    default: {
      const a = foldValue(String(v));
      const b = foldValue(String(w));
      if (a === b) return 0;
      return a.localeCompare(b) < 0 ? -1 : 1;
    }
  }
}

/**
 * Whether a value meets a condition. Text comparisons ignore case and accents. `neq` is true
 * for a missing value (it is not equal to anything); lt/gt/contains are false for one.
 * Without the attribute record, numbers and booleans are recognised from the values.
 */
export function meetsCondition(value: AttributeValue | undefined, cond: AttributeCondition, attribute?: Attribute): boolean {
  const v = value === undefined ? null : value;
  switch (cond.op) {
    case 'empty':
      return isEmptyValue(v);
    case 'notEmpty':
      return !isEmptyValue(v);
    default:
      break;
  }
  const type = attribute?.type ?? inferType(v, cond.value);
  const options = attribute?.options ?? [];
  if (cond.op === 'contains') {
    if (isEmptyValue(v) || isEmptyValue(cond.value)) return false;
    if (type === 'boolean') return compareValues(v, cond.value, type, options) === 0;
    return foldValue(String(v)).includes(foldValue(String(cond.value)));
  }
  const cmp = compareValues(v, cond.value, type, options);
  switch (cond.op) {
    case 'eq':
      return cmp === 0;
    case 'neq':
      return cmp !== 0;
    case 'lt':
      return cmp === -1;
    case 'gt':
      return cmp === 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------------------------

export type BucketKind = 'value' | 'range' | 'empty' | 'other';

export interface Bucket {
  /** Stable key: 'v:<folded value>', 'r:<index>', 'empty' or 'other'. */
  key: string;
  kind: BucketKind;
  /**
   * A language-neutral label: the value as first written, a range "18–29", "(no value)" or
   * "(other)". Screens should translate the 'empty' and 'other' kinds themselves.
   */
  label: string;
  /** The value (kind 'value'). */
  value?: AttributeValue;
  /** The range (kind 'range'): min inclusive, max exclusive (null = unbounded). */
  min?: number | null;
  max?: number | null;
}

export interface NumberRange {
  min?: number | null;
  max?: number | null;
  label?: string;
}

/**
 * How to bucket a number attribute: one bucket per distinct value, `count` quantile bins, or
 * the researcher's own half-open ranges [min, max). Values outside every range go to "(other)".
 */
export type BinSpec = { kind: 'distinct' } | { kind: 'quantile'; count: number } | { kind: 'ranges'; ranges: NumberRange[] };

export interface Bucketing {
  buckets: Bucket[];
  /**
   * The bucket key for a value. A value none of the given cases has (possible only when the
   * caller looks up a case outside the list) lands in "(other)", which is then added to
   * `buckets`: read `buckets` after assigning keys.
   */
  keyOf(value: AttributeValue | undefined): string;
}

export const EMPTY_LABEL = '(no value)';
export const OTHER_LABEL = '(other)';
const AUTO_DISTINCT_MAX = 8;

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));

/**
 * Buckets for an attribute over a set of cases. Order: choice options as defined, booleans
 * true then false, numbers ascending, dates chronologically, text alphabetically; then
 * "(other)" when used, and "(no value)" always last (always present so tables keep columns).
 * Number attributes default to distinct values when there are at most 8, else 4 quantile bins.
 */
export function attributeBuckets(cases: readonly Case[], attribute: Attribute, bins?: BinSpec): Bucketing {
  const values = cases.filter((c) => !c.deleted).map((c) => attributeValue(c, attribute.id)).filter((v) => v !== null);
  const empty: Bucket = { key: 'empty', kind: 'empty', label: EMPTY_LABEL };
  const other: Bucket = { key: 'other', kind: 'other', label: OTHER_LABEL };
  let usesOther = false;
  const finish = (list: Bucket[], keyOf: (v: AttributeValue) => string): Bucketing => {
    const buckets = [...list];
    if (usesOther) buckets.push(other);
    buckets.push(empty);
    return {
      buckets,
      keyOf: (v) => {
        if (v === undefined || isEmptyValue(v)) return 'empty';
        const k = keyOf(v);
        if (k === 'other' && !usesOther) {
          // A value not seen among the cases (a document's case outside the list): add it lazily.
          usesOther = true;
          buckets.splice(buckets.length - 1, 0, other);
        }
        return k;
      },
    };
  };

  if (attribute.type === 'number') {
    const nums = values.map(toNumber);
    if (nums.some((x) => Number.isNaN(x))) usesOther = true;
    const finite = nums.filter((x) => Number.isFinite(x));
    const distinct = [...new Set(finite)].sort((a, b) => a - b);
    const spec: BinSpec = bins ?? (distinct.length <= AUTO_DISTINCT_MAX ? { kind: 'distinct' } : { kind: 'quantile', count: 4 });
    if (spec.kind === 'distinct') {
      const list = distinct.map((x): Bucket => ({ key: `v:${x}`, kind: 'value', label: fmt(x), value: x }));
      const keys = new Set(list.map((b) => b.key));
      return finish(list, (v) => {
        const x = toNumber(v);
        const k = `v:${x}`;
        return keys.has(k) ? k : 'other';
      });
    }
    if (spec.kind === 'quantile') {
      const qb: Bin[] = quantileBins(finite, Math.max(1, Math.floor(spec.count)));
      const list = qb.map((b, i): Bucket => ({
        key: `r:${i}`,
        kind: 'range',
        label: b.min === b.max ? fmt(b.min) : `${fmt(b.min)}–${fmt(b.max)}`,
        min: b.lo,
        max: i === qb.length - 1 ? null : b.hi,
      }));
      return finish(list, (v) => {
        const i = binIndex(qb, toNumber(v));
        return i >= 0 ? `r:${i}` : 'other';
      });
    }
    const ranges = spec.ranges;
    const list = ranges.map((r, i): Bucket => {
      const lo = r.min ?? null;
      const hi = r.max ?? null;
      const label = r.label ?? (lo === null ? `< ${fmt(hi ?? Infinity)}` : hi === null ? `≥ ${fmt(lo)}` : `${fmt(lo)}–<${fmt(hi)}`);
      return { key: `r:${i}`, kind: 'range', label, min: lo, max: hi };
    });
    const keyOf = (v: AttributeValue) => {
      const x = toNumber(v);
      if (Number.isNaN(x)) return 'other';
      const i = ranges.findIndex((r) => (r.min === undefined || r.min === null || x >= r.min) && (r.max === undefined || r.max === null || x < r.max));
      return i >= 0 ? `r:${i}` : 'other';
    };
    if (values.some((v) => keyOf(v) === 'other')) usesOther = true;
    return finish(list, keyOf);
  }

  if (attribute.type === 'boolean') {
    const list: Bucket[] = [
      { key: 'v:true', kind: 'value', label: 'true', value: true },
      { key: 'v:false', kind: 'value', label: 'false', value: false },
    ];
    const keyOf = (v: AttributeValue) => {
      const b = toBoolean(v);
      return b === null ? 'other' : `v:${b}`;
    };
    if (values.some((v) => keyOf(v) === 'other')) usesOther = true;
    return finish(list, keyOf);
  }

  // text, choice, date: one bucket per distinct value (folded for text and choice).
  const keyFor = (v: AttributeValue) => (attribute.type === 'date' ? `v:${String(v).trim()}` : `v:${foldValue(String(v))}`);
  const seen = new Map<string, Bucket>();
  const add = (v: AttributeValue) => {
    const k = keyFor(v);
    if (!seen.has(k)) seen.set(k, { key: k, kind: 'value', label: String(v).trim(), value: typeof v === 'string' ? v.trim() : v });
  };
  if (attribute.type === 'choice') for (const o of attribute.options) if (o.trim()) add(o);
  const found = new Map<string, AttributeValue>();
  for (const v of values) if (!found.has(keyFor(v))) found.set(keyFor(v), v);
  const extra = [...found.entries()].filter(([k]) => !seen.has(k));
  extra.sort((a, b) =>
    attribute.type === 'date' ? (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) : String(a[1]).localeCompare(String(b[1])),
  );
  for (const [, v] of extra) add(v);
  const list = [...seen.values()];
  return finish(list, (v) => (seen.has(keyFor(v)) ? keyFor(v) : 'other'));
}
