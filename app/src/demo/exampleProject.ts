// The fictional example project that ships with Trama: the browser demo, "Add the example
// project", the manual's screenshots. Every person, garden and place in it is invented.
//
// Content is typed data per language (example/<lang>/); what the languages share (codebook
// shape, case attributes, groups) is in example/structure.ts. Codings name their passage by its
// exact text and are located when seeding, so editing a transcript can never silently move a
// coding: a quote that is no longer found (or found twice) throws, and the tests catch it.

import { sha256 } from '@noble/hashes/sha2.js';
import { toHex } from '../core/bytes';
import { uuid } from '../core/ids';
import type { Draft, Kind, LogAction, SyncPoint } from '../core/model/types';
import { PALETTE, SETTING_KEYS } from '../core/model/types';
import type { ProjectContext } from '../services/context';
import { en } from './example/en';
import { es } from './example/es';
import { pt } from './example/pt';
import { ATTRIBUTES, CASES, CODE_TREE, DOCS, GROUPS, SECOND_CODER_COLOR } from './example/structure';
import type { CodingSpec, DocKey, ExampleContent, ExampleLang, Turn } from './example/types';
import { CASE_KEYS, DOC_KEYS } from './example/types';

export type { ExampleLang } from './example/types';
export { EXAMPLE_LANGS } from './example/types';

export const EXAMPLE_CONTENT: Readonly<Record<ExampleLang, ExampleContent>> = { en, pt, es };

/** Name and description of the example project, for creating it before seeding. */
export function exampleProjectInfo(lang: ExampleLang): { name: string; description: string } {
  return { ...EXAMPLE_CONTENT[lang].project };
}

/**
 * Who codes in the example: the researcher (seeded as the project's `me`, so a demo should create
 * its project with this coder name) and the second coder of the agreement check.
 */
export function exampleCoderNames(lang: ExampleLang): { researcher: string; second: string } {
  return { ...EXAMPLE_CONTENT[lang].coders };
}

// ---------------------------------------------------------------------------------------------
// Text

/**
 * Where `quote` sits in `text`. `occurrence` (1-based) picks among repeats; without it the quote
 * must appear exactly once. Overlapping repeats count ("aa" occurs twice in "aaa").
 */
export function resolveQuote(text: string, quote: string, occurrence?: number): { start: number; end: number } {
  if (!quote) throw new Error('empty quote');
  if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1)) {
    throw new Error(`occurrence must be a whole number from 1: ${occurrence}`);
  }
  const found: number[] = [];
  const want = occurrence ?? 2; // without an occurrence, a second hit is already an error
  for (let at = text.indexOf(quote); at !== -1 && found.length < want; at = text.indexOf(quote, at + 1)) found.push(at);
  if (!found.length) throw new Error(`quote not found: “${quote}”`);
  if (occurrence === undefined && found.length > 1) throw new Error(`quote is ambiguous (give an occurrence): “${quote}”`);
  const start = found[(occurrence ?? 1) - 1];
  if (start === undefined) throw new Error(`quote occurs ${found.length} time(s), not ${occurrence}: “${quote}”`);
  return { start, end: start + quote.length };
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * A transcript: one `Speaker: text` paragraph per turn, with a sync point at the start of each.
 * Timings follow the length of what is said (about 160 words a minute) with short pauses
 * between turns, so the media timeline looks like a real recording.
 */
export function transcriptText(turns: readonly Turn[], startMs = 0): { text: string; sync: SyncPoint[] } {
  const lines: string[] = [];
  const sync: SyncPoint[] = [];
  let pos = 0;
  let ms = startMs;
  turns.forEach(([speaker, said], i) => {
    const line = `${speaker}: ${said}`;
    sync.push({ pos, ms });
    lines.push(line);
    pos += line.length + 1;
    // Deterministic variety in the pauses (no randomness: screenshots must be reproducible).
    ms += words(said) * 375 + 600 + ((i * 7919) % 1100);
  });
  return { text: lines.join('\n'), sync };
}

/** The canonical text (and timestamps) of one example document. */
export function exampleDocText(content: ExampleContent, key: DocKey): { text: string; sync: SyncPoint[] } {
  const docs = content.documents;
  switch (key) {
    case 'notes':
      return { text: docs.notes.paragraphs.join('\n').normalize('NFC'), sync: [] };
    case 's1':
    case 's2':
    case 's3':
    case 's4':
    case 's5': {
      // The survey importer's layout: each question on its own line, the answer below it.
      const [q1, q2] = content.surveyQuestions;
      const [a1, a2] = docs[key].answers;
      return { text: [q1, a1, q2, a2].join('\n').normalize('NFC'), sync: [] };
    }
    default: {
      const start = 2_000 + DOC_KEYS.indexOf(key) * 1_350;
      const t = transcriptText(docs[key].turns, start);
      return { text: t.text.normalize('NFC'), sync: t.sync };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Records

type Item = { kind: Kind; draft: Draft<Kind> };

const DAY = 86_400_000;
const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const q = (s: string) => `"${s}"`;
const nameKey = (s: string) => s.normalize('NFC').trim().toLocaleLowerCase();

export interface ExampleBuildInput {
  content: ExampleContent;
  lang: ExampleLang;
  researcher: { id: string; name: string; color: string };
  /** Seeding time; the audit trail is dated in the weeks before it. */
  now: Date;
  /** Leave out the project.create entry (the project already logged its creation). */
  projectLogged: boolean;
}

/**
 * Every record of the example project as drafts with ids, ready for one `putMany`. Pure (apart
 * from fresh ids), so tests can inspect the plan; throws if any quote does not resolve.
 */
export function buildExampleProject(input: ExampleBuildInput): Item[] {
  const { content, lang, researcher, now } = input;
  const items: Item[] = [];
  const put = <K extends Kind>(kind: K, draft: Draft<K>) => items.push({ kind, draft: draft as Draft<Kind> });
  const logs: { atMs: number; action: LogAction; summary: string; target: { kind: string; id: string } | null }[] = [];
  const t0 = now.getTime();

  put('setting', { id: SETTING_KEYS.projectName, value: content.project.name });
  put('setting', { id: SETTING_KEYS.projectDescription, value: content.project.description });
  put('setting', { id: SETTING_KEYS.textLanguage, value: lang });
  if (!input.projectLogged) logs.push({ atMs: t0 - 42 * DAY, action: 'project.create', summary: q(content.project.name), target: null });

  // The second coder: a different name and colour from whoever opens the example.
  const secondName = nameKey(content.coders.second) === nameKey(researcher.name) ? `${content.coders.second} (2)` : content.coders.second;
  const secondColor = SECOND_CODER_COLOR !== researcher.color ? SECOND_CODER_COLOR : PALETTE.find((c) => c !== researcher.color)!;
  const coderIds = { researcher: researcher.id, second: uuid() };
  put('coder', { id: coderIds.second, name: secondName, color: secondColor });

  const groupIds = new Map(GROUPS.map((g) => [g.key, uuid()]));
  GROUPS.forEach((g, i) => put('docgroup', { id: groupIds.get(g.key)!, name: content.groups[g.key], color: g.color, order: i + 1 }));

  const attributeIds = new Map(ATTRIBUTES.map((a) => [a.key, uuid()]));
  ATTRIBUTES.forEach((a, i) => {
    const options = a.type === 'choice' ? [...content.options[a.key as 'gender' | 'neighbourhood' | 'role']] : [];
    put('attribute', {
      id: attributeIds.get(a.key)!,
      name: content.attributes[a.key].name,
      type: a.type,
      options,
      description: content.attributes[a.key].description,
      order: i + 1,
    });
  });

  const caseIds = new Map(CASE_KEYS.map((k) => [k, uuid()]));
  CASE_KEYS.forEach((k, i) => {
    const c = CASES[k];
    const id = caseIds.get(k)!;
    put('case', {
      id,
      name: content.cases[k].name,
      description: content.cases[k].description,
      values: {
        [attributeIds.get('age')!]: c.age,
        [attributeIds.get('gender')!]: content.options.gender[c.gender],
        [attributeIds.get('years')!]: c.years,
        [attributeIds.get('neighbourhood')!]: content.options.neighbourhood[c.neighbourhood],
        [attributeIds.get('role')!]: content.options.role[c.role],
      },
      color: c.color,
    });
    logs.push({ atMs: t0 - 35 * DAY + i * 60_000, action: 'case.create', summary: q(content.cases[k].name), target: { kind: 'case', id } });
  });

  const codeIds = new Map(CODE_TREE.map((c) => [c.key, uuid()]));
  const siblingOrder = new Map<string | null, number>();
  CODE_TREE.forEach((c, i) => {
    const order = (siblingOrder.get(c.parent) ?? 0) + 1;
    siblingOrder.set(c.parent, order);
    const id = codeIds.get(c.key)!;
    const text = content.codes[c.key];
    put('code', {
      id,
      name: text.name,
      parent_id: c.parent ? codeIds.get(c.parent)! : null,
      color: c.color,
      description: text.description,
      inclusion: text.inclusion,
      exclusion: text.exclusion,
      example: text.example,
      order,
      codable: c.codable,
      shortcut: c.shortcut,
    });
    logs.push({ atMs: t0 - 36 * DAY + i * 90_000, action: 'code.create', summary: q(text.name), target: { kind: 'code', id } });
  });

  const docIds = new Map(DOC_KEYS.map((k) => [k, uuid()]));
  const codings: { id: string; doc: DocKey; spec: CodingSpec }[] = [];
  DOC_KEYS.forEach((key, i) => {
    const node = DOCS[key];
    const id = docIds.get(key)!;
    const { text, sync } = exampleDocText(content, key);
    const addedMs = t0 - node.addedDaysAgo * DAY + i * 180_000;
    const name = content.documents[key].name;
    put('document', {
      id,
      name,
      kind: node.kind,
      group_ids: node.groups.map((g) => groupIds.get(g)!),
      case_id: node.case ? caseIds.get(node.case)! : null,
      source: {
        filename: node.source.filename,
        format: node.source.format,
        imported_at: isoSeconds(addedMs),
        text_sha256: toHex(sha256(new TextEncoder().encode(text))),
      },
      original: null,
      media: null,
      chars: text.length,
      order: i + 1,
      color: null,
    });
    put('doctext', { id, text, sync });
    logs.push({ atMs: addedMs, action: 'document.add', summary: q(name), target: { kind: 'document', id } });

    for (const spec of content.documents[key].codings) {
      const quote = spec.quote.normalize('NFC');
      let range: { start: number; end: number };
      try {
        range = resolveQuote(text, quote, spec.occurrence);
      } catch (e) {
        throw new Error(`example project (${lang}), ${key}: ${(e as Error).message}`);
      }
      const codingId = uuid();
      codings.push({ id: codingId, doc: key, spec });
      put('coding', {
        id: codingId,
        document_id: id,
        code_id: codeIds.get(spec.code)!,
        coder_id: coderIds[spec.coder],
        start: range.start,
        end: range.end,
        text: quote,
        comment: spec.comment ?? '',
      });
    }
  });

  const secondCount = codings.filter((c) => c.spec.coder === 'second').length;
  if (secondCount) {
    // The second coder worked on a copy; their codings came in by merging it.
    logs.push({ atMs: t0 - 10 * DAY, action: 'project.merge', summary: `${q(secondName)} ×${secondCount}`, target: null });
  }

  content.memos.forEach((m, i) => {
    const t = m.target;
    let target: Draft<'memo'>['target'];
    switch (t.kind) {
      case 'project':
        target = { kind: 'project', id: null };
        break;
      case 'code':
        target = { kind: 'code', id: codeIds.get(t.code)! };
        break;
      case 'document':
        target = { kind: 'document', id: docIds.get(t.doc)! };
        break;
      case 'case':
        target = { kind: 'case', id: caseIds.get(t.case)! };
        break;
      case 'coding': {
        const hit = codings.find((c) => c.doc === t.doc && c.spec.code === t.code && c.spec.coder === 'researcher' && c.spec.quote === t.quote);
        if (!hit) throw new Error(`example project (${lang}): memo “${m.title}” points to a coding that does not exist`);
        target = { kind: 'coding', id: hit.id };
        break;
      }
    }
    const id = uuid();
    put('memo', { id, title: m.title, body: m.body, target, coder_id: researcher.id, color: null });
    logs.push({ atMs: t0 - (20 - i * 2) * DAY, action: 'memo.create', summary: q(m.title), target: { kind: 'memo', id } });
  });

  logs.sort((a, b) => a.atMs - b.atMs);
  for (const l of logs) {
    put('log', {
      at: isoSeconds(l.atMs),
      coder_id: researcher.id,
      action: l.action,
      summary: l.summary,
      target_kind: l.target?.kind ?? null,
      target_id: l.target?.id ?? null,
    });
  }
  return items;
}

/**
 * Fills an empty project with the example study in `lang`. The project's `me` becomes the
 * researcher (their codings, memos and audit entries); a second coder is added for the
 * agreement check. Everything is written in one batch, so a failure leaves the project as it
 * was. Throws if the project already holds documents or codes.
 */
export async function seedExampleProject(ctx: ProjectContext, lang: ExampleLang, opts: { now?: Date } = {}): Promise<void> {
  const content = EXAMPLE_CONTENT[lang];
  if (!content) throw new Error(`no example project in ${String(lang)}`);
  const store = ctx.store;
  if ((await store.count('document')) > 0 || (await store.count('code')) > 0) {
    throw new Error('the example project can only be added to an empty project');
  }
  const projectLogged = (await store.count('log', "json_extract(data, '$.action') = 'project.create'")) > 0;
  const items = buildExampleProject({
    content,
    lang,
    researcher: { id: ctx.me.id, name: ctx.me.name, color: ctx.me.color },
    now: opts.now ?? new Date(),
    projectLogged,
  });
  await store.putMany(items);
}
