import type { Draft, Kind } from './types';
import { ATTRIBUTE_TYPES, DOC_KINDS, HEX_COLOR, LIMITS, LOG_ACTIONS, MEMO_TARGETS, REVS_MAX } from './types';

export class ValidationError extends Error {
  constructor(
    readonly kind: Kind,
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${kind}.${field}: ${reason}`);
  }
}

function check(cond: boolean, kind: Kind, field: string, reason: string): asserts cond {
  if (!cond) throw new ValidationError(kind, field, reason);
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const lowerHex = (v: unknown) => str(v).toLowerCase();
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function name(kind: Kind, field: string, v: unknown, max: number): string {
  const s = str(v).replace(/\s+/g, ' ').trim();
  check(s.length > 0 && s.length <= max, kind, field, `required, up to ${max} characters`);
  return s;
}

function color(kind: Kind, field: string, v: unknown, nullable: boolean): string | null {
  if (nullable && (v === null || v === undefined)) return null;
  const c = lowerHex(v);
  check(HEX_COLOR.test(c), kind, field, '#rrggbb');
  return c;
}

function ids(kind: Kind, field: string, v: unknown): string[] {
  check(Array.isArray(v), kind, field, 'list of ids');
  return [...new Set((v as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0))];
}

function mediaRef(kind: Kind, field: string, v: unknown) {
  if (v === null || v === undefined) return null;
  const m = v as Record<string, unknown>;
  check(typeof m.blob_id === 'string' && m.blob_id.length > 0, kind, field, 'blob_id required');
  check(typeof m.filename === 'string', kind, field, 'filename');
  check(typeof m.mime === 'string', kind, field, 'mime');
  check(isInt(m.size) && m.size >= 0, kind, field, 'size');
  return { blob_id: m.blob_id, filename: m.filename, mime: m.mime, size: m.size };
}

/** Validates and tidies a draft before it is written. Returns the (possibly adjusted) draft. */
export function validate<K extends Kind>(kind: K, draft: Draft<K>): Draft<K> {
  const d = draft as Record<string, unknown>;
  switch (kind) {
    case 'coder':
      return { ...draft, name: name(kind, 'name', d.name, LIMITS.nameMax), color: color(kind, 'color', d.color, false) } as Draft<K>;

    case 'document': {
      check((DOC_KINDS as readonly string[]).includes(str(d.kind)), kind, 'kind', 'unknown document kind');
      check(isInt(d.chars) && d.chars >= 0, kind, 'chars', 'integer ≥ 0');
      check(isFiniteNum(d.order), kind, 'order', 'number');
      check(d.case_id === null || typeof d.case_id === 'string', kind, 'case_id', 'id or null');
      const src = d.source as Record<string, unknown> | null;
      if (src) {
        check(typeof src.filename === 'string' && typeof src.format === 'string', kind, 'source', 'filename and format');
        check(typeof src.imported_at === 'string' && typeof src.text_sha256 === 'string', kind, 'source', 'imported_at and text_sha256');
      }
      return {
        ...draft,
        name: name(kind, 'name', d.name, LIMITS.nameMax),
        group_ids: ids(kind, 'group_ids', d.group_ids ?? []),
        original: mediaRef(kind, 'original', d.original),
        media: mediaRef(kind, 'media', d.media),
        source: src ?? null,
        color: color(kind, 'color', d.color, true),
      } as Draft<K>;
    }

    case 'doctext': {
      const text = str(d.text);
      check(text.length <= LIMITS.textMax, kind, 'text', 'too long');
      check(!text.includes('\r'), kind, 'text', 'LF line endings only');
      check(Array.isArray(d.sync), kind, 'sync', 'list');
      const sync = (d.sync as { pos: unknown; ms: unknown }[]).map((s) => {
        check(isInt(s.pos) && s.pos >= 0 && s.pos <= text.length, kind, 'sync', 'pos within the text');
        check(isInt(s.ms) && s.ms >= 0, kind, 'sync', 'ms ≥ 0');
        return { pos: s.pos, ms: s.ms };
      });
      sync.sort((a, b) => a.pos - b.pos || a.ms - b.ms);
      if (d.revs === undefined) return { ...draft, text, sync } as Draft<K>;
      const revs = Array.isArray(d.revs) ? (d.revs as unknown[]).filter((r): r is string => typeof r === 'string' && /^~?[0-9a-f]{16}$/.test(r)) : [];
      return { ...draft, text, sync, revs: revs.slice(-REVS_MAX) } as Draft<K>;
    }

    case 'code': {
      check(d.parent_id === null || (typeof d.parent_id === 'string' && d.parent_id !== d.id), kind, 'parent_id', 'id or null, not itself');
      check(isFiniteNum(d.order), kind, 'order', 'number');
      check(typeof d.codable === 'boolean', kind, 'codable', 'boolean');
      check(d.shortcut === null || (isInt(d.shortcut) && d.shortcut >= 1 && d.shortcut <= 9), kind, 'shortcut', '1–9 or null');
      return {
        ...draft,
        name: name(kind, 'name', d.name, LIMITS.codeNameMax),
        color: color(kind, 'color', d.color, false),
        description: str(d.description),
        inclusion: str(d.inclusion),
        exclusion: str(d.exclusion),
        example: str(d.example),
      } as Draft<K>;
    }

    case 'coding': {
      check(typeof d.document_id === 'string' && d.document_id.length > 0, kind, 'document_id', 'required');
      check(typeof d.code_id === 'string' && d.code_id.length > 0, kind, 'code_id', 'required');
      check(typeof d.coder_id === 'string' && d.coder_id.length > 0, kind, 'coder_id', 'required');
      check(isInt(d.start) && isInt(d.end) && d.start >= 0 && d.end > d.start, kind, 'start', '0 ≤ start < end');
      const comment = str(d.comment);
      check(comment.length <= LIMITS.commentMax, kind, 'comment', 'too long');
      return { ...draft, text: str(d.text), comment } as Draft<K>;
    }

    case 'docgroup':
      check(isFiniteNum(d.order), kind, 'order', 'number');
      return { ...draft, name: name(kind, 'name', d.name, LIMITS.nameMax), color: color(kind, 'color', d.color, false) } as Draft<K>;

    case 'attribute': {
      check((ATTRIBUTE_TYPES as readonly string[]).includes(str(d.type)), kind, 'type', 'unknown attribute type');
      check(isFiniteNum(d.order), kind, 'order', 'number');
      const options = [...new Set(((d.options as unknown[]) ?? []).map((o) => str(o).trim()).filter(Boolean))];
      return { ...draft, name: name(kind, 'name', d.name, LIMITS.nameMax), options, description: str(d.description) } as Draft<K>;
    }

    case 'case': {
      const values: Record<string, string | number | boolean | null> = {};
      for (const [k, v] of Object.entries((d.values as Record<string, unknown>) ?? {})) {
        check(v === null || ['string', 'number', 'boolean'].includes(typeof v), kind, 'values', 'string, number, boolean or null');
        if (typeof v === 'number') check(Number.isFinite(v), kind, 'values', 'finite number');
        values[k] = v as string | number | boolean | null;
      }
      return {
        ...draft,
        name: name(kind, 'name', d.name, LIMITS.nameMax),
        description: str(d.description),
        values,
        color: color(kind, 'color', d.color, true),
      } as Draft<K>;
    }

    case 'memo': {
      const t = d.target as { kind?: unknown; id?: unknown } | undefined;
      check(!!t && (MEMO_TARGETS as readonly string[]).includes(str(t.kind)), kind, 'target', 'unknown target');
      check(t.kind === 'project' ? t.id === null : typeof t.id === 'string' && t.id.length > 0, kind, 'target', 'id required (null for project)');
      const body = str(d.body);
      check(body.length <= LIMITS.memoMax, kind, 'body', 'too long');
      const title = str(d.title).replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameMax);
      return { ...draft, title, body, coder_id: (d.coder_id as string | null) ?? null, color: color(kind, 'color', d.color, true) } as Draft<K>;
    }

    case 'pseudonym': {
      const original = str(d.original).trim();
      check(original.length > 0 && original.length <= LIMITS.nameMax, kind, 'original', 'required');
      const replacement = str(d.replacement).trim();
      check(replacement.length > 0 && replacement.length <= LIMITS.nameMax, kind, 'replacement', 'required');
      check(typeof d.whole_word === 'boolean' && typeof d.case_sensitive === 'boolean', kind, 'whole_word', 'booleans');
      check(d.applied_at === null || typeof d.applied_at === 'string', kind, 'applied_at', 'ISO or null');
      check(isInt(d.applied_count) && d.applied_count >= 0, kind, 'applied_count', 'integer ≥ 0');
      return { ...draft, original, replacement, note: str(d.note) } as Draft<K>;
    }

    case 'log':
      check(ISO.test(str(d.at)), kind, 'at', 'ISO UTC time');
      check((LOG_ACTIONS as readonly string[]).includes(str(d.action)), kind, 'action', 'unknown action');
      return { ...draft, summary: str(d.summary).slice(0, 2000), target_kind: (d.target_kind as string | null) ?? null, target_id: (d.target_id as string | null) ?? null, coder_id: (d.coder_id as string | null) ?? null } as Draft<K>;

    case 'setting':
      check(typeof d.id === 'string' && d.id.length > 0, kind, 'id', 'setting key required');
      return draft;

    default:
      throw new ValidationError(kind, 'kind', 'unknown kind');
  }
}
