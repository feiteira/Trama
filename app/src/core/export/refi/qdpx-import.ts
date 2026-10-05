// REFI-QDA project import: a .qdpx (ZIP with project.qde and sources/) → ProjectBundle.
//
// Real files deviate from the standard in many ways (see docs/spec/refi-qda.md): this reader is
// lenient about structure (namespaces, folder case, GUID case, missing references) and strict
// about producing valid Trama records. Every step that loses something adds a warning.
import type { Element } from '@xmldom/xmldom';
import { sha256 } from '@noble/hashes/sha2.js';
import { decodeText, toHex, utf8 } from '../../bytes';
import { uuid } from '../../ids';
import type { AttributeType, AttributeValue, DocKind, MediaRef, MemoTarget } from '../../model/types';
import { LIMITS, PALETTE } from '../../model/types';
import { validate } from '../../model/validate';
import { fold } from '../../text/normalize';
import type { ProjectBundle } from '../bundle';
import { cleanName, excerpt, extOf, mimeOf, normColor, normGuid, parseDateTime, RefiError, splitCodeDescription } from './common';
import {
  canonicalize,
  candidateModes,
  chooseMode,
  modeKey,
  scoreModes,
  stripBom,
  type CanonicalText,
  type PositionMode,
  type SelectionProbe,
} from './positions';
import { RecordFactory } from './records';
import { attr, child, children, localName, parseXml, textOf, XmlParseError } from './xml';
import { basename, dirname, ZipIndex } from './zip';

export interface QdpxImportOptions {
  /** Coder for codings whose author the file does not name (usually the researcher's own name). */
  defaultCoderName: string;
  /** Turn ATLAS.ti-style flattened names ("Parent::Child") into a code hierarchy. */
  splitColonNames?: boolean;
  now?: () => Date;
}

export { RefiError } from './common';

/** One kind of thing an import could not carry over, with how often it happened. */
export interface QdpxWarning {
  /** Stable, for the screens to word in the reader's language. */
  code: QdpxWarningCode;
  count: number;
  /** The name it concerns (a document, a file), for warnings about one item. */
  detail?: string;
  /** The same in plain English (logs, tests, anything without a translation). */
  message: string;
}

/** A REFI-QDA project read into a bundle, with its warnings as data (`warnings` holds their messages). */
export interface QdpxBundle extends ProjectBundle {
  issues: QdpxWarning[];
}

export async function importQdpx(zip: Uint8Array, opts: QdpxImportOptions): Promise<QdpxBundle> {
  const index = new ZipIndex(zip);
  const qde = findQde(index);
  if (!qde) throw new RefiError('No project.qde inside this file: it is not a REFI-QDA project.');
  const xml = decodeText(index.read([qde]).get(qde)!);
  let root: Element;
  try {
    root = parseXml(xml);
  } catch (e) {
    throw new RefiError(`The project.qde inside this file is not valid XML (${e instanceof XmlParseError ? e.message : String(e)}).`);
  }
  if (localName(root) !== 'Project') throw new RefiError('The project.qde inside this file is not a REFI-QDA project.');
  const reader = new ProjectReader(root, index, dirname(qde), opts);
  for (const name of index.refused) reader.note('unsafePath', name, `A file with an unsafe path was ignored: ${name}`);
  return reader.read();
}

/** project.qde (any case, shallowest), else any *.qde, as QualCoder accepts. */
function findQde(index: ZipIndex): string | null {
  const qdes = index.names.filter((n) => /\.qde$/i.test(n));
  const depth = (n: string) => n.split('/').length;
  qdes.sort((a, b) => depth(a) - depth(b) || Number(basename(b).toLowerCase() === 'project.qde') - Number(basename(a).toLowerCase() === 'project.qde'));
  return qdes[0] ?? null;
}

// ---------------------------------------------------------------------------------------------

interface CoderPlan {
  id: string;
  name: string;
}

interface CodePlan {
  id: string;
  guid: string;
  name: string;
  parent: string | null;
  color: string | null;
  description: string;
  inclusion: string;
  exclusion: string;
  example: string;
  codable: boolean;
  created: string | null;
  used: boolean;
}

interface AttrPlan {
  id: string;
  name: string;
  type: AttributeType;
  refiType: string;
  description: string;
}

interface CasePlan {
  id: string;
  name: string;
  description: string;
  values: Record<string, AttributeValue>;
  created: string | null;
  /** Case is a document's implicit case (variables written on the source). */
  implicitFor: string | null;
}

interface TextUnit {
  raw: string;
  probes: SelectionProbe[];
  canon?: CanonicalText;
}

interface DocPlan {
  id: string;
  name: string;
  kind: DocKind;
  created: string | null;
  guids: string[];
  unit: TextUnit;
  original: MediaRef | null;
  media: MediaRef | null;
  textSelections: Element[];
  syncPoints: Element[];
  transcriptSelections: Element[];
  wholeCodings: Element[];
  noteRefs: Element[];
  variableValues: Element[];
  caseId: string | null;
  groupIds: string[];
}

interface CodingPlan {
  id: string;
  docId: string;
  codeId: string;
  coderId: string;
  start: number;
  end: number;
  comment: string;
  created: string | null;
}

interface SelectionInfo {
  docId: string;
  start: number;
  end: number;
  codingIds: string[];
}

interface MemoPlan {
  /** The Note's GUID; null for a memo made from a selection's Description. */
  note: string | null;
  target: MemoTarget;
  quote?: string;
  /** Title and body of a memo that is not a Note. */
  title?: string;
  body?: string;
}

/** Warnings that may repeat, reported once with their count. */
const COUNTED = {
  pdfSelection: (n: number) => `${n} area selection(s) on PDF pages were not imported (Trama codes PDF text only).`,
  picture: (n: number) => `${n} picture source(s) were not imported (pictures are not supported yet).`,
  pictureSelection: (n: number) => `${n} coded area(s) on pictures were not imported.`,
  mediaSelection: (n: number) => `${n} coded audio/video time range(s) were not imported (Trama codes transcript text).`,
  externalMedia: (n: number) => `${n} audio/video file(s) stored outside the project file were not included; link them again in Trama.`,
  externalPdf: (n: number) => `${n} PDF file(s) stored outside the project file were not included (their text was imported when available).`,
  externalText: (n: number) => `${n} source(s) whose text file is stored outside the project file were skipped.`,
  missingFile: (n: number) => `${n} file(s) referenced by the project were missing from the archive.`,
  missingCode: (n: number) => `${n} coding(s) pointing to a code that does not exist were skipped.`,
  badSpan: (n: number) => `${n} coded segment(s) with positions outside their document were skipped.`,
  clampedSpan: (n: number) => `${n} coded segment(s) ran past the end of their document and were shortened.`,
  duplicateCoding: (n: number) => `${n} duplicate coding(s) (same code, coder and text) were merged.`,
  caseCoding: (n: number) => `${n} coding(s) to cases (NVivo case nodes) became document case assignments.`,
  twoCases: (n: number) => `${n} document(s) belonged to more than one case; the first case was kept.`,
  selectionCase: (n: number) => `${n} case assignment(s) of a text selection were applied to the whole document.`,
  caseCodeRef: (n: number) => `${n} code reference(s) on cases were not imported.`,
  link: (n: number) => `${n} link(s) between objects were not imported (Trama has no relations yet).`,
  codeSet: (n: number) => `${n} set(s) of codes were not imported (Trama groups documents only).`,
  noteMember: (n: number) => `${n} memo(s) listed in sets were not added to a document group.`,
  graph: (n: number) => `${n} graph(s) (networks, maps) were not imported.`,
  badValue: (n: number) => `${n} attribute value(s) did not match their type and were left empty.`,
  timeDropped: (n: number) => `${n} date-time value(s) kept their date only.`,
  conflictingValue: (n: number) => `${n} document variable value(s) conflicted with their case's value; the case's value was kept.`,
  sharedCaseValues: (n: number) => `${n} document variable value(s) were stored on a case shared with other documents.`,
  madeCodable: (n: number) => `${n} code(s) marked as folders had codings and were made codable.`,
  truncatedComment: (n: number) => `${n} long segment comment(s) were shortened; the full text is kept in a memo.`,
  truncatedMemo: (n: number) => `${n} memo(s) were too long and were shortened.`,
  noText: (n: number) => `${n} document(s) had no text and were imported empty.`,
  unresolvedNote: (n: number) => `${n} memo reference(s) pointed to something that does not exist and were attached to the project instead.`,
  syncPoint: (n: number) => `${n} transcript time stamp(s) without a position or time were skipped.`,
  richTextOnly: (n: number) => `${n} text(s) were read from Word files because no plain text was included; coded positions in them may be off.`,
  invalidRecord: (n: number) => `${n} item(s) could not be imported because their data was invalid.`,
} as const;

/** Warnings about one named item. */
const NAMED_CODES = ['pdfSkipped', 'pdfNoText', 'videoSkipped', 'audioSkipped', 'tooLong', 'unsafePath'] as const;

/** Every warning an import can give: the named ones, then the counted ones. */
export const QDPX_WARNING_CODES = [...NAMED_CODES, ...(Object.keys(COUNTED) as (keyof typeof COUNTED)[])] as const;
export type QdpxWarningCode = (typeof NAMED_CODES)[number] | keyof typeof COUNTED;

class ProjectReader {
  private readonly now: () => Date;
  private readonly factory: RecordFactory;
  private readonly notes: QdpxWarning[] = [];
  private readonly counts = new Map<keyof typeof COUNTED, number>();
  private readonly files: Map<string, Uint8Array>;
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly origin: string;

  private readonly coders = new Map<string, CoderPlan>(); // by guid
  private readonly coderList: CoderPlan[] = [];
  private defaultCoder: CoderPlan | null = null;

  private readonly caseGuids = new Set<string>();
  private readonly codes: CodePlan[] = [];
  private readonly codeByGuid = new Map<string, CodePlan>();
  private readonly attrs = new Map<string, AttrPlan>(); // by guid
  private readonly attrList: AttrPlan[] = [];
  private readonly cases: CasePlan[] = [];
  private readonly caseByGuid = new Map<string, CasePlan>();
  private readonly caseSourceRefs: { caseId: string; guid: string }[] = [];
  private readonly caseSelectionRefs: { caseId: string; guid: string }[] = [];
  private readonly sourceNames = new Map<string, string>();

  private readonly docs: DocPlan[] = [];
  private readonly docByGuid = new Map<string, DocPlan>();
  private readonly docById = new Map<string, DocPlan>();
  private readonly codings: CodingPlan[] = [];
  private readonly codingKeys = new Map<string, string>();
  private readonly codingByGuid = new Map<string, string>();
  private readonly selections = new Map<string, SelectionInfo>();
  private readonly syncs = new Map<string, { pos: number; ms: number }[]>();
  private readonly memoPlans: MemoPlan[] = [];
  private readonly groups: { id: string; name: string }[] = [];

  constructor(
    private readonly root: Element,
    private readonly index: ZipIndex,
    private readonly base: string,
    private readonly opts: QdpxImportOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
    this.factory = new RecordFactory(this.now);
    this.origin = (attr(root, 'origin') ?? '').trim();
    this.files = index.read(this.referencedFiles());
  }

  note(code: (typeof NAMED_CODES)[number], detail: string, message: string): void {
    this.notes.push({ code, count: 1, detail, message });
  }

  private count(key: keyof typeof COUNTED, n = 1): void {
    if (n > 0) this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }

  // --- files ---------------------------------------------------------------------------------

  /** Every internal file the XML points to, so the archive is inflated only once and only for those. */
  private referencedFiles(): string[] {
    const out = new Set<string>();
    const walk = (el: Element) => {
      for (const a of ['plainTextPath', 'richTextPath', 'path']) {
        const v = attr(el, a);
        if (v) {
          const hit = this.resolve(v);
          if (hit) out.add(hit);
        }
      }
      for (const c of children(el)) walk(c);
    };
    walk(this.root);
    return [...out];
  }

  private readonly resolved = new Map<string, string | null>();

  /** The archive entry an internal:// path names, or null (external, or missing). */
  private resolve(path: string): string | null {
    let hit = this.resolved.get(path);
    if (hit === undefined) {
      hit = this.lookup(path);
      this.resolved.set(path, hit);
    }
    return hit;
  }

  private lookup(path: string): string | null {
    const p = path.trim();
    let rel: string;
    if (/^internal:/i.test(p)) rel = p.replace(/^internal:\/*/i, '');
    else if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return null; // relative:///, absolute:///, file:, http:
    else rel = p.replace(/^\/+/, '');
    const variants = new Set([rel]);
    try {
      variants.add(decodeURIComponent(rel));
    } catch {
      // not percent-encoded
    }
    for (const v of variants) {
      for (const prefix of [`${this.base}sources/`, this.base, 'sources/', '']) {
        const hit = this.index.find(prefix + v);
        if (hit) return hit;
      }
    }
    // Last resort: a file of that name anywhere in the archive (Spec example 2 changes case and folders).
    const want = basename(rel).toLowerCase();
    return this.index.names.find((n) => basename(n).toLowerCase() === want) ?? null;
  }

  private isInternal(path: string): boolean {
    return !/^[a-z][a-z0-9+.-]*:/i.test(path.trim()) || /^internal:/i.test(path.trim());
  }

  /** Bytes of an internal file; counts a warning when it is missing. Null for external paths. */
  private fileBytes(path: string | null): Uint8Array | null {
    if (!path) return null;
    if (!this.isInternal(path)) return null;
    const hit = this.resolve(path);
    const bytes = hit ? this.files.get(hit) : undefined;
    if (!bytes) {
      this.count('missingFile');
      return null;
    }
    return bytes;
  }

  private fileKey(path: string | null): string | null {
    if (!path || !this.isInternal(path)) return null;
    return this.resolve(path)?.toLowerCase() ?? null;
  }

  private addBlob(bytes: Uint8Array, filename: string, mime: string): MediaRef {
    const blob_id = uuid();
    this.blobs.set(blob_id, bytes);
    return { blob_id, filename, mime, size: bytes.length };
  }

  /** Text of a TextSourceType element (TextSource, Representation, Transcript, Note). */
  private async readText(el: Element): Promise<{ raw: string; found: boolean; external: boolean }> {
    const plain = attr(el, 'plainTextPath');
    if (plain) {
      if (!this.isInternal(plain)) return { raw: '', found: false, external: true };
      const bytes = this.fileBytes(plain);
      if (bytes) return { raw: stripBom(decodeText(bytes)), found: true, external: false };
    }
    const content = child(el, 'PlainTextContent');
    if (content) return { raw: textOf(content), found: true, external: false };
    const rich = attr(el, 'richTextPath');
    if (rich && extOf(rich) === 'docx') {
      const bytes = this.fileBytes(rich);
      const text = bytes ? await docxText(bytes) : null;
      if (text !== null) {
        this.count('richTextOnly');
        return { raw: text, found: true, external: false };
      }
    }
    return { raw: '', found: false, external: false };
  }

  // --- reading -------------------------------------------------------------------------------

  async read(): Promise<QdpxBundle> {
    const root = this.root;
    this.readUsers(child(root, 'Users'));
    for (const c of children(child(root, 'Cases') ?? root, 'Case')) {
      const g = normGuid(attr(c, 'guid'));
      if (g) this.caseGuids.add(g);
    }
    this.prescanSourceNames(child(root, 'Sources'));
    const codebook = child(root, 'CodeBook');
    const codesEl = codebook && child(codebook, 'Codes');
    if (codesEl) this.readCodes(codesEl, null);
    this.readVariables(child(root, 'Variables'));
    this.readCases(child(root, 'Cases'));
    await this.readSources(child(root, 'Sources'));
    this.canonicalizeTexts();
    for (const doc of this.docs) {
      this.readDocCodings(doc);
      for (const n of doc.noteRefs) this.addNoteTarget(n, { kind: 'document', id: doc.id });
    }
    this.assignCases();
    for (const doc of this.docs) this.readSourceVariables(doc);
    for (const n of children(root, 'NoteRef')) this.addNoteTarget(n, { kind: 'project', id: null });
    this.readLinks(child(root, 'Links'));
    this.readSets(child(root, 'Sets'));
    const graphs = child(root, 'Graphs');
    if (graphs) this.count('graph', children(graphs, 'Graph').length);
    this.fixCodable();
    if (this.opts.splitColonNames) this.splitColonNames();
    const memos = await this.buildMemos(child(root, 'Notes'));
    return this.finish(memos);
  }

  private readUsers(users: Element | undefined): void {
    if (!users) return;
    for (const u of children(users, 'User')) {
      const g = normGuid(attr(u, 'guid'));
      if (!g || this.coders.has(g)) continue;
      const plan = { id: uuid(), name: cleanName(attr(u, 'name') ?? attr(u, 'id'), LIMITS.nameMax, `User ${this.coderList.length + 1}`) };
      this.coders.set(g, plan);
      this.coderList.push(plan);
    }
  }

  /** The coder for the first of these user GUIDs that names a User, else the project's creator, else the default coder. */
  private coderFor(...guids: (string | null)[]): string {
    for (const g of [...guids, attr(this.root, 'creatingUserGUID')]) {
      const plan = this.coders.get(normGuid(g) ?? '');
      if (plan) return plan.id;
    }
    if (!this.defaultCoder) {
      this.defaultCoder = { id: uuid(), name: cleanName(this.opts.defaultCoderName, LIMITS.nameMax, 'Coder') };
      this.coderList.push(this.defaultCoder);
    }
    return this.defaultCoder.id;
  }

  private prescanSourceNames(sources: Element | undefined): void {
    if (!sources) return;
    for (const s of children(sources)) {
      const g = normGuid(attr(s, 'guid'));
      const transcript = child(s, 'Transcript');
      const name = (attr(s, 'name') ?? '').trim() || (transcript ? (attr(transcript, 'name') ?? '').trim() : '');
      if (g && name) this.sourceNames.set(g, name);
    }
  }

  private readCodes(parentEl: Element, parent: string | null): void {
    for (const c of children(parentEl, 'Code')) {
      const g = normGuid(attr(c, 'guid'));
      // NVivo exports each case as a code too (same GUID): the pseudo-code is dropped and its
      // codings become case assignments. Its sub-codes, if any, move up to its parent.
      if (g && this.caseGuids.has(g)) {
        for (const n of children(c, 'NoteRef')) this.addNoteTarget(n, { kind: 'case', id: g }, true);
        this.readCodes(c, parent);
        continue;
      }
      if (g && this.codeByGuid.has(g)) {
        this.readCodes(c, parent);
        continue;
      }
      const isCodable = (attr(c, 'isCodable') ?? 'true').trim().toLowerCase();
      const sections = this.splitDescription(textOf(child(c, 'Description')).trim());
      const plan: CodePlan = {
        id: uuid(),
        guid: g ?? uuid(),
        name: cleanName(attr(c, 'name'), LIMITS.codeNameMax, `Code ${this.codes.length + 1}`),
        parent,
        color: normColor(attr(c, 'color')),
        ...sections,
        codable: !(isCodable === 'false' || isCodable === '0'),
        created: parseDateTime(attr(c, 'creationDateTime')),
        used: false,
      };
      this.codes.push(plan);
      this.codeByGuid.set(plan.guid, plan);
      for (const n of children(c, 'NoteRef')) this.addNoteTarget(n, { kind: 'code', id: plan.id });
      this.readCodes(c, plan.id);
    }
  }

  /** Trama writes inclusion/exclusion/example as labelled sections; other producers' text stays whole. */
  private splitDescription(text: string): Pick<CodePlan, 'description' | 'inclusion' | 'exclusion' | 'example'> {
    const out = { description: text, inclusion: '', exclusion: '', example: '' };
    if (!/^Trama\b/i.test(this.origin)) return out;
    return splitCodeDescription(text);
  }

  private readVariables(vars: Element | undefined): void {
    if (!vars) return;
    for (const v of children(vars, 'Variable')) {
      const g = normGuid(attr(v, 'guid'));
      if (!g || this.attrs.has(g)) continue;
      const refiType = (attr(v, 'typeOfVariable') ?? 'Text').trim();
      const type: AttributeType =
        refiType === 'Boolean' ? 'boolean' : refiType === 'Integer' || refiType === 'Float' ? 'number' : refiType === 'Date' || refiType === 'DateTime' ? 'date' : 'text';
      const plan: AttrPlan = {
        id: uuid(),
        name: cleanName(attr(v, 'name'), LIMITS.nameMax, `Attribute ${this.attrList.length + 1}`),
        type,
        refiType,
        description: textOf(child(v, 'Description')).trim(),
      };
      this.attrs.set(g, plan);
      this.attrList.push(plan);
    }
  }

  /** A VariableValue element → [attribute id, value], or null when it carries nothing usable. */
  private readValue(vv: Element): [string, AttributeValue] | null {
    const ref = child(vv, 'VariableRef');
    const plan = ref && this.attrs.get(normGuid(attr(ref, 'targetGUID')) ?? '');
    if (!plan) return null;
    const valueEl = children(vv).find((e) => localName(e) !== 'VariableRef');
    if (!valueEl) return null;
    const raw = textOf(valueEl).trim();
    if (!raw) return null;
    const kind = localName(valueEl);
    switch (plan.type) {
      case 'text':
        return [plan.id, raw];
      case 'number': {
        const n = Number(/^[-+]?\d+,\d+$/.test(raw) ? raw.replace(',', '.') : raw);
        if (!Number.isFinite(n) || raw === '') {
          this.count('badValue');
          return null;
        }
        return [plan.id, n];
      }
      case 'boolean': {
        const b = raw.toLowerCase();
        if (['true', '1', 'yes'].includes(b)) return [plan.id, true];
        if (['false', '0', 'no'].includes(b)) return [plan.id, false];
        this.count('badValue');
        return null;
      }
      case 'date': {
        const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/.exec(raw);
        if (!m) {
          this.count('badValue');
          return null;
        }
        if (kind === 'DateTimeValue' && m[2] && !/^00:00(:00)?$/.test(m[2])) this.count('timeDropped');
        return [plan.id, m[1]!];
      }
      default:
        return [plan.id, raw];
    }
  }

  private readCases(casesEl: Element | undefined): void {
    if (!casesEl) return;
    for (const c of children(casesEl, 'Case')) {
      const g = normGuid(attr(c, 'guid')) ?? uuid();
      if (this.caseByGuid.has(g)) continue;
      const sourceRefs = children(c, 'SourceRef').map((r) => normGuid(attr(r, 'targetGUID'))).filter((x): x is string => !!x);
      // MAXQDA and Quirkos write document variables as nameless cases with one SourceRef.
      const fallback = (sourceRefs[0] && this.sourceNames.get(sourceRefs[0])) || `Case ${this.cases.length + 1}`;
      const plan: CasePlan = {
        id: uuid(),
        name: cleanName(attr(c, 'name'), LIMITS.nameMax, fallback),
        description: textOf(child(c, 'Description')).trim(),
        values: {},
        created: parseDateTime(attr(c, 'creationDateTime')),
        implicitFor: null,
      };
      for (const vv of children(c, 'VariableValue')) {
        const v = this.readValue(vv);
        if (v) plan.values[v[0]] = v[1];
      }
      this.count('caseCodeRef', children(c, 'CodeRef').length);
      for (const g2 of sourceRefs) this.caseSourceRefs.push({ caseId: plan.id, guid: g2 });
      for (const r of children(c, 'SelectionRef')) {
        const sg = normGuid(attr(r, 'targetGUID'));
        if (sg) this.caseSelectionRefs.push({ caseId: plan.id, guid: sg });
      }
      this.cases.push(plan);
      this.caseByGuid.set(g, plan);
    }
  }

  // --- sources -------------------------------------------------------------------------------

  private newDoc(name: string, kind: DocKind, el: Element, unit: TextUnit): DocPlan {
    const doc: DocPlan = {
      id: uuid(),
      name: cleanName(name, LIMITS.nameMax, `Document ${this.docs.length + 1}`),
      kind,
      created: parseDateTime(attr(el, 'creationDateTime')),
      guids: [],
      unit,
      original: null,
      media: null,
      textSelections: [],
      syncPoints: [],
      transcriptSelections: [],
      wholeCodings: [],
      noteRefs: [],
      variableValues: [],
      caseId: null,
      groupIds: [],
    };
    this.docs.push(doc);
    this.docById.set(doc.id, doc);
    return doc;
  }

  private mapGuid(doc: DocPlan, el: Element): void {
    const g = normGuid(attr(el, 'guid'));
    if (g && !this.docByGuid.has(g)) {
      this.docByGuid.set(g, doc);
      doc.guids.push(g);
    }
  }

  private async readSources(sources: Element | undefined): Promise<void> {
    if (!sources) return;
    // A transcript and a TextSource may share one text file (Trama writes transcripts this way,
    // Transana shares files): they are one document in Trama.
    const textByFile = new Map<string, DocPlan>();
    const transcriptByFile = new Map<string, DocPlan>();
    for (const s of children(sources)) {
      const type = localName(s);
      const srcName = this.sourceNames.get(normGuid(attr(s, 'guid')) ?? '') ?? '';
      if (type === 'TextSource') {
        const key = this.fileKey(attr(s, 'plainTextPath'));
        const shared = key ? transcriptByFile.get(key) : undefined;
        if (shared) {
          this.attachSourceParts(shared, s);
          if (key) textByFile.set(key, shared);
          continue;
        }
        const text = await this.readText(s);
        if (text.external) {
          this.count('externalText');
          continue;
        }
        if (!text.found) this.count('noText');
        const doc = this.newDoc(srcName, 'text', s, { raw: text.raw, probes: [] });
        const rich = attr(s, 'richTextPath');
        if (rich && extOf(rich) === 'docx') {
          const bytes = this.fileBytes(rich);
          if (bytes) doc.original = this.addBlob(bytes, ensureExt(doc.name, 'docx'), mimeOf('x.docx'));
        }
        this.attachSourceParts(doc, s);
        if (key) textByFile.set(key, doc);
      } else if (type === 'PDFSource') {
        await this.readPdf(s, srcName);
      } else if (type === 'PictureSource') {
        this.count('picture');
        this.count('pictureSelection', children(s, 'PictureSelection').length);
      } else if (type === 'AudioSource' || type === 'VideoSource') {
        await this.readMedia(s, srcName, type === 'VideoSource', textByFile, transcriptByFile);
      }
    }
  }

  /** Selections, whole-source codings, memos and variables of a source element onto a document. */
  private attachSourceParts(doc: DocPlan, el: Element): void {
    this.mapGuid(doc, el);
    // Documents have no description field in Trama: a source's Description becomes its memo.
    const description = textOf(child(el, 'Description')).trim();
    if (description) this.memoPlans.push({ note: null, target: { kind: 'document', id: doc.id }, title: 'Description', body: description });
    doc.textSelections.push(...children(el, 'PlainTextSelection'));
    doc.wholeCodings.push(...children(el, 'Coding'));
    doc.noteRefs.push(...children(el, 'NoteRef'));
    doc.variableValues.push(...children(el, 'VariableValue'));
  }

  private async readPdf(s: Element, name: string): Promise<void> {
    const path = attr(s, 'path');
    const pdfBytes = path ? this.fileBytes(path) : null;
    if (path && !this.isInternal(path)) this.count('externalPdf');
    const rep = child(s, 'Representation');
    const text = rep ? await this.readText(rep) : { raw: '', found: false, external: false };
    if (!pdfBytes && !text.found) {
      this.note('pdfSkipped', name || 'untitled', `The PDF "${name || 'untitled'}" was skipped: neither the PDF nor its text was included.`);
      return;
    }
    if (!text.found) this.note('pdfNoText', name || 'untitled', `The PDF "${name || 'untitled'}" was imported without text: the file had no text representation.`);
    const doc = this.newDoc(name, 'pdf', s, { raw: text.raw, probes: [] });
    if (pdfBytes) doc.original = this.addBlob(pdfBytes, ensureExt(doc.name, 'pdf'), 'application/pdf');
    this.count('pdfSelection', children(s, 'PDFSelection').length);
    this.attachSourceParts(doc, s);
    if (rep) this.attachSourceParts(doc, rep);
  }

  private async readMedia(
    s: Element,
    name: string,
    video: boolean,
    textByFile: Map<string, DocPlan>,
    transcriptByFile: Map<string, DocPlan>,
  ): Promise<void> {
    const path = attr(s, 'path');
    let bytes: Uint8Array | null = null;
    if (path) {
      if (this.isInternal(path)) bytes = this.fileBytes(path);
      else this.count('externalMedia');
    }
    const mediaName = ensureExt(name || basename(path ?? '') || 'media', extOf(path ?? '') || (video ? 'mp4' : 'm4a'));
    const mime = mimeOf(mediaName, video ? 'video/mp4' : 'audio/mp4');
    const makeMedia = () => (bytes ? this.addBlob(bytes, mediaName, mime) : null);
    this.count('mediaSelection', children(s, video ? 'VideoSelection' : 'AudioSelection').length);

    const transcripts = children(s, 'Transcript');
    let first: DocPlan | null = null;
    for (const [i, t] of transcripts.entries()) {
      const key = this.fileKey(attr(t, 'plainTextPath'));
      const tName = (attr(t, 'name') ?? '').trim();
      let doc = key ? textByFile.get(key) : undefined;
      if (doc && doc.kind !== 'transcript') {
        doc.kind = 'transcript';
      } else {
        const text = await this.readText(t);
        if (text.external) {
          this.count('externalText');
          continue;
        }
        if (!text.found) this.count('noText');
        const docName = transcripts.length === 1 ? name || tName : tName || `${name || 'Transcript'} (${i + 1})`;
        doc = this.newDoc(docName, 'transcript', t, { raw: text.raw, probes: [] });
      }
      if (!doc.media) doc.media = makeMedia();
      this.mapGuid(doc, t);
      doc.syncPoints.push(...children(t, 'SyncPoint'));
      doc.transcriptSelections.push(...children(t, 'TranscriptSelection'));
      doc.noteRefs.push(...children(t, 'NoteRef'));
      if (key) transcriptByFile.set(key, doc);
      first ??= doc;
    }
    if (!first) {
      if (!bytes) {
        this.note(video ? 'videoSkipped' : 'audioSkipped', name || 'untitled', `The ${video ? 'video' : 'audio'} "${name || 'untitled'}" was skipped: it had no transcript and its file was not included.`);
        return;
      }
      // Media without a transcript: an empty transcript keeps the recording, ready to transcribe.
      first = this.newDoc(name || mediaName, 'transcript', s, { raw: '', probes: [] });
      first.media = makeMedia();
    }
    this.attachSourceParts(first, s);
  }

  // --- positions -----------------------------------------------------------------------------

  /** Decides how each text counts positions (see positions.ts) and makes the texts canonical. */
  private canonicalizeTexts(): void {
    const units = new Set<TextUnit>();
    for (const doc of this.docs) {
      for (const sel of doc.textSelections) {
        const name = attr(sel, 'name');
        const start = intAttr(sel, 'startPosition');
        const end = intAttr(sel, 'endPosition');
        if (name && start !== null && end !== null) doc.unit.probes.push({ start: Math.min(start, end), end: Math.max(start, end), name });
      }
      units.add(doc.unit);
    }
    const atlas = /atlas/i.test(this.origin);
    const trama = /^trama\b/i.test(this.origin);
    // ATLAS.ti counts CRLF as one; Trama writes positions on LF text even in CRLF files.
    const prior: PositionMode = { unit: 'codepoint', crlf: atlas || trama ? 1 : 2 };
    // Evidence across the project, per question (CRLF rule, counting unit), from texts where it matters.
    const crlfVotes = { 1: 0, 2: 0 };
    const unitVotes = { codepoint: 0, utf16: 0 };
    const unitScores = new Map<TextUnit, Map<string, number>>();
    for (const u of units) {
      const modes = candidateModes(u.raw);
      if (modes.length < 2 || !u.probes.length) continue;
      const scores = scoreModes(u.raw, u.probes);
      unitScores.set(u, scores);
      const best = (pred: (m: PositionMode) => boolean) => Math.max(...modes.filter(pred).map((m) => scores.get(modeKey(m)) ?? 0), -Infinity);
      if (modes.some((m) => m.crlf === 1)) {
        crlfVotes[1] += Math.max(0, best((m) => m.crlf === 1));
        crlfVotes[2] += Math.max(0, best((m) => m.crlf === 2));
      }
      if (modes.some((m) => m.unit === 'utf16')) {
        unitVotes.codepoint += Math.max(0, best((m) => m.unit === 'codepoint'));
        unitVotes.utf16 += Math.max(0, best((m) => m.unit === 'utf16'));
      }
    }
    const project: PositionMode = {
      crlf: crlfVotes[1] > crlfVotes[2] ? 1 : crlfVotes[2] > crlfVotes[1] ? 2 : prior.crlf,
      unit: unitVotes.utf16 > unitVotes.codepoint ? 'utf16' : 'codepoint',
    };
    for (const u of units) {
      const mode = chooseMode(u.raw, unitScores.get(u) ?? new Map(), project);
      u.canon = canonicalize(u.raw, mode);
    }
  }

  private span(doc: DocPlan, start: number, end: number): [number, number] | null {
    const canon = doc.unit.canon!;
    let s = Math.min(start, end);
    let e = Math.max(start, end);
    if (s < 0 || s >= canon.maxPosition) {
      this.count('badSpan');
      return null;
    }
    if (e > canon.maxPosition) {
      this.count('clampedSpan');
      e = canon.maxPosition;
    }
    s = canon.toCanonical(s, 'start');
    e = canon.toCanonical(e, 'end');
    if (e <= s) {
      this.count('badSpan');
      return null;
    }
    return [s, e];
  }

  // --- codings -------------------------------------------------------------------------------

  private readDocCodings(doc: DocPlan): void {
    const canon = doc.unit.canon!;
    // Sync points first: transcript selections are spans between them.
    const syncPos = new Map<string, number>();
    const sync: { pos: number; ms: number }[] = [];
    for (const sp of doc.syncPoints) {
      const pos = intAttr(sp, 'position');
      const ms = intAttr(sp, 'timeStamp');
      const g = normGuid(attr(sp, 'guid'));
      const cpos = pos !== null && pos >= 0 && pos <= canon.maxPosition ? canon.toCanonical(pos, 'start') : null;
      if (g && cpos !== null) syncPos.set(g, cpos);
      if (cpos !== null && ms !== null && ms >= 0) sync.push({ pos: cpos, ms });
      else this.count('syncPoint');
    }
    const seen = new Set<string>();
    this.syncs.set(
      doc.id,
      sync.filter((p) => {
        const k = `${p.pos}:${p.ms}`;
        return seen.has(k) ? false : (seen.add(k), true);
      }),
    );

    for (const sel of doc.textSelections) {
      const start = intAttr(sel, 'startPosition');
      const end = intAttr(sel, 'endPosition');
      if (start === null || end === null) {
        this.count('badSpan');
        continue;
      }
      const sp = this.span(doc, start, end);
      if (sp) this.readSelection(doc, sel, sp);
    }
    for (const sel of doc.transcriptSelections) {
      const from = syncPos.get(normGuid(attr(sel, 'fromSyncPoint')) ?? '');
      const toGuid = normGuid(attr(sel, 'toSyncPoint'));
      const to = toGuid ? syncPos.get(toGuid) : canon.text.length;
      if (from === undefined || to === undefined || to <= from) {
        this.count('badSpan');
        continue;
      }
      this.readSelection(doc, sel, [from, to]);
    }
    if (canon.text.length > 0) {
      for (const c of doc.wholeCodings) this.readCoding(doc, c, [0, canon.text.length], null, '', []);
    }
  }

  private readSelection(doc: DocPlan, sel: Element, [s, e]: [number, number]): void {
    const info: SelectionInfo = { docId: doc.id, start: s, end: e, codingIds: [] };
    const g = normGuid(attr(sel, 'guid'));
    if (g) this.selections.set(g, info);
    const description = textOf(child(sel, 'Description')).trim();
    const codingEls = children(sel, 'Coding');
    let comment = description;
    if (description.length > LIMITS.commentMax && codingEls.length) {
      comment = description.slice(0, LIMITS.commentMax - 1).trimEnd() + '…';
      this.count('truncatedComment');
    }
    const longDescription = comment !== description;
    for (const c of codingEls) this.readCoding(doc, c, [s, e], sel, comment, info.codingIds);
    const quote = doc.unit.canon!.text.slice(s, e);
    if (!info.codingIds.length && description) {
      // A selection with a description and no coding: a MAXQDA segment memo or annotation.
      this.memoPlans.push({
        note: null,
        target: { kind: 'document', id: doc.id },
        title: cleanName(attr(sel, 'name'), LIMITS.nameMax, excerpt(quote, 60) || 'Annotation'),
        body: `${quoteBlock(quote)}\n\n${description}`,
      });
    } else if (longDescription && info.codingIds[0]) {
      this.memoPlans.push({
        note: null,
        target: { kind: 'coding', id: info.codingIds[0] },
        title: cleanName(attr(sel, 'name'), LIMITS.nameMax, excerpt(quote, 60) || 'Comment'),
        body: description,
      });
    }
    for (const n of children(sel, 'NoteRef')) {
      const target: MemoTarget = info.codingIds[0] ? { kind: 'coding', id: info.codingIds[0] } : { kind: 'document', id: doc.id };
      this.addNoteTarget(n, target, false, info.codingIds[0] ? undefined : quote);
    }
  }

  private readCoding(doc: DocPlan, c: Element, [s, e]: [number, number], sel: Element | null, comment: string, out: string[]): void {
    const ref = child(c, 'CodeRef');
    const target = normGuid(ref ? attr(ref, 'targetGUID') : null);
    if (!target) {
      this.count('missingCode');
      return;
    }
    const code = this.codeByGuid.get(target);
    if (!code) {
      if (this.caseGuids.has(target)) {
        this.count('caseCoding');
        this.caseCodings.push({ doc, caseGuid: target });
        for (const n of children(c, 'NoteRef')) this.addNoteTarget(n, { kind: 'case', id: target }, true);
      } else this.count('missingCode');
      return;
    }
    const coderId = this.coderFor(attr(c, 'creatingUser'), sel && attr(sel, 'creatingUser'), sel && attr(sel, 'modifyingUser'));
    const key = `${doc.id}|${code.id}|${coderId}|${s}|${e}`;
    let id = this.codingKeys.get(key);
    if (id) {
      this.count('duplicateCoding');
    } else {
      id = uuid();
      this.codingKeys.set(key, id);
      code.used = true;
      this.codings.push({
        id,
        docId: doc.id,
        codeId: code.id,
        coderId,
        start: s,
        end: e,
        comment,
        created: parseDateTime(attr(c, 'creationDateTime')) ?? (sel ? parseDateTime(attr(sel, 'creationDateTime')) : null),
      });
    }
    if (!out.includes(id)) out.push(id);
    const g = normGuid(attr(c, 'guid'));
    if (g) this.codingByGuid.set(g, id);
    for (const n of children(c, 'NoteRef')) this.addNoteTarget(n, { kind: 'coding', id });
  }

  private readonly caseCodings: { doc: DocPlan; caseGuid: string }[] = [];

  // --- cases ---------------------------------------------------------------------------------

  private assignCase(doc: DocPlan, caseId: string): void {
    if (doc.caseId === null) doc.caseId = caseId;
    else if (doc.caseId !== caseId) this.count('twoCases');
  }

  private assignCases(): void {
    for (const { caseId, guid } of this.caseSourceRefs) {
      const doc = this.docByGuid.get(guid);
      if (doc) this.assignCase(doc, caseId);
    }
    for (const { caseId, guid } of this.caseSelectionRefs) {
      const sel = this.selections.get(guid);
      const doc = sel && this.docById.get(sel.docId);
      if (doc) {
        if (doc.caseId !== caseId) this.count('selectionCase');
        this.assignCase(doc, caseId);
      }
    }
    for (const { doc, caseGuid } of this.caseCodings) {
      const c = this.caseByGuid.get(caseGuid);
      if (c) this.assignCase(doc, c.id);
    }
  }

  /** Variables written directly on a source (MAXQDA): they go to the document's case, made if needed. */
  private readSourceVariables(doc: DocPlan): void {
    const values = doc.variableValues.map((vv) => this.readValue(vv)).filter((v): v is [string, AttributeValue] => !!v);
    if (!values.length) return;
    let target = doc.caseId ? this.cases.find((c) => c.id === doc.caseId) : undefined;
    if (!target) {
      target = { id: uuid(), name: doc.name, description: '', values: {}, created: doc.created, implicitFor: doc.id };
      this.cases.push(target);
      doc.caseId = target.id;
    } else if (target.implicitFor !== doc.id && this.docs.some((d) => d !== doc && d.caseId === target!.id)) {
      this.count('sharedCaseValues', values.length);
    }
    for (const [k, v] of values) {
      if (k in target.values && target.values[k] !== v) this.count('conflictingValue');
      else target.values[k] = v;
    }
  }

  // --- memos ---------------------------------------------------------------------------------

  /** Records that the Note a NoteRef names belongs to `target`. `caseGuid`: target.id is a case GUID. */
  private addNoteTarget(ref: Element, target: MemoTarget, caseGuid = false, quote?: string): void {
    const note = normGuid(attr(ref, 'targetGUID'));
    if (!note) return;
    if (caseGuid && target.kind === 'case') {
      const c = this.caseByGuid.get(target.id) ?? null;
      // Cases are read after codes; resolve later through pendingCaseNotes.
      if (!c) {
        this.pendingCaseNotes.push({ note, caseGuid: target.id });
        return;
      }
      target = { kind: 'case', id: c.id };
    }
    this.memoPlans.push({ note, target, quote });
  }

  private readonly pendingCaseNotes: { note: string; caseGuid: string }[] = [];

  /** The memo target a GUID names (for Links), or null. */
  private targetOf(guid: string): { target: MemoTarget; quote?: string } | null {
    const c = this.caseByGuid.get(guid);
    if (c) return { target: { kind: 'case', id: c.id } };
    const sel = this.selections.get(guid);
    if (sel) {
      if (sel.codingIds[0]) return { target: { kind: 'coding', id: sel.codingIds[0] } };
      const doc = this.docById.get(sel.docId)!;
      return { target: { kind: 'document', id: doc.id }, quote: doc.unit.canon!.text.slice(sel.start, sel.end) };
    }
    const doc = this.docByGuid.get(guid);
    if (doc) return { target: { kind: 'document', id: doc.id } };
    const code = this.codeByGuid.get(guid);
    if (code) return { target: { kind: 'code', id: code.id } };
    const coding = this.codingByGuid.get(guid);
    if (coding) return { target: { kind: 'coding', id: coding } };
    return null;
  }

  private readLinks(links: Element | undefined): void {
    if (!links) return;
    const noteGuids = new Set(
      children(child(this.root, 'Notes') ?? this.root, 'Note')
        .map((n) => normGuid(attr(n, 'guid')))
        .filter((g): g is string => !!g),
    );
    for (const l of children(links, 'Link')) {
      const from = normGuid(attr(l, 'originGUID'));
      const to = normGuid(attr(l, 'targetGUID'));
      // A link from a Note to something is how NVivo annotates text and how memos reach cases.
      const [note, other] = from && noteGuids.has(from) ? [from, to] : to && noteGuids.has(to) ? [to, from] : [null, null];
      const t = note && other ? this.targetOf(other) : null;
      if (note && t) this.memoPlans.push({ note, target: t.target, quote: t.quote });
      else this.count('link');
    }
  }

  private async buildMemos(notesEl: Element | undefined): Promise<MemoDraft[]> {
    for (const { note, caseGuid } of this.pendingCaseNotes) {
      const c = this.caseByGuid.get(caseGuid);
      this.memoPlans.push({ note, target: c ? { kind: 'case', id: c.id } : { kind: 'project', id: null } });
    }
    const notes = new Map<string, Element>();
    for (const n of notesEl ? children(notesEl, 'Note') : []) {
      const g = normGuid(attr(n, 'guid'));
      if (g && !notes.has(g)) notes.set(g, n);
    }
    const out: MemoDraft[] = [];
    const used = new Set<string>();
    const done = new Set<string>();
    for (const plan of this.memoPlans) {
      if (plan.note === null) {
        out.push({ title: plan.title ?? '', body: plan.body ?? '', target: plan.target, coderId: null, created: null, color: null });
        continue;
      }
      const el = notes.get(plan.note);
      if (!el) continue; // a NoteRef to a note that does not exist: nothing to show
      const key = `${plan.note}|${plan.target.kind}|${plan.target.id}`;
      if (done.has(key)) continue;
      done.add(key);
      used.add(plan.note);
      out.push(await this.memoFromNote(el, plan.target, plan.quote));
    }
    for (const [g, el] of notes) {
      if (!used.has(g)) out.push(await this.memoFromNote(el, { kind: 'project', id: null }));
    }
    return out;
  }

  private async memoFromNote(el: Element, target: MemoTarget, quote?: string): Promise<MemoDraft> {
    const text = await this.readText(el);
    let body = text.raw.replace(/\r\n?/g, '\n').trim();
    if (!body) body = textOf(child(el, 'Description')).trim();
    // QualCoder annotations: a Note with its own selection into the source that refers to it.
    if (quote === undefined && target.kind === 'document') {
      const sel = child(el, 'PlainTextSelection');
      const doc = sel && this.docById.get(target.id);
      const s = sel && intAttr(sel, 'startPosition');
      const e = sel && intAttr(sel, 'endPosition');
      if (doc && s !== null && s !== undefined && e !== null && e !== undefined) {
        const sp = this.span(doc, s, e);
        if (sp) quote = doc.unit.canon!.text.slice(sp[0], sp[1]);
      }
    }
    if (quote) body = `${quoteBlock(quote)}\n\n${body}`.trim();
    const title = cleanName(attr(el, 'name'), LIMITS.nameMax, excerpt(body.replace(/^>.*$/gm, ''), 60) || 'Memo');
    return {
      title,
      body,
      target,
      coderId: this.coders.get(normGuid(attr(el, 'creatingUser')) ?? '')?.id ?? null,
      created: parseDateTime(attr(el, 'creationDateTime')),
      color: null,
    };
  }

  // --- sets ----------------------------------------------------------------------------------

  private readSets(sets: Element | undefined): void {
    if (!sets) return;
    for (const s of children(sets, 'Set')) {
      const sources = children(s, 'MemberSource');
      const codes = children(s, 'MemberCode');
      const notes = children(s, 'MemberNote');
      this.count('noteMember', notes.length);
      if (!sources.length && codes.length) {
        this.count('codeSet');
        continue;
      }
      if (!sources.length && notes.length) continue;
      const group = { id: uuid(), name: cleanName(attr(s, 'name'), LIMITS.nameMax, `Group ${this.groups.length + 1}`) };
      this.groups.push(group);
      for (const m of sources) {
        const doc = this.docByGuid.get(normGuid(attr(m, 'targetGUID')) ?? '');
        if (doc && !doc.groupIds.includes(group.id)) doc.groupIds.push(group.id);
      }
    }
  }

  // --- codes ---------------------------------------------------------------------------------

  private fixCodable(): void {
    for (const c of this.codes) {
      if (c.used && !c.codable) {
        c.codable = true;
        this.count('madeCodable');
      }
    }
  }

  /** "Coke::diet Coke" next to "Coke" → "diet Coke" under "Coke" (folders made when missing). */
  private splitColonNames(): void {
    const find = (parent: string | null, name: string) => this.codes.find((c) => c.parent === parent && fold(c.name) === fold(name));
    for (const code of [...this.codes]) {
      if (!code.name.includes('::')) continue;
      const parts = code.name.split('::').map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      let parent = code.parent;
      for (const part of parts.slice(0, -1)) {
        let folder = find(parent, part);
        if (!folder || folder === code) {
          folder = {
            id: uuid(),
            guid: uuid(),
            name: cleanName(part, LIMITS.codeNameMax, 'Code'),
            parent,
            color: null,
            description: '',
            inclusion: '',
            exclusion: '',
            example: '',
            codable: false,
            created: code.created,
            used: false,
          };
          this.codes.push(folder);
        }
        parent = folder.id;
      }
      code.parent = parent;
      code.name = cleanName(parts[parts.length - 1], LIMITS.codeNameMax, code.name);
    }
  }

  // --- records -------------------------------------------------------------------------------

  private finish(memos: MemoDraft[]): QdpxBundle {
    const f = this.factory;
    const nowIso = this.now().toISOString();
    const make = <T>(fn: () => T): T | null => {
      try {
        return fn();
      } catch {
        this.count('invalidRecord');
        return null;
      }
    };
    const okCoders = new Set<string>();
    for (const [i, c] of this.coderList.entries()) {
      if (make(() => f.make('coder', { id: c.id, name: c.name, color: PALETTE[(i + 5) % PALETTE.length]! }))) okCoders.add(c.id);
    }
    // Codes parent-first so a dropped parent drops its subtree consistently.
    const okCodes = new Set<string>();
    const order = new Map<string | null, number>();
    const byParent = new Map<string | null, CodePlan[]>();
    for (const c of this.codes) {
      const list = byParent.get(c.parent);
      if (list) list.push(c);
      else byParent.set(c.parent, [c]);
    }
    let colorIndex = 0;
    const visit = (parent: string | null) => {
      for (const c of byParent.get(parent) ?? []) {
        const n = (order.get(parent) ?? 0) + 1;
        order.set(parent, n);
        const color = c.color ?? PALETTE[colorIndex++ % PALETTE.length]!;
        const ok = make(() =>
          f.make(
            'code',
            {
              id: c.id,
              name: c.name,
              parent_id: parent,
              color,
              description: c.description,
              inclusion: c.inclusion,
              exclusion: c.exclusion,
              example: c.example,
              order: n,
              codable: c.codable,
              shortcut: null,
            },
            c.created,
          ),
        );
        if (ok) {
          okCodes.add(c.id);
          visit(c.id);
        }
      }
    };
    visit(null);

    for (const [i, a] of this.attrList.entries()) {
      make(() => f.make('attribute', { id: a.id, name: a.name, type: a.type, options: [], description: a.description, order: i + 1 }));
    }
    const okCases = new Set<string>();
    for (const c of this.cases) {
      if (make(() => f.make('case', { id: c.id, name: c.name, description: c.description, values: c.values, color: null }, c.created))) okCases.add(c.id);
    }
    for (const [i, g] of this.groups.entries()) {
      make(() => f.make('docgroup', { id: g.id, name: g.name, color: PALETTE[(i + 3) % PALETTE.length]!, order: i + 1 }));
    }
    const okDocs = new Map<string, string>(); // id → text
    for (const [i, d] of this.docs.entries()) {
      const text = d.unit.canon!.text;
      if (text.length > LIMITS.textMax) {
        this.note('tooLong', d.name, `The document "${d.name}" was skipped: its text is longer than Trama allows.`);
        continue;
      }
      const ok = make(() => {
        const textDraft = { id: d.id, text, sync: this.syncs.get(d.id) ?? [] };
        const docDraft = {
            id: d.id,
            name: d.name,
            kind: d.kind,
            group_ids: d.groupIds,
            case_id: d.caseId && okCases.has(d.caseId) ? d.caseId : null,
            source: { filename: d.name, format: 'qdpx', imported_at: nowIso, text_sha256: toHex(sha256(utf8(text))) },
            original: d.original,
            media: d.media,
            chars: text.length,
            order: i + 1,
            color: null,
        };
        // Both are checked before either is stored, so a document never lacks its text.
        validate('doctext', textDraft);
        validate('document', docDraft);
        f.make('document', docDraft, d.created);
        return f.make('doctext', textDraft, d.created);
      });
      if (ok) okDocs.set(d.id, text);
    }
    const okCodings = new Set<string>();
    for (const c of this.codings) {
      const text = okDocs.get(c.docId);
      if (text === undefined || !okCodes.has(c.codeId) || !okCoders.has(c.coderId)) continue;
      const rec = make(() =>
        f.make(
          'coding',
          { id: c.id, document_id: c.docId, code_id: c.codeId, coder_id: c.coderId, start: c.start, end: c.end, text: text.slice(c.start, c.end), comment: c.comment },
          c.created,
        ),
      );
      if (rec) okCodings.add(c.id);
    }
    const live = (t: MemoTarget) =>
      t.kind === 'project' ||
      (t.kind === 'document' && okDocs.has(t.id)) ||
      (t.kind === 'code' && okCodes.has(t.id)) ||
      (t.kind === 'case' && okCases.has(t.id)) ||
      (t.kind === 'coding' && okCodings.has(t.id));
    for (const m of memos) {
      let target = m.target;
      if (!live(target)) {
        this.count('unresolvedNote');
        target = { kind: 'project', id: null };
      }
      let body = m.body;
      if (body.length > LIMITS.memoMax) {
        body = body.slice(0, LIMITS.memoMax - 1) + '…';
        this.count('truncatedMemo');
      }
      make(() => f.make('memo', { title: m.title, body, target, coder_id: m.coderId && okCoders.has(m.coderId) ? m.coderId : null, color: m.color }, m.created));
    }

    const issues: QdpxWarning[] = [...this.notes, ...[...this.counts].map(([code, count]) => ({ code, count, message: COUNTED[code](count) }))];
    return {
      project: {
        id: null,
        name: cleanName(attr(this.root, 'name'), LIMITS.nameMax, 'Imported project'),
        description: textOf(child(this.root, 'Description')).trim(),
        origin: this.origin || null,
      },
      records: f.records,
      blobs: this.blobs,
      warnings: issues.map((w) => w.message),
      issues,
    };
  }
}

interface MemoDraft {
  title: string;
  body: string;
  target: MemoTarget;
  coderId: string | null;
  created: string | null;
  color: string | null;
}

function intAttr(el: Element, name: string): number | null {
  const v = attr(el, name);
  if (v === null || !/^\s*[-+]?\d+\s*$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function quoteBlock(text: string): string {
  return text
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');
}

function ensureExt(name: string, ext: string): string {
  return extOf(name) === ext.toLowerCase() ? name : `${name}.${ext}`;
}

/** Plain text of a .docx (paragraphs separated by blank lines), or null when it cannot be read. */
async function docxText(bytes: Uint8Array): Promise<string | null> {
  try {
    const mod = await import('mammoth');
    const mammoth = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    // The browser build reads `arrayBuffer`, the Node build (tests) reads `buffer`.
    const result = await mammoth.extractRawText({ arrayBuffer: buf, buffer: bytes } as unknown as { arrayBuffer: ArrayBuffer });
    return result.value.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  } catch {
    return null;
  }
}
