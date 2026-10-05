// Record builders for the analysis tests (fictional data only). Not imported by the app.
import type { Attribute, AttributeType, AttributeValue, Case, Code, Coding, Document } from '../model/types';

const BASE = { created_at: '2026-01-01T00:00:00Z', updated_at_hlc: '0', deleted: false };
let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;

export function coding(
  document_id: string,
  code_id: string,
  start: number,
  end: number,
  extra: Partial<Coding> = {},
): Coding {
  return {
    ...BASE,
    id: extra.id ?? nextId('cg'),
    document_id,
    code_id,
    coder_id: 'ana',
    start,
    end,
    text: '',
    comment: '',
    ...extra,
  };
}

export function doc(id: string, chars: number, extra: Partial<Document> = {}): Document {
  return {
    ...BASE,
    id,
    name: id,
    kind: 'text',
    group_ids: [],
    case_id: null,
    source: null,
    original: null,
    media: null,
    chars,
    order: 0,
    color: null,
    ...extra,
  };
}

export function code(id: string, extra: Partial<Code> = {}): Code {
  return {
    ...BASE,
    id,
    name: id,
    parent_id: null,
    color: '#3a6ea5',
    description: '',
    inclusion: '',
    exclusion: '',
    example: '',
    order: 0,
    codable: true,
    shortcut: null,
    ...extra,
  };
}

export function kase(id: string, values: Record<string, AttributeValue>, extra: Partial<Case> = {}): Case {
  return { ...BASE, id, name: id, description: '', values, color: null, ...extra };
}

export function attribute(id: string, type: AttributeType, options: string[] = []): Attribute {
  return { ...BASE, id, name: id, type, options, description: '', order: 0 };
}

/** A descendants function over a parent map (child → parent). */
export function treeOf(parents: Record<string, string | null>): (id: string) => string[] {
  return (id) => {
    const out: string[] = [];
    const walk = (p: string) => {
      for (const [child, parent] of Object.entries(parents)) {
        if (parent === p) {
          out.push(child);
          walk(child);
        }
      }
    };
    walk(id);
    return out;
  };
}

/** A small deterministic PRNG (mulberry32) for generated test data. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
