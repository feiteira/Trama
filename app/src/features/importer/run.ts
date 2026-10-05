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
import { canonicalise, createDocument } from '../../services/documents';
import { createGroup } from '../../services/groups';
import { JobStopped } from '../../services/jobs';
import { commit, Plan, q, type Undoable } from '../../services/undo';
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
  private codes = new Map<string, string>();

  constructor(
    private readonly ctx: ProjectContext,
    private readonly labels: RunLabels,
    private readonly shouldStop: () => boolean = () => false,
  ) {}

  private check(): void {
    if (this.shouldStop()) throw new JobStopped();
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
    const catKey = `\u0000${nameKey(catName)}`;
    let catId = this.codes.get(catKey);
    const all = await this.ctx.store.list('code');
    if (!catId) {
      catId = all.find((c) => c.parent_id === null && nameKey(c.name) === nameKey(catName))?.id;
      if (!catId) {
        const r = await createCode(this.ctx, { name: catName, codable: false });
        this.undos.push(r.undo);
        catId = r.code.id;
      }
      this.codes.set(catKey, catId);
    }
    const key = `${catId}\u0000${nameKey(codeName)}`;
    let id = this.codes.get(key);
    if (!id) {
      id = all.find((c) => c.parent_id === catId && nameKey(c.name) === nameKey(codeName))?.id;
      if (!id) {
        const r = await createCode(this.ctx, { name: codeName, parent_id: catId });
        this.undos.push(r.undo);
        id = r.code.id;
      }
      this.codes.set(key, id);
    }
    return id;
  }

  /**
   * Codes spans of a document just created (no codings yet, so no merge rule to apply), in one
   * write. Spans are offsets into the imported text and follow its canonicalisation.
   */
  private async codeSpans(doc: Document, importedText: string, items: { codeId: string; spans: Span[] }[], summary: string): Promise<number> {
    const canon = canonicalise(importedText);
    const text = canon.text;
    const plan = new Plan();
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
    if (!n) return 0;
    const detail = `${summary} → ${q(doc.name)} ×${n}`;
    const { undo } = await commit(this.ctx, plan, { label: 'coding.autocode', detail, logs: [{ action: 'coding.autocode', summary: detail, target: { kind: 'document', id: doc.id } }] });
    this.undos.push(undo);
    return n;
  }

  /** Imports a document row (a file or pasted text). */
  async importDocument(row: ReviewRow): Promise<CreatedDoc[]> {
    const doc = row.doc;
    if (!doc) return [];
    this.check();
    const caseId = await this.caseFor(resolveCase(row));
    const groupIds = await this.groupsFor(row.groups);
    this.check();
    const { document, undo } = await createDocument(this.ctx, {
      name: row.name,
      kind: row.kind,
      text: doc.text,
      sync: doc.sync,
      source: { filename: row.origin === 'paste' ? '' : doc.source.filename, format: row.origin === 'paste' ? 'paste' : doc.source.format },
      ...(doc.original ? { original: { bytes: doc.original.bytes, filename: doc.source.filename, mime: doc.original.mime } } : {}),
      ...(row.media && row.kind === 'transcript' ? { media: { bytes: row.media.bytes, filename: row.media.filename, mime: row.media.mime } } : {}),
      case_id: caseId,
      group_ids: groupIds,
    });
    this.undos.push(undo);
    if (row.kind === 'transcript' && row.autoCodeSpeakers) {
      const plans = speakerPlan(doc.speakers, LIMITS.codeNameMax);
      const items: { codeId: string; spans: Span[] }[] = [];
      for (const p of plans) items.push({ codeId: await this.codeUnder(this.labels.speakers, p.name), spans: p.spans });
      await this.codeSpans(document, doc.text, items, q(this.labels.speakers));
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
    const out: CreatedDoc[] = [];
    const total = result.documents.length;
    for (let i = 0; i < total; i++) {
      this.check();
      const d = result.documents[i]!;
      const caseName = result.caseNames[i];
      const caseId = caseName ? caseIds.get(nameKey(caseName)) ?? null : fixedCase;
      const { document, undo } = await createDocument(this.ctx, {
        name: clip(this.labels.surveyDoc(row.name.trim() || table.name, d.name), LIMITS.nameMax),
        kind: 'survey',
        text: d.text,
        source: { filename: d.source.filename, format: d.source.format },
        case_id: caseId,
        group_ids: groupIds,
      });
      this.undos.push(undo);
      if (mapping.autoCode) {
        const byQuestion = new Map<number, { question: string; spans: Span[] }>();
        for (const s of result.questionSpans[i] ?? []) {
          const e = byQuestion.get(s.column) ?? { question: s.question, spans: [] };
          e.spans.push({ start: s.start, end: s.end });
          byQuestion.set(s.column, e);
        }
        const items: { codeId: string; spans: Span[] }[] = [];
        for (const e of byQuestion.values()) items.push({ codeId: await this.codeUnder(this.labels.questions, e.question), spans: e.spans });
        await this.codeSpans(document, d.text, items, q(this.labels.questions));
      }
      out.push({ id: document.id, name: document.name, kind: document.kind });
      await onProgress?.(i + 1, total);
    }
    return out;
  }

  import(row: ReviewRow, onProgress?: (done: number, total: number) => void | Promise<void>): Promise<CreatedDoc[]> {
    return row.table ? this.importSurvey(row, onProgress) : this.importDocument(row);
  }
}
