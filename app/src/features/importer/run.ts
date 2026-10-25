// Carrying out the review list: documents with their text (and original file, recording), the
// cases and groups chosen for them, speakers and survey answers auto-coded. Everything goes
// through the domain services, so each step is validated, logged and undoable; the screen
// records the collected undos as one step ("Import 12 documents").

import type { Document } from '../../core/model/types';
import { LIMITS } from '../../core/model/types';
import { surveyToDocuments } from '../../core/import';
import type { Span } from '../../core/import';
import { trimSpan } from '../../core/qda/ranges';
import { createCase, importAttributeTable } from '../../services/cases';
import { createCode } from '../../services/codes';
import type { ProjectContext } from '../../services/context';
import { canonicalise, createDocument, createDocuments, DocumentSlots, type NewDocument } from '../../services/documents';
import { createGroup } from '../../services/groups';
import { JobStopped } from '../../services/jobs';
import { commit, type LogSpec, Plan, q, type Undoable } from '../../services/undo';
import { type CaseChoice, coalesce, type GroupRef, nameKey, type ReviewRow, speakerPlan } from './model';
import { makesCases, toSurveyOptions } from './survey';

export interface RunLabels {
  /** Category for speaker codes ("Speakers"). */
  speakers: string;
  /** Category for survey question codes ("Questions"). */
  questions: string;
  /** A survey document's name from the table's and the respondent's (or question's). */
  surveyDoc: (table: string, name: string) => string;
}

export interface CreatedDoc {
  id: string;
  name: string;
  kind: Document['kind'];
}

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/** A new case without a name of its own is named after the document. */
export const resolveCase = (row: Pick<ReviewRow, 'caseChoice' | 'name'>): CaseChoice =>
  row.caseChoice.mode === 'new' && !row.caseChoice.name.trim() ? { mode: 'new', name: row.name } : row.caseChoice;

/**
 * One import batch. Cases, groups and codes it creates are remembered, so several documents
 * naming the same new case (or speaker) share one.
 */
export class ImportSession {
  readonly undos: Undoable[] = [];
  private cases: Map<string, string> | null = null;
  private groups: Map<string, string> | null = null;
  /** Code ids by parent and name (see codeNamed). */
  private codes = new Map<string, string>();
  private codebookRead = false;
  /** Names and positions of new documents, read once for the whole batch. */
  private slots: DocumentSlots | null = null;

  constructor(
    private readonly ctx: ProjectContext,
    private readonly labels: RunLabels,
    private readonly shouldStop: () => boolean = () => false,
  ) {}

  private check(): void {
    if (this.shouldStop()) throw new JobStopped();
  }

  private async docSlots(): Promise<DocumentSlots> {
    this.slots ??= await DocumentSlots.load(this.ctx);
    return this.slots;
  }

  private async caseMap(): Promise<Map<string, string>> {
    if (!this.cases) this.cases = new Map((await this.ctx.store.list('case')).map((c) => [nameKey(c.name), c.id]));
    return this.cases;
  }

  async caseFor(choice: CaseChoice): Promise<string | null> {
    if (choice.mode === 'none') return null;
    if (choice.mode === 'existing') return choice.id;
    const name = choice.name.replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameMax);
    if (!name) return null;
    const map = await this.caseMap();
    const known = map.get(nameKey(name));
    if (known) return known;
    const r = await createCase(this.ctx, { name });
    this.undos.push(r.undo);
    map.set(nameKey(name), r.case.id);
    return r.case.id;
  }

  async groupsFor(refs: readonly GroupRef[]): Promise<string[]> {
    if (!refs.length) return [];
    if (!this.groups) this.groups = new Map((await this.ctx.store.list('docgroup')).map((g) => [nameKey(g.name), g.id]));
    const ids: string[] = [];
    for (const r of refs) {
      if ('id' in r) {
        ids.push(r.id);
        continue;
      }
      const name = r.name.replace(/\s+/g, ' ').trim();
      if (!name) continue;
      let id = this.groups.get(nameKey(name));
      if (!id) {
        const g = await createGroup(this.ctx, { name });
        this.undos.push(g.undo);
        id = g.group.id;
        this.groups.set(nameKey(name), id);
      }
      ids.push(id);
    }
    return [...new Set(ids)];
  }

  /** The code `name` under the top-level category `category`, creating either as needed. */
  async codeUnder(category: string, name: string): Promise<string> {
    const catName = clip(category, LIMITS.codeNameMax);
    const codeName = clip(name, LIMITS.codeNameMax);
    const catId = await this.codeNamed(null, catName, () => createCode(this.ctx, { name: catName, codable: false }));
    return this.codeNamed(catId, codeName, () => createCode(this.ctx, { name: codeName, parent_id: catId }));
  }

  /**
   * The code called `name` under `parentId`, made by `create` when there is none. The codebook
   * is read once per session, not once per call: a survey asks for a code per answer, and
   * thousands of full codebook reads made large imports take minutes.
   */
  private async codeNamed(parentId: string | null, name: string, create: () => Promise<{ code: { id: string }; undo: Undoable }>): Promise<string> {
    const key = `${parentId ?? ''}\u0000${nameKey(name)}`;
    const known = this.codes.get(key);
    if (known) return known;
    if (!this.codebookRead) {
      for (const c of await this.ctx.store.list('code')) {
        const k = `${c.parent_id ?? ''}\u0000${nameKey(c.name)}`;
        // The first of two codes with the same name, as before.
        if (!this.codes.has(k)) this.codes.set(k, c.id);
      }
      this.codebookRead = true;
      const found = this.codes.get(key);
      if (found) return found;
    }
    const r = await create();
    this.undos.push(r.undo);
    this.codes.set(key, r.code.id);
    return r.code.id;
  }

  /**
   * Codes spans of documents just created (no codings yet, so no merge rule to apply), in one
   * write with one audit entry per document. Spans are offsets into the imported text and
   * follow its canonicalisation.
   */
  private async codeSpans(jobs: { doc: Document; importedText: string; items: { codeId: string; spans: Span[] }[] }[], summary: string): Promise<number> {
    const plan = new Plan();
    const logs: LogSpec[] = [];
    let total = 0;
    for (const { doc, importedText, items } of jobs) {
      const canon = canonicalise(importedText);
      const text = canon.text;
      let n = 0;
      for (const { codeId, spans } of items) {
        const mapped = coalesce(spans.map((s) => ({ start: canon.mapOffset(s.start, 'after'), end: canon.mapOffset(s.end, 'before') })));
        for (const s of mapped) {
          const span = trimSpan(text, s);
          if (!span) continue;
          plan.create('coding', {
            document_id: doc.id,
            code_id: codeId,
            coder_id: this.ctx.me.id,
            start: span.start,
            end: span.end,
            text: text.slice(span.start, span.end),
            comment: '',
          });
          n++;
        }
      }
      if (n) logs.push({ action: 'coding.autocode', summary: `${summary} → ${q(doc.name)} ×${n}`, target: { kind: 'document', id: doc.id } });
      total += n;
    }
    if (!total) return 0;
    const detail = logs.length === 1 ? logs[0]!.summary : `${summary} ×${total}`;
    const { undo } = await commit(this.ctx, plan, { label: 'coding.autocode', detail, logs });
    this.undos.push(undo);
    return total;
  }

  /** Imports a document row (a file or pasted text). */
  async importDocument(row: ReviewRow): Promise<CreatedDoc[]> {
    const doc = row.doc;
    if (!doc) return [];
    this.check();
    const caseId = await this.caseFor(resolveCase(row));
    const groupIds = await this.groupsFor(row.groups);
    this.check();
    const slots = await this.docSlots();
    const { document, undo } = await createDocument(
      this.ctx,
      {
        name: row.name,
        kind: row.kind,
        text: doc.text,
        sync: doc.sync,
        source: {
          filename: row.origin === 'paste' ? '' : doc.source.filename,
          // A recording to transcribe is recorded as its audio format (mp3, m4a…).
          format: row.origin === 'paste' ? 'paste' : row.transcribe ? (/\.([a-z0-9]+)$/i.exec(doc.source.filename)?.[1] ?? 'audio') : doc.source.format,
        },
        ...(doc.original ? { original: { bytes: doc.original.bytes, filename: doc.source.filename, mime: doc.original.mime } } : {}),
        ...(row.media && row.kind === 'transcript' ? { media: { bytes: row.media.bytes, filename: row.media.filename, mime: row.media.mime } } : {}),
        case_id: caseId,
        group_ids: groupIds,
      },
      { slots },
    );
    this.undos.push(undo);
    if (row.kind === 'transcript' && row.autoCodeSpeakers) {
      const plans = speakerPlan(doc.speakers, LIMITS.codeNameMax);
      const items: { codeId: string; spans: Span[] }[] = [];
      for (const p of plans) items.push({ codeId: await this.codeUnder(this.labels.speakers, p.name), spans: p.spans });
      await this.codeSpans([{ doc: document, importedText: doc.text, items }], q(this.labels.speakers));
    }
    return [{ id: document.id, name: document.name, kind: document.kind }];
  }

  /** Imports a survey table: cases with attributes, one document per respondent (or question). */
  async importSurvey(row: ReviewRow, onProgress?: (done: number, total: number) => void | Promise<void>): Promise<CreatedDoc[]> {
    const table = row.table?.table;
    const mapping = row.survey;
    if (!table || !mapping) return [];
    this.check();
    const result = surveyToDocuments(table, toSurveyOptions(mapping));
    const opts = toSurveyOptions(mapping);
    const caseIds = new Map<string, string>();
    if (makesCases(mapping) && result.documents.length) {
      const headers = opts.attributeColumns.map((c) => table.headers[c]!);
      // Only respondents who answered (have a document) become cases.
      const answered = new Set(result.caseNames.filter((n): n is string => n !== null).map(nameKey));
      const rows = [['#', ...headers], ...result.cases.filter((c) => answered.has(nameKey(c.name))).map((c) => [c.name, ...headers.map((h) => c.values[h] ?? '')])];
      const r = await importAttributeTable(this.ctx, rows, { header: true, nameColumn: 0, createMissing: true });
      this.undos.push(r.undo);
      this.cases = null;
      const map = await this.caseMap();
      for (const n of answered) {
        const id = map.get(n);
        if (id) caseIds.set(n, id);
      }
    }
    const groupIds = await this.groupsFor(row.groups);
    const fixedCase = makesCases(mapping) ? null : await this.caseFor(resolveCase(row));
    // Every answer document in one write (one undo step), then their auto-coding in another.
    const inputs: NewDocument[] = result.documents.map((d, i) => {
      const caseName = result.caseNames[i];
      return {
        name: clip(this.labels.surveyDoc(row.name.trim() || table.name, d.name), LIMITS.nameMax),
        kind: 'survey',
        text: d.text,
        source: { filename: d.source.filename, format: d.source.format },
        case_id: caseName ? caseIds.get(nameKey(caseName)) ?? null : fixedCase,
        group_ids: groupIds,
      };
    });
    const { documents, undo } = await createDocuments(this.ctx, inputs, { slots: await this.docSlots(), onProgress, shouldStop: this.shouldStop });
    this.undos.push(undo);
    if (mapping.autoCode) {
      const jobs: { doc: Document; importedText: string; items: { codeId: string; spans: Span[] }[] }[] = [];
      for (let i = 0; i < documents.length; i++) {
        this.check();
        const byQuestion = new Map<number, { question: string; spans: Span[] }>();
        for (const s of result.questionSpans[i] ?? []) {
          const e = byQuestion.get(s.column) ?? { question: s.question, spans: [] };
          e.spans.push({ start: s.start, end: s.end });
          byQuestion.set(s.column, e);
        }
        const items: { codeId: string; spans: Span[] }[] = [];
        for (const e of byQuestion.values()) items.push({ codeId: await this.codeUnder(this.labels.questions, e.question), spans: e.spans });
        jobs.push({ doc: documents[i]!, importedText: result.documents[i]!.text, items });
      }
      await this.codeSpans(jobs, q(this.labels.questions));
    }
    return documents.map((document) => ({ id: document.id, name: document.name, kind: document.kind }));
  }

  import(row: ReviewRow, onProgress?: (done: number, total: number) => void | Promise<void>): Promise<CreatedDoc[]> {
    return row.table ? this.importSurvey(row, onProgress) : this.importDocument(row);
  }
}
