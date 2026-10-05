// Helpers shared by the REFI-QDA readers and writers.
import { uuid } from '../../ids';

export const PROJECT_NS = 'urn:QDA-XML:project:1.0';
export const CODEBOOK_NS = 'urn:QDA-XML:codebook:1.0';
export const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
export const PROJECT_SCHEMA_LOCATION = `${PROJECT_NS} http://schema.qdasoftware.org/versions/Project/v1.0/Project.xsd`;
export const CODEBOOK_SCHEMA_LOCATION = `${CODEBOOK_NS} http://schema.qdasoftware.org/versions/Codebook/v1.0/Codebook.xsd`;

export class RefiError extends Error {}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * GUIDs arrive upper-case (ATLAS.ti, NVivo), lower-case or wrapped in braces; they are
 * compared in one form. Anything else is still used as an opaque key (lenient import).
 */
export function normGuid(s: string | null | undefined): string | null {
  if (!s) return null;
  const g = s.trim().replace(/^\{(.*)\}$/, '$1').toLowerCase();
  return g || null;
}

export const isGuid = (s: string) => GUID.test(s);

/**
 * GUIDs for export: a record's id when it already is one (uuid v4 ids are), else a new one.
 * Every GUID handed out is unique within the file.
 */
export class GuidMap {
  private byId = new Map<string, string>();
  private used = new Set<string>();

  get(id: string): string {
    let g = this.byId.get(id);
    if (!g) {
      const lower = id.toLowerCase();
      g = isGuid(lower) && !this.used.has(lower) ? lower : this.fresh();
      this.byId.set(id, g);
      this.used.add(g);
    }
    return g;
  }

  /** A GUID for an element with no record of its own (a selection, a sync point). */
  fresh(): string {
    let g = uuid();
    while (this.used.has(g)) g = uuid();
    this.used.add(g);
    return g;
  }
}

/** xsd:dateTime (timezone optional, fractional seconds allowed) → ISO UTC, or null. */
export function parseDateTime(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?\s*$/i.exec(s);
  if (!m) return null;
  // Without a timezone (Transana) the time is taken as UTC: there is nothing better to go on.
  const tz = m[8] ? (m[8].toUpperCase() === 'Z' ? 'Z' : m[8].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : 'Z';
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}${(m[7] ?? '').slice(0, 4)}${tz}`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const year = new Date(t).getUTCFullYear();
  if (year < 1900 || year > 9999) return null;
  return new Date(t).toISOString();
}

/** ISO time → xsd:dateTime in UTC without milliseconds. */
export function formatDateTime(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** One line, trimmed, at most `max` characters (with an ellipsis when cut); `fallback` when empty. */
export function cleanName(s: string | null | undefined, max: number, fallback: string): string {
  const one = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!one) return fallback;
  return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
}

/** The start of a text as a one-line label (used for selection names). */
export function excerpt(text: string, maxCodePoints: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  const cps = Array.from(one);
  return cps.length > maxCodePoints ? cps.slice(0, maxCodePoints - 1).join('').trimEnd() + '…' : one;
}

/** `#RGB` / `#RRGGBB` in any case → `#rrggbb`, or null. */
export function normColor(s: string | null | undefined): string | null {
  if (!s) return null;
  const c = s.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : null;
}

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  wma: 'audio/x-ms-wma',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  '3gp': 'video/3gpp',
};

export function extOf(filename: string): string {
  const m = /\.([0-9a-z]{1,8})$/i.exec(filename);
  return m ? m[1]!.toLowerCase() : '';
}

export function mimeOf(filename: string, fallback = 'application/octet-stream'): string {
  return MIME_BY_EXT[extOf(filename)] ?? fallback;
}

/** File extension for a media file: its own when sensible, else one from the MIME type. */
export function extFor(filename: string, mime: string): string {
  const own = extOf(filename);
  if (own && MIME_BY_EXT[own]) return own;
  const hit = Object.entries(MIME_BY_EXT).find(([, m]) => m === mime.toLowerCase());
  return hit?.[0] ?? (own || 'bin');
}

/**
 * xsd:decimal for a finite number: no exponent, `.` as separator (FloatValue). Integers keep
 * their digits; fractions keep up to 15 significant digits, like the number's own display.
 */
export function toDecimal(n: number): string {
  if (!Number.isFinite(n)) throw new Error('not a finite number');
  const s = String(n);
  if (!/e/i.test(s)) return s;
  const [mant, expStr] = s.toLowerCase().split('e') as [string, string];
  const exp = Number(expStr);
  const neg = mant.startsWith('-');
  const [int, frac = ''] = mant.replace('-', '').split('.') as [string, string?];
  const digits = int + frac;
  const point = int.length + exp;
  let out: string;
  if (point <= 0) out = '0.' + '0'.repeat(-point) + digits;
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
  else out = digits.slice(0, point) + '.' + digits.slice(point);
  return (neg ? '-' : '') + out;
}

/**
 * Labels of the sections Trama appends to a code's Description for the fields REFI-QDA lacks.
 * Fixed English text, so a file reads back the same whatever the interface language was.
 */
export const CODE_SECTIONS = { inclusion: 'Inclusion criteria:', exclusion: 'Exclusion criteria:', example: 'Example:' } as const;

/** Splits Trama's labelled sections back out of a code description. */
export function splitCodeDescription(text: string): { description: string; inclusion: string; exclusion: string; example: string } {
  const out = { description: text, inclusion: '', exclusion: '', example: '' };
  const labels = Object.entries(CODE_SECTIONS) as [keyof typeof CODE_SECTIONS, string][];
  const re = new RegExp(`^(${labels.map(([, l]) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[ \\t]*\\n?`, 'gm');
  const hits = [...text.matchAll(re)];
  if (!hits.length) return out;
  out.description = text.slice(0, hits[0]!.index).trim();
  for (const [i, h] of hits.entries()) {
    const key = labels.find(([, l]) => l === h[1])![0];
    const end = hits[i + 1]?.index ?? text.length;
    out[key] = text.slice(h.index! + h[0].length, end).trim();
  }
  return out;
}
