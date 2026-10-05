// REFI-QDA project export: ProjectBundle → .qdpx (ZIP with project.qde and sources/).
//
// Follows the reference's advice for the widest compatibility: lower-case `sources/`, UTF-8
// text files without a BOM, LF line endings (CRLF on request for MAXQDA, positions unchanged),
// code-point offsets, strict XSD element order. See docs/spec/refi-qda.md for the mapping.
import { zipSync, type Zippable } from 'fflate';
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, utf8 } from '../../bytes';
import type {
  Attribute,
  Case,
  Code,
  Coder,
  Coding,
  DocGroup,
  DocText,
  Document,
  Memo,
} from '../../model/types';
import { HEX_COLOR } from '../../model/types';
import type { ProjectBundle } from '../bundle';
import {
  CODE_SECTIONS,
  excerpt,
  extFor,
  formatDateTime,
  GuidMap,
  PROJECT_NS,
  PROJECT_SCHEMA_LOCATION,
  toDecimal,
  XSI_NS,
} from './common';
import { codePointMap, type OffsetMap } from './positions';
import { XmlWriter } from './xml';

export interface QdpxExportOptions {
  /** The producer, e.g. "Trama 0.1.0" (Project@origin). */
  origin: string;
  /** Write text files with CRLF line endings (MAXQDA shifts codings otherwise); positions stay LF-based. */
  crlfForMaxqda?: boolean;
  /** Memos as Notes (default true). */
  includeMemos?: boolean;
  /** Audio/video files of transcripts (default true). */
  includeMedia?: boolean;
  /**
   * Original PDFs of documents whose text changed since import (pseudonymisation, typo fixes).
   * Left out by default: the original would still show what was edited away.
   */
  includeEditedOriginals?: boolean;
  now?: () => Date;
}

export interface QdpxExport {
  bytes: Uint8Array;
  /** What could not be carried over, in plain language. */
  warnings: string[];
}

/** REFI-QDA limit for one internal file. */
const MAX_INTERNAL_FILE = 2_147_483_647;
const SELECTION_NAME_CHARS = 100;
const ALREADY_COMPRESSED = /^(audio|video|image)\/|^application\/(pdf|zip|vnd\.openxmlformats)/;

interface Live {
  coders: Coder[];
  codes: Code[];
  attributes: Attribute[];
  cases: Case[];
  documents: Document[];
  texts: Map<string, DocText>;
  codings: Coding[];
  groups: DocGroup[];
  memos: Memo[];
}

function collect(bundle: ProjectBundle): Live {
  const live: Live = { coders: [], codes: [], attributes: [], cases: [], documents: [], texts: new Map(), codings: [], groups: [], memos: [] };
  for (const r of bundle.records) {
    // Tombstones never leave the project, nor does the pseudonymisation key.
    if (r.record.deleted) continue;
    switch (r.kind) {
      case 'coder': live.coders.push(r.record); break;
      case 'code': live.codes.push(r.record); break;
      case 'attribute': live.attributes.push(r.record); break;
      case 'case': live.cases.push(r.record); break;
      case 'document': live.documents.push(r.record); break;
      case 'doctext': live.texts.set(r.record.id, r.record); break;
      case 'coding': live.codings.push(r.record); break;
      case 'docgroup': live.groups.push(r.record); break;
      case 'memo': live.memos.push(r.record); break;
      default: break;
    }
  }
  const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => a.order - b.order || a.name.localeCompare(b.name);
  live.codes.sort(byOrder);
  live.attributes.sort(byOrder);
  live.documents.sort(byOrder);
  live.groups.sort(byOrder);
  live.cases.sort((a, b) => a.name.localeCompare(b.name));
  return live;
}

/** A document as it is written: which elements and files it becomes. */
interface DocOut {
  doc: Document;
  text: string;
  cp: OffsetMap;
  guid: string;
  txtFile: string;
  pdf: { guid: string; file: string; repGuid: string; repFile: string } | null;
  media: { guid: string; file: string; video: boolean; transcriptGuid: string } | null;
}

export function exportQdpx(bundle: ProjectBundle, opts: QdpxExportOptions): QdpxExport {
  return new ProjectWriter(bundle, opts).write();
}

class ProjectWriter {
  private readonly live: Live;
  private readonly guids = new GuidMap();
  private readonly warnings: string[] = [];
  private readonly counts = new Map<string, number>();
  private readonly files: Zippable = {};
  private readonly includeMemos: boolean;
  private readonly now: Date;

  private readonly coderIds: Set<string>;
  private readonly codeIds: Set<string>;
  /** Memo NoteRefs to write inside each target (by target id); project memos under 'project'. */
  private readonly noteRefs = new Map<string, string[]>();
  private readonly caseMemos: { note: string; caseGuid: string }[] = [];
  private readonly writtenMemos: Memo[] = [];

  constructor(
    private readonly bundle: ProjectBundle,
    private readonly opts: QdpxExportOptions,
  ) {
    this.live = collect(bundle);
    this.includeMemos = opts.includeMemos !== false;
    this.now = (opts.now ?? (() => new Date()))();
    this.coderIds = new Set(this.live.coders.map((c) => c.id));
    this.codeIds = new Set(this.live.codes.map((c) => c.id));
  }

  private count(message: string, n = 1): void {
    this.counts.set(message, (this.counts.get(message) ?? 0) + n);
  }

  write(): QdpxExport {
    const docs = this.planDocuments();
    if (this.includeMemos) this.planMemos(docs);
    const x = new XmlWriter();
    x.declaration();
    x.open('Project', {
      xmlns: PROJECT_NS,
      'xmlns:xsi': XSI_NS,
      'xsi:schemaLocation': PROJECT_SCHEMA_LOCATION,
      name: this.bundle.project.name || 'Project',
      origin: this.opts.origin,
      creationDateTime: formatDateTime(this.now.toISOString()),
    });
    this.writeUsers(x);
    this.writeCodeBook(x);
    const numberTypes = this.writeVariables(x);
    this.writeCases(x, docs, numberTypes);
    this.writeSources(x, docs);
    if (this.includeMemos) {
      this.writeNotes(x);
      this.writeLinks(x);
    }
    this.writeSets(x, docs);
    if (this.bundle.project.description.trim()) x.leaf('Description', {}, this.bundle.project.description);
    for (const ref of this.noteRefs.get('project') ?? []) x.leaf('NoteRef', { targetGUID: ref });
    x.close();
    this.files['project.qde'] = utf8(x.toString());

    const mtime = this.now;
    const bytes = zipSync(this.files, { level: 6, mtime });
    const warnings = [...this.warnings, ...[...this.counts].map(([m, n]) => m.replace('{n}', String(n)))];
    return { bytes, warnings };
  }

  private addFile(name: string, data: Uint8Array, mime: string): boolean {
    if (data.length > MAX_INTERNAL_FILE) {
      this.warnings.push(`${name} is larger than the 2 GB REFI-QDA allows for one file and was left out.`);
      return false;
    }
    this.files[name] = ALREADY_COMPRESSED.test(mime) ? [data, { level: 0 }] : data;
    return true;
  }

  private textFile(text: string): Uint8Array {
    return utf8(this.opts.crlfForMaxqda ? text.replace(/\n/g, '\r\n') : text);
  }

  // --- documents -----------------------------------------------------------------------------

  private planDocuments(): DocOut[] {
    const out: DocOut[] = [];
    for (const doc of this.live.documents) {
      const dt = this.live.texts.get(doc.id);
      if (!dt) {
        this.count('{n} document(s) without text were left out.');
        continue;
      }
      const guid = this.guids.get(doc.id);
      const txtFile = `${guid}.txt`;
      const o: DocOut = { doc, text: dt.text, cp: codePointMap(dt.text), guid, txtFile, pdf: null, media: null };
      if (!this.addFile(`sources/${txtFile}`, this.textFile(dt.text), 'text/plain')) continue;

      if (doc.kind === 'pdf' && doc.original) {
        const bytes = this.bundle.blobs.get(doc.original.blob_id);
        const unchanged = doc.source !== null && doc.source.text_sha256 === toHex(sha256(utf8(dt.text)));
        if (!bytes) this.count('{n} original file(s) were missing and were left out.');
        else if (!unchanged && !this.opts.includeEditedOriginals) {
          this.count('{n} original PDF(s) were left out because their text was edited after import (for example pseudonymised); the edited text was exported.');
        } else {
          const file = `${guid}.pdf`;
          const repGuid = this.guids.fresh();
          // ATLAS.ti names the representation's text file after the representation.
          const repFile = `${repGuid}.txt`;
          if (this.addFile(`sources/${file}`, bytes, 'application/pdf')) {
            delete this.files[`sources/${txtFile}`];
            this.addFile(`sources/${repFile}`, this.textFile(dt.text), 'text/plain');
            o.pdf = { guid, file, repGuid, repFile };
          }
        }
      }
      if (doc.kind === 'transcript' && doc.media && this.opts.includeMedia !== false) {
        const bytes = this.bundle.blobs.get(doc.media.blob_id);
        if (!bytes) this.count('{n} audio/video file(s) were missing and were left out.');
        else {
          const mediaGuid = this.guids.fresh();
          const file = `${mediaGuid}.${extFor(doc.media.filename, doc.media.mime)}`;
          if (this.addFile(`sources/${file}`, bytes, doc.media.mime)) {
            o.media = { guid: mediaGuid, file, video: doc.media.mime.toLowerCase().startsWith('video/'), transcriptGuid: this.guids.fresh() };
          }
        }
      } else if (doc.kind === 'transcript' && dt.sync.length && !doc.media) {
        this.count('{n} transcript(s) without their recording were exported without time stamps.');
      }
      out.push(o);
    }
    return out;
  }

  // --- memos ---------------------------------------------------------------------------------

  private planMemos(docs: DocOut[]): void {
    const docIds = new Set(docs.map((d) => d.doc.id));
    const caseIds = new Set(this.live.cases.map((c) => c.id));
    const codingIds = new Set(this.exportableCodings(docIds).map((c) => c.id));
    for (const m of this.live.memos) {
      const note = this.guids.get(m.id);
      const t = m.target;
      let key: string;
      if (t.kind === 'project') key = 'project';
      else if ((t.kind === 'document' && docIds.has(t.id)) || (t.kind === 'code' && this.codeIds.has(t.id)) || (t.kind === 'coding' && codingIds.has(t.id))) key = t.id;
      else if (t.kind === 'case' && caseIds.has(t.id)) {
        // Cases cannot hold a NoteRef in REFI-QDA: a Link from the Note to the Case carries it.
        this.caseMemos.push({ note, caseGuid: this.guids.get(t.id) });
        this.writtenMemos.push(m);
        continue;
      } else {
        this.count('{n} memo(s) whose item was deleted were attached to the project.');
        key = 'project';
      }
      const list = this.noteRefs.get(key);
      if (list) list.push(note);
      else this.noteRefs.set(key, [note]);
      this.writtenMemos.push(m);
    }
  }

  private refs(x: XmlWriter, id: string): void {
    for (const ref of this.noteRefs.get(id) ?? []) x.leaf('NoteRef', { targetGUID: ref });
  }

  // --- elements ------------------------------------------------------------------------------

  private writeUsers(x: XmlWriter): void {
    if (!this.live.coders.length) return;
    x.open('Users');
    for (const c of this.live.coders) x.leaf('User', { guid: this.guids.get(c.id), name: c.name });
    x.close();
  }

  private writeCodeBook(x: XmlWriter): void {
    const { codes } = this.live;
    if (!codes.length) return;
    const byParent = new Map<string | null, Code[]>();
    for (const c of codes) {
      // A code whose parent is gone is written at the top rather than lost.
      const parent = c.parent_id && this.codeIds.has(c.parent_id) ? c.parent_id : null;
      const list = byParent.get(parent);
      if (list) list.push(c);
      else byParent.set(parent, [c]);
    }
    const written = new Set<string>();
    const writeCode = (c: Code) => {
      written.add(c.id);
      x.open('Code', { guid: this.guids.get(c.id), name: c.name, isCodable: c.codable, color: HEX_COLOR.test(c.color) ? c.color.toUpperCase() : undefined });
      const desc = codeDescription(c);
      if (desc) x.leaf('Description', {}, desc);
      this.refs(x, c.id);
      for (const k of byParent.get(c.id) ?? []) if (!written.has(k.id)) writeCode(k);
      x.close();
    };
    x.open('CodeBook').open('Codes');
    for (const c of byParent.get(null) ?? []) writeCode(c);
    // Codes caught in a parent cycle (corrupt data) are still written, at the top.
    for (const c of codes) if (!written.has(c.id)) writeCode(c);
    x.close().close();
  }

  /** Writes Variables; returns which number attributes hold only integers. */
  private writeVariables(x: XmlWriter): Map<string, 'Integer' | 'Float'> {
    const numberTypes = new Map<string, 'Integer' | 'Float'>();
    if (!this.live.attributes.length) return numberTypes;
    x.open('Variables');
    for (const a of this.live.attributes) {
      let type: string;
      if (a.type === 'number') {
        const ints = this.live.cases.every((c) => {
          const v = numberValue(c.values[a.id]);
          return v === null || Number.isInteger(v);
        });
        type = ints ? 'Integer' : 'Float';
        numberTypes.set(a.id, type as 'Integer' | 'Float');
      } else type = a.type === 'boolean' ? 'Boolean' : a.type === 'date' ? 'Date' : 'Text';
      if (a.type === 'choice') this.count('{n} choice attribute(s) were exported as text: REFI-QDA has no list of allowed values.');
      x.open('Variable', { guid: this.guids.get(a.id), name: a.name, typeOfVariable: type });
      if (a.description.trim()) x.leaf('Description', {}, a.description);
      x.close();
    }
    x.close();
    return numberTypes;
  }

  private writeCases(x: XmlWriter, docs: DocOut[], numberTypes: Map<string, 'Integer' | 'Float'>): void {
    if (!this.live.cases.length) return;
    const attrs = new Map(this.live.attributes.map((a) => [a.id, a]));
    x.open('Cases');
    for (const c of this.live.cases) {
      x.open('Case', { guid: this.guids.get(c.id), name: c.name });
      if (c.description.trim()) x.leaf('Description', {}, c.description);
      for (const a of this.live.attributes) {
        const v = c.values[a.id];
        if (v === null || v === undefined || v === '') continue;
        const el = valueElement(attrs.get(a.id)!, v, numberTypes.get(a.id) ?? 'Float');
        if (!el) {
          this.count('{n} attribute value(s) did not fit their type and were left out.');
          continue;
        }
        x.open('VariableValue').leaf('VariableRef', { targetGUID: this.guids.get(a.id) }).leaf(el[0], {}, el[1]).close();
      }
      for (const d of docs) {
        if (d.doc.case_id !== c.id) continue;
        x.leaf('SourceRef', { targetGUID: d.guid });
        if (d.media) x.leaf('SourceRef', { targetGUID: d.media.guid });
      }
      x.close();
    }
    x.close();
  }

  private exportableCodings(docIds: Set<string>): Coding[] {
    return this.live.codings.filter((c) => docIds.has(c.document_id) && this.codeIds.has(c.code_id));
  }

  private writeSources(x: XmlWriter, docs: DocOut[]): void {
    if (!docs.length) return;
    const docIds = new Set(docs.map((d) => d.doc.id));
    const codings = this.exportableCodings(docIds);
    const skipped = this.live.codings.length - codings.length;
    if (skipped) this.count('{n} coding(s) of deleted codes or documents were left out.', skipped);
    const byDoc = new Map<string, Coding[]>();
    for (const c of codings) {
      const list = byDoc.get(c.document_id);
      if (list) list.push(c);
      else byDoc.set(c.document_id, [c]);
    }
    x.open('Sources');
    for (const d of docs) {
      const docCodings = byDoc.get(d.doc.id) ?? [];
      if (d.pdf) {
        x.open('PDFSource', { guid: d.guid, name: d.doc.name, path: `internal://${d.pdf.file}`, creationDateTime: formatDateTime(d.doc.created_at) });
        x.open('Representation', { guid: d.pdf.repGuid, name: d.doc.name, plainTextPath: `internal://${d.pdf.repFile}` });
        this.writeSelections(x, d, docCodings);
        x.close();
        this.refs(x, d.doc.id);
        x.close();
      } else {
        x.open('TextSource', { guid: d.guid, name: d.doc.name, plainTextPath: `internal://${d.txtFile}`, creationDateTime: formatDateTime(d.doc.created_at) });
        this.writeSelections(x, d, docCodings);
        this.refs(x, d.doc.id);
        x.close();
      }
      if (d.media) this.writeMedia(x, d);
    }
    x.close();
  }

  /** One PlainTextSelection per (span, coder, comment), with one Coding per code. */
  private writeSelections(x: XmlWriter, d: DocOut, codings: Coding[]): void {
    const groups = new Map<string, Coding[]>();
    for (const c of codings) {
      if (c.start < 0 || c.end > d.text.length || c.end <= c.start) {
        this.count('{n} coding(s) outside their document text were left out.');
        continue;
      }
      const key = `${c.start}\u0000${c.end}\u0000${c.coder_id}\u0000${c.comment}`;
      const list = groups.get(key);
      if (list) list.push(c);
      else groups.set(key, [c]);
    }
    const ordered = [...groups.values()].sort((a, b) => a[0]!.start - b[0]!.start || a[0]!.end - b[0]!.end);
    for (const group of ordered) {
      const first = group[0]!;
      const coder = this.coderIds.has(first.coder_id) ? this.guids.get(first.coder_id) : undefined;
      const created = group.map((c) => c.created_at).sort()[0];
      x.open('PlainTextSelection', {
        guid: this.guids.fresh(),
        name: excerpt(d.text.slice(first.start, first.end), SELECTION_NAME_CHARS),
        startPosition: d.cp.forward(first.start, 'start'),
        endPosition: d.cp.forward(first.end, 'end'),
        creatingUser: coder,
        creationDateTime: formatDateTime(created),
      });
      if (first.comment.trim()) x.leaf('Description', {}, first.comment);
      for (const c of group) {
        x.open('Coding', { guid: this.guids.get(c.id), creatingUser: coder, creationDateTime: formatDateTime(c.created_at) });
        x.leaf('CodeRef', { targetGUID: this.guids.get(c.code_id) });
        this.refs(x, c.id);
        x.close();
      }
      x.close();
    }
  }

  private writeMedia(x: XmlWriter, d: DocOut): void {
    const m = d.media!;
    const sync = this.live.texts.get(d.doc.id)?.sync ?? [];
    x.open(m.video ? 'VideoSource' : 'AudioSource', { guid: m.guid, name: d.doc.name, path: `internal://${m.file}`, creationDateTime: formatDateTime(d.doc.created_at) });
    // The transcript points at the same text file as the TextSource that carries the codings.
    x.open('Transcript', { guid: m.transcriptGuid, name: d.doc.name, plainTextPath: `internal://${d.txtFile}` });
    for (const p of sync) {
      if (p.pos < 0 || p.pos > d.text.length) continue;
      x.leaf('SyncPoint', { guid: this.guids.fresh(), position: d.cp.forward(p.pos, 'start'), timeStamp: Math.round(p.ms) });
    }
    x.close();
    x.close();
  }

  private writeNotes(x: XmlWriter): void {
    if (!this.writtenMemos.length) return;
    x.open('Notes');
    for (const m of this.writtenMemos) {
      const coder = m.coder_id && this.coderIds.has(m.coder_id) ? this.guids.get(m.coder_id) : undefined;
      x.open('Note', {
        guid: this.guids.get(m.id),
        name: m.title.trim() || excerpt(m.body, 60) || 'Memo',
        creatingUser: coder,
        creationDateTime: formatDateTime(m.created_at),
      });
      x.leaf('PlainTextContent', {}, m.body.replace(/\r\n?/g, '\n'));
      x.close();
    }
    x.close();
  }

  private writeLinks(x: XmlWriter): void {
    if (!this.caseMemos.length) return;
    x.open('Links');
    for (const l of this.caseMemos) {
      x.leaf('Link', { guid: this.guids.fresh(), name: 'Memo', direction: 'OneWay', originGUID: l.note, targetGUID: l.caseGuid });
    }
    x.close();
  }

  private writeSets(x: XmlWriter, docs: DocOut[]): void {
    if (!this.live.groups.length) return;
    x.open('Sets');
    for (const g of this.live.groups) {
      x.open('Set', { guid: this.guids.get(g.id), name: g.name });
      for (const d of docs) {
        if (!d.doc.group_ids.includes(g.id)) continue;
        x.leaf('MemberSource', { targetGUID: d.guid });
        if (d.media) x.leaf('MemberSource', { targetGUID: d.media.guid });
      }
      x.close();
    }
    x.close();
  }
}

/** The code's Description: its definition, then labelled inclusion/exclusion/example sections. */
export function codeDescription(c: Pick<Code, 'description' | 'inclusion' | 'exclusion' | 'example'>): string {
  const parts = [c.description.trim()];
  for (const key of ['inclusion', 'exclusion', 'example'] as const) {
    const v = c[key].trim();
    if (v) parts.push(`${CODE_SECTIONS[key]}\n${v}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

function numberValue(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** The value element for an attribute value, or null when it cannot be written as its type. */
function valueElement(a: Attribute, v: string | number | boolean, numberType: 'Integer' | 'Float'): [string, string] | null {
  switch (a.type) {
    case 'number': {
      const n = numberValue(v);
      if (n === null) return null;
      return [numberType === 'Integer' ? 'IntegerValue' : 'FloatValue', toDecimal(n)];
    }
    case 'boolean': {
      if (typeof v === 'boolean') return ['BooleanValue', String(v)];
      const s = String(v).trim().toLowerCase();
      return s === 'true' || s === 'false' ? ['BooleanValue', s] : null;
    }
    case 'date': {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
      return m && !Number.isNaN(Date.parse(m[1]!)) ? ['DateValue', m[1]!] : null;
    }
    default:
      return ['TextValue', String(v)];
  }
}
