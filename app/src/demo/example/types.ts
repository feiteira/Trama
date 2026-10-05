// The shape of the example project's content. The structure every language shares (which codes
// exist and where, who belongs to which case, which document goes in which group) lives in
// structure.ts; each language supplies its own text in example/<lang>/, typed against these
// interfaces so a missing code, case or document fails tsc.

export const EXAMPLE_LANGS = ['en', 'pt', 'es'] as const;
export type ExampleLang = (typeof EXAMPLE_LANGS)[number];

export const INTERVIEW_KEYS = ['int1', 'int2', 'int3', 'int4', 'int5', 'int6'] as const;
export type InterviewKey = (typeof INTERVIEW_KEYS)[number];

export const SURVEY_KEYS = ['s1', 's2', 's3', 's4', 's5'] as const;
export type SurveyKey = (typeof SURVEY_KEYS)[number];

export type TranscriptKey = InterviewKey | 'focus';
export type DocKey = TranscriptKey | 'notes' | SurveyKey;

/** Document order in the project's list. */
export const DOC_KEYS: readonly DocKey[] = [...INTERVIEW_KEYS, 'focus', 'notes', ...SURVEY_KEYS];

export const CODE_KEYS = [
  'community', 'belonging', 'intergenerational', 'conflict', 'newcomers',
  'wellbeing', 'stress', 'physical', 'grief', 'purpose',
  'food', 'foodSecurity', 'sharing', 'seasonal',
  'place', 'nature', 'change', 'gentrification',
  'organisation', 'rules', 'waitingList', 'municipal', 'burden',
] as const;
export type CodeKey = (typeof CODE_KEYS)[number];

export const CASE_KEYS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'r1', 'r2', 'r3', 'r4', 'r5'] as const;
export type CaseKey = (typeof CASE_KEYS)[number];

/** `researcher` codes on the computer the example is opened on (the project's `me`). */
export type CoderKey = 'researcher' | 'second';
export type GroupKey = 'interviews' | 'focus';
export type AttributeKey = 'age' | 'gender' | 'years' | 'neighbourhood' | 'role';

/**
 * One coded segment, located by its exact text. `occurrence` (1-based) picks among repeats; a
 * quote that appears more than once without it is an error, so a later edit of the text can
 * never silently move a coding.
 */
export interface CodingSpec {
  code: CodeKey;
  quote: string;
  coder: CoderKey;
  occurrence?: number;
  comment?: string;
}

/** Coded by the researcher. */
export const A = (code: CodeKey, quote: string, more: Partial<Pick<CodingSpec, 'occurrence' | 'comment'>> = {}): CodingSpec => ({
  code,
  quote,
  coder: 'researcher',
  ...more,
});

/** Coded independently by the second coder. */
export const B = (code: CodeKey, quote: string, more: Partial<Pick<CodingSpec, 'occurrence' | 'comment'>> = {}): CodingSpec => ({
  code,
  quote,
  coder: 'second',
  ...more,
});

/** A speaker turn: the label as written in the transcript, and what was said. */
export type Turn = readonly [speaker: string, text: string];

export interface TranscriptContent {
  name: string;
  turns: readonly Turn[];
  codings: readonly CodingSpec[];
}

export interface NoteContent {
  name: string;
  paragraphs: readonly string[];
  codings: readonly CodingSpec[];
}

export interface SurveyContent {
  name: string;
  /** Answers to the two survey questions, in order. */
  answers: readonly [string, string];
  codings: readonly CodingSpec[];
}

export interface CodeContent {
  name: string;
  description: string;
  inclusion: string;
  exclusion: string;
  example: string;
}

export type MemoTargetSpec =
  | { kind: 'project' }
  | { kind: 'code'; code: CodeKey }
  | { kind: 'document'; doc: DocKey }
  | { kind: 'case'; case: CaseKey }
  /** The researcher's coding of `quote` with `code` in `doc`. */
  | { kind: 'coding'; doc: DocKey; code: CodeKey; quote: string };

export interface MemoContent {
  target: MemoTargetSpec;
  title: string;
  body: string;
}

export interface ExampleContent {
  project: { name: string; description: string };
  coders: Record<CoderKey, string>;
  /** Speaker labels of the interviewer and the focus-group moderator. */
  speakers: { interviewer: string; moderator: string };
  groups: Record<GroupKey, string>;
  attributes: Record<AttributeKey, { name: string; description: string }>;
  /** Options of the choice attributes; structure.ts refers to them by index. */
  options: {
    gender: readonly [woman: string, man: string, nonBinary: string];
    neighbourhood: readonly [string, string, string];
    role: readonly [plotHolder: string, volunteer: string, coordinator: string];
  };
  surveyQuestions: readonly [string, string];
  cases: Record<CaseKey, { name: string; description: string }>;
  codes: Record<CodeKey, CodeContent>;
  documents: Record<TranscriptKey, TranscriptContent> & { notes: NoteContent } & Record<SurveyKey, SurveyContent>;
  memos: readonly MemoContent[];
}
