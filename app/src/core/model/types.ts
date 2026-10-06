// The project data model. Every record carries the same base fields so that export, merge
// (a teammate's copy of the project) and backups can treat all kinds alike.
//
// Text positions: every `start`/`end` in this model is a UTF-16 code-unit offset into the
// document's canonical text (DocText.text), half-open [start, end). The canonical text is
// LF-only, without a BOM, Unicode NFC. REFI-QDA files count Unicode code points instead;
// core/qda/offsets.ts converts at the boundary.

export interface Base {
  id: string;
  created_at: string; // ISO 8601 UTC
  updated_at_hlc: string;
  deleted: boolean;
}

/** The palette offered for codes, groups and coders (any #rrggbb is accepted). */
export const PALETTE = [
  '#e4572e', '#f3a712', '#a8c256', '#29a37a', '#2b9eb3', '#3a6ea5',
  '#6c4ab6', '#b5179e', '#d1495b', '#8c6d46', '#5c946e', '#7a7f87',
] as const;

export const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** Someone who codes in this project. Who "I" am on this computer is local (store meta `me`). */
export interface Coder extends Base {
  name: string;
  color: string;
}

export const DOC_KINDS = ['text', 'transcript', 'pdf', 'survey', 'note'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Where a document came from. Kept for the audit trail and for REFI-QDA export. */
export interface DocSource {
  filename: string;
  /** Lower-case format id: txt, md, docx, odt, rtf, html, pdf, vtt, srt, csv, xlsx, qdpx, paste, new. */
  format: string;
  imported_at: string;
  /** SHA-256 (hex) of the canonical text at import: matches copies of the same document. */
  text_sha256: string;
}

export interface MediaRef {
  blob_id: string;
  filename: string;
  mime: string;
  size: number;
}

/**
 * A document's metadata. Its text lives in a separate `doctext` record with the same id, so
 * lists of documents never load whole transcripts.
 */
export interface Document extends Base {
  name: string;
  kind: DocKind;
  /** Document groups (sets) this document belongs to. */
  group_ids: string[];
  /** The case (participant, site, organisation…) the document belongs to, if any. */
  case_id: string | null;
  source: DocSource | null;
  /** The original file (a PDF or Word document), encrypted, when it was kept. */
  original: MediaRef | null;
  /** Audio or video the transcript belongs to, encrypted. */
  media: MediaRef | null;
  /** Length of the text in UTF-16 code units (copied from DocText for lists). */
  chars: number;
  /** Sort key within the document list (fractional ordering). */
  order: number;
  color: string | null;
}

/** A transcript timestamp: the text at `pos` is spoken at `ms` milliseconds into the media. */
export interface SyncPoint {
  pos: number;
  ms: number;
}

/** A document's canonical text. `id` equals the document's id. */
export interface DocText extends Base {
  text: string;
  /** Transcript timestamps, sorted by pos (empty for other documents). */
  sync: SyncPoint[];
  /**
   * The text's revision history, oldest first, the current one last (up to REVS_MAX): a fresh
   * random id (16 hex digits) for every write of the text (services/revs.ts). A merge uses it to
   * tell a teammate's later version of the text (it lists this one's latest id) from a text
   * changed on both sides. An id prefixed `~` is a teammate's revision this text was kept over in
   * a conflict. Older projects hold content hashes here, or nothing.
   */
  revs?: string[];
}

/**
 * How many text revisions a DocText remembers: enough that one side saving a document many
 * times between two merges never pushes out the revision the other side still has.
 */
export const REVS_MAX = 2000;

export interface Code extends Base {
  name: string;
  parent_id: string | null;
  color: string;
  /** Definition (the codebook's "description"). */
  description: string;
  /** When to apply the code. */
  inclusion: string;
  /** When not to apply it. */
  exclusion: string;
  /** A typical example (often a quote). */
  example: string;
  /** Sort key among siblings (fractional ordering). */
  order: number;
  /** false: a category that only groups other codes and cannot be applied. */
  codable: boolean;
  /** Favourite key 1–9 for quick coding, unique among live codes. */
  shortcut: number | null;
}

/** One code applied to one span of one document by one coder. */
export interface Coding extends Base {
  document_id: string;
  code_id: string;
  coder_id: string;
  start: number;
  end: number;
  /** The coded text, kept in step with the document so retrieval needs no document load. */
  text: string;
  /** A short comment on this coded segment. */
  comment: string;
}

export interface DocGroup extends Base {
  name: string;
  color: string;
  order: number;
}

export const ATTRIBUTE_TYPES = ['text', 'number', 'date', 'boolean', 'choice'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];
export type AttributeValue = string | number | boolean | null;

/** A case variable: age, gender, site, cohort… */
export interface Attribute extends Base {
  name: string;
  type: AttributeType;
  /** Allowed values of a `choice` attribute. */
  options: string[];
  description: string;
  order: number;
}

/** A unit of analysis (a participant, a site…). Documents point to their case. */
export interface Case extends Base {
  name: string;
  description: string;
  /** Attribute id → value. */
  values: Record<string, AttributeValue>;
  color: string | null;
}

export const MEMO_TARGETS = ['project', 'document', 'code', 'coding', 'case'] as const;
export type MemoTargetKind = (typeof MEMO_TARGETS)[number];
export type MemoTarget = { kind: 'project'; id: null } | { kind: Exclude<MemoTargetKind, 'project'>; id: string };

export interface Memo extends Base {
  title: string;
  /** Plain text with light Markdown (headings, lists, **bold**, *italic*). */
  body: string;
  target: MemoTarget;
  coder_id: string | null;
  color: string | null;
}

/**
 * One entry of the pseudonymisation key: `original` was replaced by `replacement` across the
 * documents. The key is personal data; it is left out of exports unless the researcher
 * explicitly includes it.
 */
export interface Pseudonym extends Base {
  original: string;
  replacement: string;
  note: string;
  whole_word: boolean;
  case_sensitive: boolean;
  /** When it was last applied, and how many replacements that made. */
  applied_at: string | null;
  applied_count: number;
}

export const LOG_ACTIONS = [
  'project.create', 'project.merge', 'project.import',
  'document.add', 'document.rename', 'document.edit', 'document.delete', 'document.restore',
  'code.create', 'code.rename', 'code.edit', 'code.move', 'code.merge', 'code.split', 'code.delete', 'code.restore',
  'coding.add', 'coding.remove', 'coding.edit', 'coding.autocode',
  'memo.create', 'memo.edit', 'memo.delete',
  'case.create', 'case.edit', 'case.delete', 'attribute.edit',
  'group.create', 'group.edit', 'group.delete',
  'pseudonym.apply', 'export', 'backup',
  'coder.add', 'coder.edit',
] as const;
export type LogAction = (typeof LOG_ACTIONS)[number];

/** The audit trail: append-only, one entry per meaningful change. */
export interface LogEntry extends Base {
  at: string; // ISO time
  coder_id: string | null;
  action: LogAction;
  /** Human-readable, language-neutral detail (names, counts), e.g. `"Trust" → "Interview 3"`. */
  summary: string;
  target_kind: string | null;
  target_id: string | null;
}

export interface Setting extends Base {
  // id is the setting key
  value: unknown;
}

export interface KindMap {
  coder: Coder;
  document: Document;
  doctext: DocText;
  code: Code;
  coding: Coding;
  docgroup: DocGroup;
  attribute: Attribute;
  case: Case;
  memo: Memo;
  pseudonym: Pseudonym;
  log: LogEntry;
  setting: Setting;
}

export type Kind = keyof KindMap;
export type Entity<K extends Kind> = KindMap[K];
export type Draft<K extends Kind> = Omit<Entity<K>, keyof Base> & Partial<Pick<Base, 'id'>>;

export const KINDS: readonly Kind[] = [
  'coder', 'document', 'doctext', 'code', 'coding', 'docgroup', 'attribute', 'case', 'memo', 'pseudonym', 'log', 'setting',
];

/** Limits that keep a project responsive. */
export const LIMITS = {
  nameMax: 200,
  codeNameMax: 120,
  textMax: 20_000_000, // characters of one document
  commentMax: 4_000,
  memoMax: 1_000_000,
  mediaMaxBytes: 2 * 1024 * 1024 * 1024 - 1,
} as const;

/** Project-wide settings (stored as `setting` records, so they travel with the project). */
export const SETTING_KEYS = {
  projectName: 'project.name',
  projectDescription: 'project.description',
  /** Language of the material, for word frequencies and stop words: 'en' | 'pt' | 'es' | …. */
  textLanguage: 'project.text_language',
  /** Words left out of word frequencies, in addition to the language's stop words. */
  extraStopwords: 'analysis.extra_stopwords',
} as const;
