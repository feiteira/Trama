import type { DocKind } from '../../core/model/types';
import type { AttributeKey, CaseKey, CodeKey, DocKey, GroupKey, InterviewKey } from './types';

// What every language of the example project shares: the shape of the codebook, the cases'
// attribute values, and how documents relate to cases and groups. Only words differ between
// languages, so the analysis screens (and the manual's screenshots) show the same picture in
// all three.

export interface CodeNode {
  key: CodeKey;
  parent: CodeKey | null;
  color: string;
  /** false: a category that only groups codes. */
  codable: boolean;
  shortcut: number | null;
}

/** The codebook in display order (parents before their children). */
export const CODE_TREE: readonly CodeNode[] = [
  { key: 'community', parent: null, color: '#d1495b', codable: false, shortcut: null },
  { key: 'belonging', parent: 'community', color: '#e4572e', codable: true, shortcut: 1 },
  { key: 'intergenerational', parent: 'community', color: '#f3a712', codable: true, shortcut: null },
  { key: 'conflict', parent: 'community', color: '#b5179e', codable: true, shortcut: 4 },
  { key: 'newcomers', parent: 'community', color: '#f08a5d', codable: true, shortcut: 6 },

  { key: 'wellbeing', parent: null, color: '#29a37a', codable: false, shortcut: null },
  { key: 'stress', parent: 'wellbeing', color: '#5c946e', codable: true, shortcut: 2 },
  { key: 'physical', parent: 'wellbeing', color: '#a8c256', codable: true, shortcut: null },
  { key: 'grief', parent: 'wellbeing', color: '#7a7f87', codable: true, shortcut: null },
  { key: 'purpose', parent: 'wellbeing', color: '#2e8b57', codable: true, shortcut: null },

  { key: 'food', parent: null, color: '#8c6d46', codable: false, shortcut: null },
  { key: 'foodSecurity', parent: 'food', color: '#c97b2a', codable: true, shortcut: null },
  { key: 'sharing', parent: 'food', color: '#d9a441', codable: true, shortcut: 7 },
  { key: 'seasonal', parent: 'food', color: '#6b4f2e', codable: true, shortcut: 5 },

  { key: 'place', parent: null, color: '#2b9eb3', codable: false, shortcut: null },
  { key: 'nature', parent: 'place', color: '#3fa34d', codable: true, shortcut: null },
  { key: 'change', parent: 'place', color: '#2b9eb3', codable: true, shortcut: null },
  { key: 'gentrification', parent: 'change', color: '#1f6f8b', codable: true, shortcut: null },

  { key: 'organisation', parent: null, color: '#6c4ab6', codable: false, shortcut: null },
  { key: 'rules', parent: 'organisation', color: '#3a6ea5', codable: true, shortcut: 8 },
  { key: 'waitingList', parent: 'rules', color: '#7f8fc4', codable: true, shortcut: null },
  { key: 'municipal', parent: 'organisation', color: '#8e44ad', codable: true, shortcut: 3 },
  { key: 'burden', parent: 'organisation', color: '#b07cc6', codable: true, shortcut: 9 },
];

export interface DocNode {
  kind: DocKind;
  case: CaseKey | null;
  groups: readonly GroupKey[];
  /** Where the document "came from", for the source line and REFI-QDA export. */
  source: { filename: string; format: string };
  /** Days before seeding that it was imported (the audit trail and source dates). */
  addedDaysAgo: number;
}

export const DOCS: Record<DocKey, DocNode> = {
  int1: { kind: 'transcript', case: 'p1', groups: ['interviews'], source: { filename: 'interview-01.docx', format: 'docx' }, addedDaysAgo: 40 },
  int2: { kind: 'transcript', case: 'p2', groups: ['interviews'], source: { filename: 'interview-02.docx', format: 'docx' }, addedDaysAgo: 40 },
  int3: { kind: 'transcript', case: 'p3', groups: ['interviews'], source: { filename: 'interview-03.docx', format: 'docx' }, addedDaysAgo: 37 },
  int4: { kind: 'transcript', case: 'p4', groups: ['interviews'], source: { filename: 'interview-04.docx', format: 'docx' }, addedDaysAgo: 33 },
  int5: { kind: 'transcript', case: 'p5', groups: ['interviews'], source: { filename: 'interview-05.docx', format: 'docx' }, addedDaysAgo: 30 },
  int6: { kind: 'transcript', case: 'p6', groups: ['interviews'], source: { filename: 'interview-06.docx', format: 'docx' }, addedDaysAgo: 26 },
  focus: { kind: 'transcript', case: null, groups: ['focus'], source: { filename: 'focus-group.vtt', format: 'vtt' }, addedDaysAgo: 21 },
  notes: { kind: 'note', case: null, groups: ['focus'], source: { filename: 'field-notes-open-day.docx', format: 'docx' }, addedDaysAgo: 38 },
  s1: { kind: 'survey', case: 'r1', groups: [], source: { filename: 'survey.csv', format: 'csv' }, addedDaysAgo: 18 },
  s2: { kind: 'survey', case: 'r2', groups: [], source: { filename: 'survey.csv', format: 'csv' }, addedDaysAgo: 18 },
  s3: { kind: 'survey', case: 'r3', groups: [], source: { filename: 'survey.csv', format: 'csv' }, addedDaysAgo: 18 },
  s4: { kind: 'survey', case: 'r4', groups: [], source: { filename: 'survey.csv', format: 'csv' }, addedDaysAgo: 18 },
  s5: { kind: 'survey', case: 'r5', groups: [], source: { filename: 'survey.csv', format: 'csv' }, addedDaysAgo: 18 },
};

export const GROUPS: readonly { key: GroupKey; color: string }[] = [
  { key: 'interviews', color: '#3a6ea5' },
  { key: 'focus', color: '#29a37a' },
];

export const ATTRIBUTES: readonly { key: AttributeKey; type: 'number' | 'choice' }[] = [
  { key: 'age', type: 'number' },
  { key: 'gender', type: 'choice' },
  { key: 'years', type: 'number' },
  { key: 'neighbourhood', type: 'choice' },
  { key: 'role', type: 'choice' },
];

export interface CaseNode {
  age: number;
  /** Indexes into ExampleContent.options. */
  gender: 0 | 1 | 2;
  years: number;
  neighbourhood: 0 | 1 | 2;
  role: 0 | 1 | 2;
  color: string | null;
}

export const CASES: Record<CaseKey, CaseNode> = {
  p1: { age: 67, gender: 0, years: 14, neighbourhood: 0, role: 0, color: '#e4572e' },
  p2: { age: 34, gender: 1, years: 2, neighbourhood: 1, role: 0, color: '#2b9eb3' },
  p3: { age: 45, gender: 0, years: 8, neighbourhood: 0, role: 2, color: '#6c4ab6' },
  p4: { age: 72, gender: 1, years: 30, neighbourhood: 2, role: 0, color: '#8c6d46' },
  p5: { age: 29, gender: 0, years: 1, neighbourhood: 1, role: 1, color: '#29a37a' },
  p6: { age: 52, gender: 1, years: 5, neighbourhood: 2, role: 1, color: '#f3a712' },
  r1: { age: 38, gender: 0, years: 3, neighbourhood: 1, role: 0, color: null },
  r2: { age: 61, gender: 1, years: 12, neighbourhood: 2, role: 0, color: null },
  r3: { age: 24, gender: 2, years: 1, neighbourhood: 0, role: 1, color: null },
  r4: { age: 70, gender: 0, years: 20, neighbourhood: 0, role: 0, color: null },
  r5: { age: 45, gender: 1, years: 4, neighbourhood: 1, role: 2, color: null },
};

/** The interviews the second coder coded independently, for inter-coder agreement. */
export const DOUBLE_CODED: readonly InterviewKey[] = ['int1', 'int2'];

/** Colour of the second coder (the researcher keeps their own). */
export const SECOND_CODER_COLOR = '#b5179e';
