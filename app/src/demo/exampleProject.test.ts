import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Base, Coding, Draft, Entity, Kind } from '../core/model/types';
import { LOG_ACTIONS, SETTING_KEYS } from '../core/model/types';
import { validate } from '../core/model/validate';
import { makeTestProject, sha256hex } from '../services/testing';
import {
  buildExampleProject,
  EXAMPLE_CONTENT,
  EXAMPLE_LANGS,
  exampleCoderNames,
  exampleDocText,
  exampleProjectInfo,
  resolveQuote,
  seedExampleProject,
  transcriptText,
} from './exampleProject';
import { CASES, CODE_TREE, DOCS, DOUBLE_CODED } from './example/structure';
import type { CodingSpec, DocKey, ExampleContent, ExampleLang, TranscriptKey } from './example/types';
import { CASE_KEYS, CODE_KEYS, DOC_KEYS, INTERVIEW_KEYS, SURVEY_KEYS } from './example/types';

const NOW = new Date('2026-09-28T09:00:00Z');
const DAY = 86_400_000;

// Totals of the example as designed; a change here should be deliberate.
const RESEARCHER_CODINGS = 142;
const SECOND_CODINGS = 33;

async function seeded(lang: ExampleLang, coderName?: string) {
  const ctx = await makeTestProject({ coderName, now: () => NOW });
  await seedExampleProject(ctx, lang, { now: NOW });
  return ctx;
}

const allSpecs = (content: ExampleContent): { doc: DocKey; spec: CodingSpec }[] =>
  DOC_KEYS.flatMap((doc) => content.documents[doc].codings.map((spec) => ({ doc, spec })));

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

// What canonical text never holds: a BOM, CR, Unicode line separators, control characters but tab and LF.
// eslint-disable-next-line no-control-regex
const NON_CANONICAL = /[\uFEFF\r\u2028\u2029\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

describe('resolveQuote', () => {
  const text = 'The bean, the beans and the beanstalk.';

  it('finds a quote that occurs once', () => {
    expect(resolveQuote(text, 'beanstalk')).toEqual({ start: 28, end: 37 });
  });

  it('refuses an ambiguous quote unless an occurrence is given', () => {
    expect(() => resolveQuote(text, 'bean')).toThrow(/ambiguous/);
    expect(resolveQuote(text, 'bean', 1)).toEqual({ start: 4, end: 8 });
    expect(resolveQuote(text, 'bean', 2)).toEqual({ start: 14, end: 18 });
    expect(resolveQuote(text, 'bean', 3)).toEqual({ start: 28, end: 32 });
    expect(() => resolveQuote(text, 'bean', 4)).toThrow(/occurs 3 time/);
  });

  it('counts overlapping repeats', () => {
    expect(() => resolveQuote('aaa', 'aa')).toThrow(/ambiguous/);
    expect(resolveQuote('aaa', 'aa', 2)).toEqual({ start: 1, end: 3 });
  });

  it('rejects empty quotes, missing quotes and bad occurrences', () => {
    expect(() => resolveQuote(text, '')).toThrow(/empty/);
    expect(() => resolveQuote('', 'x')).toThrow(/not found/);
    expect(() => resolveQuote(text, 'carrot')).toThrow(/not found/);
    expect(() => resolveQuote(text, 'bean', 0)).toThrow(/occurrence/);
    expect(() => resolveQuote(text, 'bean', 1.5)).toThrow(/occurrence/);
  });

  it('works in UTF-16 code units, like every offset in Trama', () => {
    const t = 'Olá 🌱 horta — “ação” 🌱 fim';
    const r = resolveQuote(t, '“ação”');
    expect(t.slice(r.start, r.end)).toBe('“ação”');
    expect(r.start).toBe(t.indexOf('“'));
    expect(resolveQuote(t, '🌱', 2).end - resolveQuote(t, '🌱', 2).start).toBe(2);
    expect(() => resolveQuote(t, 'acao')).toThrow(/not found/);
  });

  it('is quick on a very long text', () => {
    const long = 'lorem ipsum dolor '.repeat(100_000) + 'the needle' + ' sit amet'.repeat(50_000);
    const t0 = Date.now();
    const r = resolveQuote(long, 'the needle');
    expect(long.slice(r.start, r.end)).toBe('the needle');
    expect(() => resolveQuote(long, 'ipsum dolor')).toThrow(/ambiguous/);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});

describe('transcriptText', () => {
  it('writes one "Speaker: text" paragraph per turn with a sync point at each', () => {
    const { text, sync } = transcriptText([['A', 'Hello there.'], ['B', 'Hi.'], ['A', 'Shall we start?']], 1_000);
    expect(text).toBe('A: Hello there.\nB: Hi.\nA: Shall we start?');
    expect(sync.map((s) => s.pos)).toEqual([0, 16, 23]);
    expect(sync[0]!.ms).toBe(1_000);
    expect(sync[1]!.ms).toBeGreaterThan(sync[0]!.ms);
    expect(sync[2]!.ms).toBeGreaterThan(sync[1]!.ms);
  });

  it('handles no turns', () => {
    expect(transcriptText([])).toEqual({ text: '', sync: [] });
  });

  it('is deterministic (screenshots must be reproducible)', () => {
    const doc = EXAMPLE_CONTENT.en.documents.int1.turns;
    expect(transcriptText(doc, 5)).toEqual(transcriptText(doc, 5));
  });
});

describe('the example content', () => {
  it('has the same codings (document, code, coder) in every language', () => {
    const key = (lang: ExampleLang) =>
      allSpecs(EXAMPLE_CONTENT[lang])
        .map(({ doc, spec }) => `${doc}/${spec.code}/${spec.coder}`)
        .sort();
    expect(key('pt')).toEqual(key('en'));
    expect(key('es')).toEqual(key('en'));
    const specs = allSpecs(EXAMPLE_CONTENT.en);
    expect(specs.filter((s) => s.spec.coder === 'researcher')).toHaveLength(RESEARCHER_CODINGS);
    expect(specs.filter((s) => s.spec.coder === 'second')).toHaveLength(SECOND_CODINGS);
  });

  it('gives shortcuts 1–9 to the nine codes the researcher used most', () => {
    const uses = new Map<string, number>();
    for (const { spec } of allSpecs(EXAMPLE_CONTENT.en)) if (spec.coder === 'researcher') uses.set(spec.code, (uses.get(spec.code) ?? 0) + 1);
    const withShortcut = CODE_TREE.filter((c) => c.shortcut !== null);
    expect(withShortcut.map((c) => c.shortcut).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(withShortcut.every((c) => c.codable)).toBe(true);
    const least = Math.min(...withShortcut.map((c) => uses.get(c.key) ?? 0));
    const others = CODE_TREE.filter((c) => c.codable && c.shortcut === null);
    expect(others.every((c) => (uses.get(c.key) ?? 0) <= least)).toBe(true);
  });

  it('nests the codebook as categories → codes → subcodes', () => {
    expect(CODE_TREE.map((c) => c.key).sort()).toEqual([...CODE_KEYS].sort());
    const byKey = new Map(CODE_TREE.map((c) => [c.key, c]));
    const depth = (k: string): number => {
      const p = byKey.get(k as never)!.parent;
      return p ? 1 + depth(p) : 1;
    };
    const roots = CODE_TREE.filter((c) => c.parent === null);
    expect(roots).toHaveLength(5);
    expect(roots.every((c) => !c.codable)).toBe(true);
    expect(CODE_TREE.filter((c) => c.parent !== null).every((c) => c.codable)).toBe(true);
    expect(Math.max(...CODE_TREE.map((c) => depth(c.key)))).toBe(3);
    // A parent always comes before its children, so ids can be resolved in one pass.
    CODE_TREE.forEach((c, i) => {
      if (c.parent) expect(CODE_TREE.findIndex((p) => p.key === c.parent)).toBeLessThan(i);
    });
  });

  it.each(EXAMPLE_LANGS)('is complete and tidy in %s', (lang) => {
    const c = EXAMPLE_CONTENT[lang];
    for (const k of CODE_KEYS) {
      const code = c.codes[k];
      expect(code.name.trim()).toBe(code.name);
      expect(code.description.length).toBeGreaterThan(20);
      if (CODE_TREE.find((n) => n.key === k)!.codable) {
        expect(code.inclusion.length, k).toBeGreaterThan(10);
        expect(code.example.length, k).toBeGreaterThan(10);
      }
    }
    expect(new Set(CODE_KEYS.map((k) => c.codes[k].name.toLocaleLowerCase())).size).toBe(CODE_KEYS.length);
    expect(new Set(CASE_KEYS.map((k) => c.cases[k].name)).size).toBe(CASE_KEYS.length);
    expect(new Set(DOC_KEYS.map((k) => c.documents[k].name)).size).toBe(DOC_KEYS.length);
    expect(c.coders.researcher).not.toBe(c.coders.second);
  });

  it.each(EXAMPLE_LANGS)('writes canonical, typographic text in %s', (lang) => {
    const c = EXAMPLE_CONTENT[lang];
    for (const k of DOC_KEYS) {
      const { text } = exampleDocText(c, k);
      expect(text.normalize('NFC'), k).toBe(text);
      expect(NON_CANONICAL.test(text), k).toBe(false);
      // Typographic apostrophes and quotes throughout, so quotes copied from the text match.
      expect(/['"]/.test(text), k).toBe(false);
      expect(text).not.toMatch(/ {2}|\n\n| \n|\n /);
    }
  });

  it.each(EXAMPLE_LANGS)('keeps documents to their intended lengths in %s', (lang) => {
    const c = EXAMPLE_CONTENT[lang];
    for (const k of INTERVIEW_KEYS) {
      const n = words(exampleDocText(c, k).text);
      expect(n, k).toBeGreaterThanOrEqual(650);
      expect(n, k).toBeLessThanOrEqual(1150);
    }
    expect(words(exampleDocText(c, 'focus').text)).toBeGreaterThanOrEqual(800);
    expect(words(exampleDocText(c, 'notes').text)).toBeGreaterThanOrEqual(330);
    for (const k of SURVEY_KEYS) {
      const lines = exampleDocText(c, k).text.split('\n');
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe(c.surveyQuestions[0]);
      expect(lines[2]).toBe(c.surveyQuestions[1]);
    }
  });

  it.each(EXAMPLE_LANGS)('has interviews between the interviewer and one participant, and a focus group of four, in %s', (lang) => {
    const c = EXAMPLE_CONTENT[lang];
    for (const k of INTERVIEW_KEYS) {
      const name = c.cases[DOCS[k].case!].name;
      const speakers = new Set(c.documents[k].turns.map(([s]) => s));
      expect([...speakers].sort(), k).toEqual([c.speakers.interviewer, name].sort());
      expect(c.documents[k].turns[0]![0]).toBe(c.speakers.interviewer);
      expect(c.documents[k].name).toContain(name);
    }
    const fg = new Set(c.documents.focus.turns.map(([s]) => s));
    expect(fg.has(c.speakers.moderator)).toBe(true);
    expect(fg.size).toBe(5);
  });
});

describe.each(EXAMPLE_LANGS)('the example project in %s', (lang) => {
  const content = EXAMPLE_CONTENT[lang];

  it('seeds every kind of record with the expected counts', async () => {
    const ctx = await seeded(lang);
    const s = ctx.store;
    expect(await s.count('coder')).toBe(2);
    expect(await s.count('document')).toBe(13);
    expect(await s.count('doctext')).toBe(13);
    expect(await s.count('code')).toBe(23);
    expect((await s.list('code')).filter((c) => !c.codable)).toHaveLength(5);
    expect(await s.count('coding')).toBe(RESEARCHER_CODINGS + SECOND_CODINGS);
    expect(await s.count('coding', 'coder_id = ?', [ctx.me.id])).toBe(RESEARCHER_CODINGS);
    expect(await s.count('case')).toBe(11);
    expect(await s.count('attribute')).toBe(5);
    expect(await s.count('docgroup')).toBe(2);
    expect(await s.count('memo')).toBe(8);
    expect(await s.count('pseudonym')).toBe(0);
    // project.create + one per document, code, case and memo + the second coder's merge.
    expect(await s.count('log')).toBe(1 + 13 + 23 + 11 + 8 + 1);

    const setting = async (id: string) => (await s.get('setting', id))?.value;
    expect(await setting(SETTING_KEYS.projectName)).toBe(content.project.name);
    expect(await setting(SETTING_KEYS.projectDescription)).toBe(content.project.description);
    expect(await setting(SETTING_KEYS.textLanguage)).toBe(lang);
  });

  it('writes only records that pass validation unchanged in their essentials', async () => {
    const ctx = await seeded(lang);
    let n = 0;
    for await (const { kind, record } of ctx.store.all()) {
      const { created_at: _c, updated_at_hlc: _h, deleted, ...draft } = record as Entity<Kind> & Base;
      expect(deleted).toBe(false);
      const clean = validate(kind, draft as Draft<Kind>) as Record<string, unknown>;
      // Validation would tidy names and colours; seeded data needs no tidying.
      for (const [k, v] of Object.entries(clean)) expect((draft as Record<string, unknown>)[k], `${kind}.${k}`).toEqual(v);
      n++;
    }
    expect(n).toBeGreaterThan(250);
  });

  it('resolves every quote exactly at its intended occurrence', async () => {
    const items = buildExampleProject({
      content,
      lang,
      researcher: { id: 'me', name: 'Ana', color: '#3a6ea5' },
      now: NOW,
      projectLogged: false,
    });
    const texts = new Map(items.filter((i) => i.kind === 'doctext').map((i) => [i.draft.id!, (i.draft as Draft<'doctext'>).text]));
    const docIdByKey = new Map(DOC_KEYS.map((k, i) => [k, items.filter((x) => x.kind === 'document')[i]!.draft.id!]));
    const codings = items.filter((i) => i.kind === 'coding').map((i) => i.draft as Draft<'coding'>);
    const specs = allSpecs(content);
    expect(codings).toHaveLength(specs.length);
    specs.forEach(({ doc, spec }, i) => {
      const c = codings[i]!;
      const text = texts.get(c.document_id)!;
      expect(c.document_id).toBe(docIdByKey.get(doc));
      expect(text.slice(c.start, c.end)).toBe(spec.quote);
      expect(c.text).toBe(spec.quote);
      const nth = spec.occurrence ?? 1;
      let at = -1;
      for (let k = 0; k < nth; k++) at = text.indexOf(spec.quote, at + 1);
      expect(c.start, spec.quote).toBe(at);
      if (spec.occurrence === undefined) expect(text.indexOf(spec.quote, at + 1), `${doc}: ${spec.quote}`).toBe(-1);
    });
  });

  it('codes non-empty, trimmed passages that stay within one paragraph', async () => {
    const ctx = await seeded(lang);
    const texts = new Map((await ctx.store.list('doctext')).map((d) => [d.id, d.text]));
    const docs = new Map((await ctx.store.list('document')).map((d) => [d.id, d]));
    for (const c of await ctx.store.list('coding')) {
      const text = texts.get(c.document_id)!;
      expect(c.end).toBeGreaterThan(c.start);
      expect(c.text).toBe(text.slice(c.start, c.end));
      expect(c.text.trim()).toBe(c.text);
      expect(c.text).not.toContain('\n');
      if (docs.get(c.document_id)!.kind === 'transcript') {
        // Never the speaker label: the coded text starts after "Name: ".
        const lineStart = text.lastIndexOf('\n', c.start - 1) + 1;
        expect(c.start).toBeGreaterThanOrEqual(text.indexOf(': ', lineStart) + 2);
      }
    }
  });

  it('has both coders on the double-coded interviews and only the researcher elsewhere', async () => {
    const ctx = await seeded(lang);
    const s = ctx.store;
    const [second] = (await s.list('coder')).filter((c) => c.id !== ctx.me.id);
    expect(second!.name).toBe(content.coders.second);
    const docs = await s.list('document', { order: 'sort' });
    const codings = await s.list('coding');
    DOC_KEYS.forEach((key, i) => {
      const mine = codings.filter((c) => c.document_id === docs[i]!.id && c.coder_id === ctx.me.id);
      const theirs = codings.filter((c) => c.document_id === docs[i]!.id && c.coder_id === second!.id);
      expect(mine.length, key).toBeGreaterThan(0);
      if ((DOUBLE_CODED as readonly string[]).includes(key)) expect(theirs.length, key).toBeGreaterThanOrEqual(12);
      else expect(theirs, key).toHaveLength(0);
    });
  });

  it('makes the second coder mostly agree, with real disagreements both ways', async () => {
    const ctx = await seeded(lang);
    const codings = await ctx.store.list('coding');
    const docs = await ctx.store.list('document', { order: 'sort' });
    for (const key of DOUBLE_CODED) {
      const docId = docs[DOC_KEYS.indexOf(key)]!.id;
      const mine = codings.filter((c) => c.document_id === docId && c.coder_id === ctx.me.id);
      const theirs = codings.filter((c) => c.document_id === docId && c.coder_id !== ctx.me.id);
      const matched = (a: Coding, others: Coding[]) => others.some((b) => b.code_id === a.code_id && overlaps(a, b));
      const theirsAgree = theirs.filter((c) => matched(c, mine)).length / theirs.length;
      const mineAgree = mine.filter((c) => matched(c, theirs)).length / mine.length;
      expect(theirsAgree, key).toBeGreaterThanOrEqual(0.7);
      expect(theirsAgree, key).toBeLessThan(1);
      expect(mineAgree, key).toBeGreaterThanOrEqual(0.6);
      expect(mineAgree, key).toBeLessThan(1);
      // Some passages carry the same span with a different code: the agreement table shows them.
      expect(theirs.some((t) => mine.some((m) => m.start === t.start && m.end === t.end && m.code_id !== t.code_id)), key).toBe(true);
    }
  });

  it('builds the codebook with parents, colours, definitions and shortcuts', async () => {
    const ctx = await seeded(lang);
    const codes = await ctx.store.list('code');
    const byName = new Map(codes.map((c) => [c.name, c]));
    for (const node of CODE_TREE) {
      const code = byName.get(content.codes[node.key].name)!;
      expect(code, node.key).toBeDefined();
      expect(code.codable).toBe(node.codable);
      expect(code.shortcut).toBe(node.shortcut);
      expect(code.color).toBe(node.color);
      expect(code.parent_id).toBe(node.parent ? byName.get(content.codes[node.parent].name)!.id : null);
      expect(code.description).toBe(content.codes[node.key].description);
    }
    const used = new Set((await ctx.store.list('coding')).map((c) => c.code_id));
    for (const c of codes) expect(used.has(c.id), c.name).toBe(c.codable);
  });

  it('links documents to their cases and groups, with sources matching their text', async () => {
    const ctx = await seeded(lang);
    const s = ctx.store;
    const docs = await s.list('document', { order: 'sort' });
    const cases = new Map((await s.list('case')).map((c) => [c.id, c]));
    const groups = new Map((await s.list('docgroup')).map((g) => [g.id, g.name]));
    expect([...groups.values()].sort()).toEqual([content.groups.interviews, content.groups.focus].sort());
    for (const [i, key] of DOC_KEYS.entries()) {
      const doc = docs[i]!;
      const node = DOCS[key];
      const text = (await s.get('doctext', doc.id))!;
      expect(doc.name).toBe(content.documents[key].name);
      expect(doc.kind).toBe(node.kind);
      expect(doc.chars).toBe(text.text.length);
      expect(doc.source!.text_sha256).toBe(sha256hex(text.text));
      expect(doc.source!.imported_at).toBe(new Date(NOW.getTime() - node.addedDaysAgo * DAY + i * 180_000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
      expect(doc.group_ids.map((g) => groups.get(g))).toEqual(node.groups.map((g) => content.groups[g]));
      expect(doc.case_id ? cases.get(doc.case_id)!.name : null).toBe(node.case ? content.cases[node.case].name : null);
      expect(doc.media).toBeNull();
    }
    // Every case has exactly one document: an interview or a survey answer.
    expect(new Set(docs.map((d) => d.case_id).filter(Boolean)).size).toBe(11);
  });

  it('times every transcript turn, in order, at the start of its paragraph', async () => {
    const ctx = await seeded(lang);
    for (const doc of await ctx.store.list('document')) {
      const t = (await ctx.store.get('doctext', doc.id))!;
      if (doc.kind !== 'transcript') {
        expect(t.sync).toEqual([]);
        continue;
      }
      const starts = [0, ...[...t.text.matchAll(/\n/g)].map((m) => m.index + 1)];
      expect(t.sync.map((p) => p.pos)).toEqual(starts);
      for (let i = 1; i < t.sync.length; i++) {
        const gap = t.sync[i]!.ms - t.sync[i - 1]!.ms;
        expect(gap).toBeGreaterThan(600);
        expect(gap).toBeLessThan(120_000);
      }
    }
  });

  it('describes the cases with valid attribute values', async () => {
    const ctx = await seeded(lang);
    const attrs = await ctx.store.list('attribute', { order: 'sort' });
    expect(attrs.map((a) => a.name)).toEqual(['age', 'gender', 'years', 'neighbourhood', 'role'].map((k) => content.attributes[k as 'age'].name));
    const [age, gender, years, hood, role] = attrs;
    expect(gender!.options).toEqual([...content.options.gender]);
    expect(hood!.options).toEqual([...content.options.neighbourhood]);
    expect(role!.options).toEqual([...content.options.role]);
    const cases = await ctx.store.list('case');
    for (const key of CASE_KEYS) {
      const c = cases.find((x) => x.name === content.cases[key].name)!;
      const node = CASES[key];
      expect(c.values[age!.id]).toBe(node.age);
      expect(c.values[years!.id]).toBe(node.years);
      expect(c.values[gender!.id]).toBe(content.options.gender[node.gender]);
      expect(c.values[hood!.id]).toBe(content.options.neighbourhood[node.neighbourhood]);
      expect(c.values[role!.id]).toBe(content.options.role[node.role]);
      for (const a of attrs) if (a.type === 'choice') expect(a.options).toContain(c.values[a.id]);
    }
  });

  it('attaches memos to the project, codes, documents, a case and codings', async () => {
    const ctx = await seeded(lang);
    const memos = await ctx.store.list('memo');
    const count = (k: string) => memos.filter((m) => m.target.kind === k).length;
    expect([count('project'), count('code'), count('document'), count('case'), count('coding')]).toEqual([1, 2, 2, 1, 2]);
    for (const m of memos) {
      expect(m.coder_id).toBe(ctx.me.id);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.body.length).toBeGreaterThan(100);
      if (m.target.kind === 'project') continue;
      const target = await ctx.store.get(m.target.kind, m.target.id);
      expect(target, m.title).not.toBeNull();
      if (m.target.kind === 'coding') expect((target as Coding).coder_id).toBe(ctx.me.id);
    }
  });

  it('dates the audit trail in the weeks before seeding, oldest first', async () => {
    const ctx = await seeded(lang);
    const log = await ctx.store.list('log', { order: 'at, hlc' });
    expect(log[0]!.action).toBe('project.create');
    expect(log[0]!.at).toBe(new Date(NOW.getTime() - 42 * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z'));
    for (const e of log) {
      expect(LOG_ACTIONS).toContain(e.action);
      expect(e.coder_id).toBe(ctx.me.id);
      expect(Date.parse(e.at)).toBeLessThan(NOW.getTime());
      expect(e.summary).toMatch(/^".+"/);
    }
    const merge = log.find((e) => e.action === 'project.merge')!;
    expect(merge.summary).toBe(`"${content.coders.second}" ×${SECOND_CODINGS}`);
    const added = log.filter((e) => e.action === 'document.add');
    expect(added.map((e) => e.target_kind)).toEqual(Array(13).fill('document'));
  });
});

describe('seedExampleProject', () => {
  it('does not log the project’s creation twice', async () => {
    const ctx = await makeTestProject({ now: () => NOW });
    await ctx.log('project.create', '"My copy"');
    await seedExampleProject(ctx, 'en', { now: NOW });
    expect(await ctx.store.count('log', "json_extract(data, '$.action') = 'project.create'")).toBe(1);
  });

  it('refuses a project that already has documents or codes, writing nothing', async () => {
    const ctx = await seeded('en');
    const before = await ctx.store.count('coding');
    await expect(seedExampleProject(ctx, 'pt')).rejects.toThrow(/empty project/);
    expect(await ctx.store.count('coding')).toBe(before);

    const withCode = await makeTestProject();
    await withCode.store.put('code', {
      name: 'Mine', parent_id: null, color: '#e4572e', description: '', inclusion: '', exclusion: '', example: '', order: 1, codable: true, shortcut: 1,
    });
    await expect(seedExampleProject(withCode, 'en')).rejects.toThrow(/empty project/);
    expect(await withCode.store.count('document')).toBe(0);
  });

  it('keeps the second coder distinct from whoever opens the example', async () => {
    const ctx = await seeded('en', 'Rui');
    const names = (await ctx.store.list('coder')).map((c) => c.name).sort();
    expect(names).toEqual(['Rui', 'Rui (2)']);
    const colors = new Set((await ctx.store.list('coder')).map((c) => c.color));
    expect(colors.size).toBe(2);
  });

  it('fails as a whole when a quote no longer matches its text', async () => {
    const broken: ExampleContent = structuredClone(EXAMPLE_CONTENT.en);
    const doc = broken.documents.int4 as unknown as { codings: CodingSpec[] };
    doc.codings = [...doc.codings, { code: 'nature', quote: 'a heron on the pond', coder: 'researcher' }];
    expect(() =>
      buildExampleProject({ content: broken, lang: 'en', researcher: { id: 'x', name: 'Ana', color: '#3a6ea5' }, now: NOW, projectLogged: true }),
    ).toThrow(/\(en\), int4: quote not found: “a heron on the pond”/);
  });

  it('reports a coding memo whose coding is missing', () => {
    const broken: ExampleContent = structuredClone(EXAMPLE_CONTENT.en);
    (broken as unknown as { memos: unknown[] }).memos = [{ target: { kind: 'coding', doc: 'int1', code: 'nature', quote: 'Geoff' }, title: 'Lost', body: '' }];
    expect(() =>
      buildExampleProject({ content: broken, lang: 'en', researcher: { id: 'x', name: 'Ana', color: '#3a6ea5' }, now: NOW, projectLogged: true }),
    ).toThrow(/memo “Lost”/);
  });
});

describe('names for the demo', () => {
  it('gives the project name, description and coders per language', () => {
    expect(exampleProjectInfo('pt').name).toBe('Crescer juntos — hortas comunitárias e bem-estar');
    expect(exampleProjectInfo('es').name).toBe('Crecer juntos — huertos comunitarios y bienestar');
    expect(exampleProjectInfo('en').name).toBe('Growing together — community gardens and wellbeing');
    for (const lang of EXAMPLE_LANGS) {
      expect(exampleCoderNames(lang).researcher).toBe('Ana');
      expect(exampleCoderNames(lang).second.length).toBeGreaterThan(0);
    }
    // Callers get copies, not the shared content.
    exampleProjectInfo('en').name = 'changed';
    expect(EXAMPLE_CONTENT.en.project.name).not.toBe('changed');
  });

  it('names transcripts that exist as transcripts', () => {
    const transcripts: TranscriptKey[] = [...INTERVIEW_KEYS, 'focus'];
    for (const k of transcripts) expect(DOCS[k].kind).toBe('transcript');
  });
});

describe('the example import files (test-fixtures/example)', () => {
  const fixture = (name: string) => readFileSync(new URL(`../../test-fixtures/example/${name}`, import.meta.url), 'utf8');
  const en = EXAMPLE_CONTENT.en;

  it('carry the same survey answers as the English example', () => {
    const csv = fixture('survey.csv');
    expect(csv.split('\n')[0]).toContain(`"${en.surveyQuestions[0]}"`);
    for (const k of SURVEY_KEYS) for (const answer of en.documents[k].answers) expect(csv).toContain(answer);
  });

  it('carry the same field notes and focus-group turns', () => {
    const txt = fixture('field-note.txt');
    for (const p of en.documents.notes.paragraphs) expect(txt).toContain(p);
    const vtt = fixture('focus-group-excerpt.vtt');
    expect(vtt.startsWith('WEBVTT\n')).toBe(true);
    for (const [speaker, said] of en.documents.focus.turns.slice(0, 16)) expect(vtt).toContain(`<v ${speaker}>${said}</v>`);
  });
});
