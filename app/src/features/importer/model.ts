// The review list of the Import screen, as plain data: one row per incoming document (a file,
// pasted text, a survey table), what it will become, and the checks shown before importing
// (duplicates, warnings, a preview). Pure: the screen renders it and run.ts carries it out.

import { sha256 } from '@noble/hashes/sha2.js';
import { toHex } from '../../core/bytes';
import type { DocKind, SyncPoint } from '../../core/model/types';
import type { ImportedDoc, ImportedTableResult, ImportFormat, Span } from '../../core/import';
import { canonicalText } from '../../services/documents';
import type { SurveyMapping } from './survey';

export type RowOrigin = 'file' | 'paste';

/** The case a document goes to: none, an existing one, or a new one by name (empty: the document's name). */
export type CaseChoice = { mode: 'none' } | { mode: 'existing'; id: string } | { mode: 'new'; name: string; custom?: boolean };

/** A group a document goes to: an existing group's id, or a new group by name. */
export type GroupRef = { id: string } | { name: string };

export interface Failure {
  /** ImportError code, or 'ERROR' for anything else. */
  code: string;
  detail: string | null;
  message?: string;
}

export interface MediaFile {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

export type RowStatus = 'reading' | 'ready' | 'password' | 'error';

export interface ReviewRow {
  id: string;
  origin: RowOrigin;
  /** File name as picked (or a label for pasted text). */
  filename: string;
  status: RowStatus;
  failure: Failure | null;
  /** Detected format; null while reading or when not supported. */
  format: ImportFormat | null;
  include: boolean;
  name: string;
  kind: DocKind;
  doc: ImportedDoc | null;
  table: ImportedTableResult | null;
  survey: SurveyMapping | null;
  caseChoice: CaseChoice;
  groups: GroupRef[];
  autoCodeSpeakers: boolean;
  media: MediaFile | null;
  /** SHA-256 of the canonical text (documents only). */
  sha: string | null;
  words: number;
}

export function newRow(id: string, origin: RowOrigin, filename: string): ReviewRow {
  return {
    id,
    origin,
    filename,
    status: 'reading',
    failure: null,
    format: null,
    include: true,
    name: '',
    kind: 'text',
    doc: null,
    table: null,
    survey: null,
    caseChoice: { mode: 'none' },
    groups: [],
    autoCodeSpeakers: false,
    media: null,
    sha: null,
    words: 0,
  };
}

export const textSha256 = (text: string): string => toHex(sha256(new TextEncoder().encode(canonicalText(text))));

/** A row after its file was read as a document. Keeps what the researcher already chose. */
export function withDoc(row: ReviewRow, doc: ImportedDoc): ReviewRow {
  return {
    ...row,
    status: 'ready',
    failure: null,
    format: doc.source.format,
    doc,
    table: null,
    survey: null,
    name: row.name || doc.name,
    kind: doc.kind,
    sha: textSha256(doc.text),
    words: wordCount(doc.text),
    autoCodeSpeakers: doc.kind === 'transcript' ? row.autoCodeSpeakers : false,
  };
}

export function withTable(row: ReviewRow, table: ImportedTableResult, survey: SurveyMapping): ReviewRow {
  return { ...row, status: 'ready', failure: null, format: table.format, doc: null, table, survey, name: row.name || table.table.name, kind: 'survey', sha: null, words: 0 };
}

export function withFailure(row: ReviewRow, failure: Failure): ReviewRow {
  const password = failure.code === 'ENCRYPTED_PDF';
  return { ...row, status: password ? 'password' : 'error', failure, include: password ? row.include : false };
}

/** What a row may be imported as: transcripts can be read as plain text and back. */
export function kindOptions(row: Pick<ReviewRow, 'format' | 'kind'>): DocKind[] {
  switch (row.format) {
    case 'csv':
    case 'xlsx':
      return ['survey'];
    case 'vtt':
    case 'srt':
      return ['transcript'];
    case 'pdf':
      return ['pdf', 'transcript'];
    case null:
      return [row.kind];
    default:
      return ['text', 'transcript'];
  }
}

/** The importer's transcript option for a kind the researcher picked (null: no re-read needed). */
export function transcriptModeFor(format: ImportFormat | null, kind: DocKind): 'always' | 'never' | null {
  if (!format || format === 'csv' || format === 'xlsx' || format === 'vtt' || format === 'srt') return null;
  return kind === 'transcript' ? 'always' : 'never';
}

/** Rows that will be imported. */
export const importable = (r: ReviewRow): boolean =>
  r.include && r.status === 'ready' && (r.doc !== null || (r.table !== null && r.survey !== null)) && r.name.trim().length > 0;

// ---------------------------------------------------------------------------------------------
// Duplicates

export type Duplicate = { kind: 'project'; name: string } | { kind: 'batch'; rowId: string; name: string };

/**
 * Rows whose text is already in the project (same SHA-256 of the canonical text as a document's
 * source.text_sha256), or that repeat an earlier row of this batch.
 */
export function findDuplicates(rows: readonly Pick<ReviewRow, 'id' | 'sha' | 'name' | 'filename'>[], existing: ReadonlyMap<string, string>): Map<string, Duplicate> {
  const out = new Map<string, Duplicate>();
  const first = new Map<string, Pick<ReviewRow, 'id' | 'name' | 'filename'>>();
  for (const r of rows) {
    if (!r.sha) continue;
    const there = existing.get(r.sha);
    if (there !== undefined) {
      out.set(r.id, { kind: 'project', name: there });
      continue;
    }
    const earlier = first.get(r.sha);
    if (earlier) out.set(r.id, { kind: 'batch', rowId: earlier.id, name: earlier.name || earlier.filename });
    else first.set(r.sha, r);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Preview

export interface PreviewParagraph {
  /** The speaker label of a transcript turn ("Interviewer"), without the colon. */
  speaker: string | null;
  text: string;
  /** Media time at the start of the paragraph, when the transcript has one. */
  ms: number | null;
}

export interface Preview {
  paragraphs: PreviewParagraph[];
  truncated: boolean;
}

/**
 * The first `max` characters as paragraphs. For transcripts the speaker label of each turn is
 * split off (the speakers' spans start right after "Name: "), and the timestamp shown.
 */
export function previewOf(doc: Pick<ImportedDoc, 'text' | 'speakers' | 'sync'>, max = 2000): Preview {
  const text = doc.text.slice(0, max);
  const truncated = doc.text.length > max;
  // Span start → speaker, for the spans that begin within the preview.
  const turnAt = new Map<number, string>();
  for (const s of doc.speakers) for (const sp of s.spans) if (sp.start < max) turnAt.set(sp.start, s.name);
  const syncs: SyncPoint[] = doc.sync.filter((s) => s.pos <= max);
  let si = 0;
  const paragraphs: PreviewParagraph[] = [];
  let pos = 0;
  for (const line of text.split('\n')) {
    const end = pos + line.length;
    let speaker: string | null = null;
    let body = line;
    if (turnAt.size) {
      // The turn's words start after the label: find a span starting within this line.
      for (let p = pos; p <= Math.min(end, pos + 120); p++) {
        const who = turnAt.get(p);
        if (who !== undefined && p > pos) {
          speaker = who;
          body = line.slice(p - pos).trimStart();
          break;
        }
        if (who !== undefined) break;
      }
    }
    while (si < syncs.length && syncs[si]!.pos < pos) si++;
    const ms = si < syncs.length && syncs[si]!.pos <= end ? syncs[si]!.ms : null;
    if (line.trim() || paragraphs.length) paragraphs.push({ speaker, text: body, ms });
    pos = end + 1;
  }
  while (paragraphs.length && !paragraphs[paragraphs.length - 1]!.text.trim() && !paragraphs[paragraphs.length - 1]!.speaker) paragraphs.pop();
  return { paragraphs, truncated };
}

/** 0:42, 12:05, 1:02:09 */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ---------------------------------------------------------------------------------------------
// Speakers

export interface SpeakerPlan {
  name: string;
  spans: Span[];
}

const nameKey = (s: string) => s.replace(/\s+/g, ' ').trim().normalize('NFC').toLocaleLowerCase();

/** Sorts spans and joins those that overlap or touch (one coding each, as the merge rule would). */
export function coalesce(spans: readonly Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/**
 * Auto-coding speakers: one code per speaker (names that differ only in case or spacing are one
 * speaker) with every turn's words as its spans, in order of first appearance.
 */
export function speakerPlan(speakers: ImportedDoc['speakers'], max = 120): SpeakerPlan[] {
  const byKey = new Map<string, SpeakerPlan>();
  for (const s of speakers) {
    const name = s.name.replace(/\s+/g, ' ').trim().slice(0, max).trim();
    if (!name || !s.spans.length) continue;
    const k = nameKey(name);
    const plan = byKey.get(k) ?? { name, spans: [] };
    plan.spans.push(...s.spans);
    byKey.set(k, plan);
  }
  const plans = [...byKey.values()].map((p) => ({ name: p.name, spans: coalesce(p.spans) })).filter((p) => p.spans.length);
  return plans.sort((a, b) => a.spans[0]!.start - b.spans[0]!.start);
}

/** Turn counts per speaker, for the review panel. */
export function speakerSummary(speakers: ImportedDoc['speakers']): { name: string; turns: number }[] {
  return speakerPlan(speakers).map((p) => ({ name: p.name, turns: p.spans.length }));
}

// ---------------------------------------------------------------------------------------------
// Cases and groups across the batch

export { nameKey };

export const sameGroup = (a: GroupRef, b: GroupRef): boolean =>
  'id' in a ? 'id' in b && a.id === b.id : 'name' in b && nameKey(a.name) === nameKey(b.name);

export function toggleGroup(groups: readonly GroupRef[], g: GroupRef): GroupRef[] {
  return groups.some((x) => sameGroup(x, g)) ? groups.filter((x) => !sameGroup(x, g)) : [...groups, g];
}

// ---------------------------------------------------------------------------------------------
// Media

export const MEDIA_EXTENSIONS: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
};

const extOf = (filename: string) => {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m ? m[1]!.toLowerCase() : '';
};
const stem = (filename: string) => nameKey((filename.split(/[\\/]/).pop() ?? filename).replace(/\.[a-z0-9]+$/i, ''));

export const isMediaFile = (filename: string): boolean => extOf(filename) in MEDIA_EXTENSIONS;
export const mediaMime = (filename: string): string => MEDIA_EXTENSIONS[extOf(filename)] ?? 'application/octet-stream';

/**
 * The transcript a recording belongs to, when it arrives with the transcripts: the one row
 * without a recording whose file has the same name ("Interview 3.mp3" ↔ "Interview 3.vtt").
 */
export function matchMedia(filename: string, rows: readonly Pick<ReviewRow, 'id' | 'filename' | 'kind' | 'media' | 'status'>[]): string | null {
  const s = stem(filename);
  const hits = rows.filter((r) => r.status !== 'error' && r.kind === 'transcript' && !r.media && stem(r.filename) === s);
  return hits.length === 1 ? hits[0]!.id : null;
}

// ---------------------------------------------------------------------------------------------
// Totals

export interface BatchTotals {
  documents: number;
  cases: number;
}

/** What Import will create, for the button and the confirmation line. */
export function batchTotals(rows: readonly ReviewRow[], surveyCount: (row: ReviewRow) => { documents: number; cases: number }): BatchTotals {
  let documents = 0;
  let cases = 0;
  for (const r of rows) {
    if (!importable(r)) continue;
    if (r.table) {
      const c = surveyCount(r);
      documents += c.documents;
      cases += c.cases;
    } else documents++;
  }
  return { documents, cases };
}

export function formatBytes(n: number, bcp47: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const digits = u === 0 || v >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(bcp47, { maximumFractionDigits: digits }).format(v)} ${units[u]}`;
}

/** Words in a text (for the list's sizes): runs of letters or digits. */
export function wordCount(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}
