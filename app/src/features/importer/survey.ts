// The survey mapping step: which column identifies the respondent, which hold open answers
// (they become document text) and which describe the respondent (case attributes). The
// defaults are a guess from headers and values, always shown for the researcher to correct.

import type { ImportedTable, SurveyLayout, SurveyOptions } from '../../core/import';
import { surveyToDocuments } from '../../core/import';
import { fold } from '../../core/text/normalize';

export type ColumnRole = 'ignore' | 'id' | 'text' | 'attribute';

export interface SurveyMapping {
  roles: ColumnRole[];
  layout: SurveyLayout;
  /** Code each answer with a code per question (under a "Questions" category). */
  autoCode: boolean;
  /** One respondent per case, with the attribute columns as its attributes. */
  createCases: boolean;
}

// Header words (folded) that name a respondent id, in the languages surveys come in.
const ID_WORDS = /^(id|ids|respondent( ?id)?|response ?id|participant( ?id)?|participante|inquirido|encuestado|entrevistado|codigo|code|case|caso|n|no|nr|num|numero|number|#|record ?id|submission ?id|respuesta ?id|id (de )?(respuesta|resposta|participante))$/;
// Columns survey tools add that are neither answers nor useful attributes, or that identify
// people directly (left out by default: the researcher can still choose them).
const SKIP_WORDS = /\b(timestamp|time ?stamp|carimbo|marca temporal|submitted|start ?date|end ?date|ip|e-?mail|correo|email address|endereco de e-?mail|nome completo|full name|nombre completo|token|url|referer|user ?agent)\b/;

const isNumeric = (v: string) => /^[-+]?\d+(?:[.,]\d+)?$/.test(v.trim());

interface ColumnStats {
  filled: number;
  distinct: number;
  avg: number;
  max: number;
  numeric: boolean;
  unique: boolean;
}

function stats(table: ImportedTable, c: number): ColumnStats {
  const values = table.rows.map((r) => (r[c] ?? '').trim()).filter(Boolean);
  const distinct = new Set(values.map((v) => v.toLocaleLowerCase())).size;
  const total = values.reduce((n, v) => n + v.length, 0);
  return {
    filled: values.length,
    distinct,
    avg: values.length ? total / values.length : 0,
    max: values.reduce((n, v) => Math.max(n, v.length), 0),
    numeric: values.length > 0 && values.every(isNumeric),
    unique: values.length > 0 && distinct === values.length,
  };
}

/** The guessed role of every column. */
export function surveyDefaults(table: ImportedTable): ColumnRole[] {
  const all = table.headers.map((_, c) => stats(table, c));
  const roles: ColumnRole[] = table.headers.map((h, c) => {
    const s = all[c]!;
    if (!s.filled) return 'ignore';
    if (SKIP_WORDS.test(fold(h))) return 'ignore';
    if (s.numeric) return 'attribute';
    // A header asking something is an open question, however short its answers.
    if (/[?？]\s*$|^\s*¿/.test(h)) return 'text';
    // Open answers are long, or at least varied sentences.
    if (s.avg >= 25 || s.max >= 80) return 'text';
    if (s.distinct <= Math.max(12, Math.ceil(s.filled * 0.5))) return 'attribute';
    return s.avg >= 12 ? 'text' : 'attribute';
  });
  // The id: a column named like one with no repeated value, else none (rows are numbered).
  const id = table.headers.findIndex((h, c) => ID_WORDS.test(fold(h).replace(/[ºª°]/g, 'o').replace(/[._:-]+/g, ' ').replace(/\s+/g, ' ').trim()) && all[c]!.unique && all[c]!.max <= 60);
  if (id >= 0) roles[id] = 'id';
  return roles;
}

export function defaultMapping(table: ImportedTable): SurveyMapping {
  return { roles: surveyDefaults(table), layout: 'one-per-respondent', autoCode: true, createCases: true };
}

/** Changes one column's role; there is at most one id column. */
export function setRole(roles: readonly ColumnRole[], column: number, role: ColumnRole): ColumnRole[] {
  return roles.map((r, i) => (i === column ? role : role === 'id' && r === 'id' ? 'ignore' : r));
}

export function toSurveyOptions(m: SurveyMapping): SurveyOptions {
  const idColumn = m.roles.indexOf('id');
  return {
    idColumn: idColumn >= 0 ? idColumn : null,
    textColumns: m.roles.flatMap((r, i) => (r === 'text' ? [i] : [])),
    attributeColumns: m.roles.flatMap((r, i) => (r === 'attribute' ? [i] : [])),
    layout: m.layout,
  };
}

export type MappingProblem = 'noText' | 'noRows';

export function mappingProblem(table: ImportedTable, m: SurveyMapping): MappingProblem | null {
  if (!table.rows.length) return 'noRows';
  if (!m.roles.includes('text')) return 'noText';
  return null;
}

/** Cases are made per respondent, so only when each document is one respondent. */
export const makesCases = (m: SurveyMapping): boolean => m.createCases && m.layout === 'one-per-respondent';

export interface SurveyCount {
  documents: number;
  cases: number;
  answers: number;
}

/** How many documents, cases and coded answers a mapping makes. */
export function surveyCount(table: ImportedTable, m: SurveyMapping): SurveyCount {
  if (mappingProblem(table, m)) return { documents: 0, cases: 0, answers: 0 };
  const r = surveyToDocuments(table, toSurveyOptions(m));
  return {
    documents: r.documents.length,
    cases: makesCases(m) ? r.documents.length : 0,
    answers: r.questionSpans.reduce((n, s) => n + s.length, 0),
  };
}
