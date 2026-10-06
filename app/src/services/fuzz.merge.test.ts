// Property-based fuzzing of the data layer: two copies of one project (two coders, two
// computers) take random interleaved operations and merge each other's copies at random times,
// with the clock advancing irregularly; the invariants below are checked after every operation
// and merge. Deterministic: every random choice comes from a seeded PRNG, and so does the
// randomness the app itself draws (ids, revision ids, device ids), and the system clock is fake.
//
//   FUZZ_ITERATIONS=2000 npx vitest run src/services/fuzz.merge.test.ts   (operations per seed)
//   FUZZ_SEEDS=1,2,3,4,5       seeds to run (default 4 fixed seeds; ~5 s in all)
//   FUZZ_EPISODE=300            operations per episode (a fresh project and copy; default 80)
//   FUZZ_ONLY=seed:episode      one episode only;  FUZZ_TRACE=<file>  writes every operation there
//   FUZZ_MINIMIZE=1             on a failure, shrinks the episode to the fewest operations that
//                               still fail (delta debugging) and prints them
//
// Invariants (see `checkSide`, `checkConverged`):
// - every live coding has 0 ≤ start < end ≤ text.length and coding.text === text.slice(start, end);
// - no live coding references a deleted or missing code or document, or a category (not codable);
// - no live memo targets a deleted or missing record;
// - every document has its doctext, live together; document.chars === text.length;
// - live codes form no cycles;
// - once the merging side holds an applied pseudonymisation key, no original of it is in its
//   live texts and fields after a merge;
// - undo/redo only ever refuses with 'changed_since' (or an erased record), and a refused step
//   writes nothing;
// - after both sides merged each other with no edits between and no text conflict reported, both
//   copies hold the same live content (or do after one more merge, when the second merge put
//   back records the first copy holds only as tombstones: a copy never carries deleted content).
//
// The copies are real library projects (memory platform), not `makeTestProject` contexts:
// exporting and importing .trama copies needs a `Project`.
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import { readTramaZip } from '../core/export/trama';
import type { Entity, Kind } from '../core/model/types';
import { ErasedRecordError } from '../core/store/store';
import { createMemoryPlatform } from '../platform/memory';
import { createCode, deleteCode, mergeCodes, moveCode, restoreCodes, splitCode, updateCode } from './codes';
import { applyCode, recode, removeCoding, resizeCoding, setComment } from './codings';
import { exportProjectFile, importProjectFile, mergeTeammateCopy, type MergeResult } from './datafile';
import { createDocument, deleteDocuments, editDocumentText, renameDocument, restoreDocuments, takeTeammateText } from './documents';
import { Library } from './library';
import { createMemo, deleteMemo, restoreMemos, updateMemo } from './memos';
import { apply, createPseudonym, deletePseudonym, preview } from './pseudonyms';
import type { Project } from './project';
import type { TextConflict } from './reconcile';
import { FAST_KDF } from './testing';
import { ServiceError, UndoManager, type Undoable } from './undo';

const env = (k: string) => (typeof process !== 'undefined' ? process.env[k] : undefined);
const ITERATIONS = Number(env('FUZZ_ITERATIONS') ?? 320);
const SEEDS = (env('FUZZ_SEEDS') ?? '11,23,37,41').split(',').map(Number);
const EPISODE = Number(env('FUZZ_EPISODE') ?? 80);
const ONLY = env('FUZZ_ONLY');
const TRACE = env('FUZZ_TRACE');
const MINIMIZE = !!env('FUZZ_MINIMIZE');
/** Only these steps of the episode (as a minimised failure lists them), e.g. FUZZ_KEEP=3,14,22. */
const KEEP = env('FUZZ_KEEP')?.split(',').map(Number);

// ---------------------------------------------------------------------------------------------
// Seeded randomness

function hash32(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h ^= x >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  }
  return h >>> 0;
}

/** sfc32-like PRNG in [0, 1). */
function prng(seed: number): () => number {
  let a = seed ^ 0x9e3779b9;
  let b = seed ^ 0x243f6a88;
  let c = seed ^ 0xb7e15162;
  let d = 1;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

interface Rng {
  (): number;
  int(n: number): number;
  pick<T>(list: readonly T[]): T | undefined;
  chance(p: number): boolean;
}

function rngOf(seed: number): Rng {
  const f = prng(seed);
  const r = (() => f()) as Rng;
  r.int = (n) => Math.floor(f() * n);
  r.pick = (list) => (list.length ? list[Math.floor(f() * list.length)] : undefined);
  r.chance = (p) => f() < p;
  return r;
}

// The app's own randomness (uuids, revision ids, device ids, nonces) from a seeded stream.
let appRandom = prng(1);

// ---------------------------------------------------------------------------------------------
// Text material

const NAMES = [
  { original: 'Mariana', replacement: 'Pessoa A' },
  { original: 'Porto', replacement: 'Cidade X' },
  { original: 'Joana Lima', replacement: 'Pessoa B' },
  { original: 'Lisboa', replacement: 'Cidade Y' },
];
const PIECES = [
  'a', 'e', 'o', 'n', 's', ' ', ' ', '  ', '\n', '\n\n', '.', ',', '?', 'Trust', 'trust', 'came', 'later', 'family',
  'work', 'the', 'I ', 'we ', '😀', '👩‍👩‍👧', 'é', 'é', 'ç', 'ñ', '\t', '\r\n', '"', '—', 'Ana: ', 'Rui: ',
  'Mariana', 'Porto', 'Joana Lima', 'Lisboa', 'Pessoa A', 'Cidade X', ' ', 'Ma', 'riana',
];
const SENTENCES = [
  'Ana: I started in Porto with Mariana.',
  'Rui: Trust came later, much later.',
  'Ana: My family 👩‍👩‍👧 moved to Lisboa when I was ten.',
  'Rui: Work was hard; trust was harder.',
  'Ana: Joana Lima helped us — she is café owner.',
  'Rui: We never talked about money 😀.',
  'Ana: The school was near the river.',
];
const CODE_NAMES = ['Trust', 'Family', 'Work', 'Place', 'Money', 'Mariana', 'Emotions', 'Porto memories', 'Risk', 'Café'];

function randomText(rng: Rng): string {
  const n = 2 + rng.int(5);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(rng.pick(SENTENCES)!);
  return out.join(rng.chance(0.8) ? '\n' : ' ');
}

function randomPiece(rng: Rng, len = 1 + rng.int(4)): string {
  let s = '';
  for (let i = 0; i < len; i++) s += rng.pick(PIECES)!;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Two copies

type SideName = 'A' | 'B';

interface Side {
  name: SideName;
  lib: Library;
  p: Project;
  undo: UndoManager;
  skew: number;
  /** Delete batches this side made (for restores). */
  docBatches: string[];
  codeBatches: string[];
  memoBatches: string[];
  /** Text conflicts the last merge into this side reported (to take the teammate's text). */
  conflicts: TextConflict[];
}

class Violation extends Error {}

interface World {
  t: number;
  A: Side;
  B: Side;
  log: string[];
  seedOf: (step: number) => number;
}

const T0 = Date.parse('2026-10-05T12:00:00Z');

function nowOf(world: World, name: SideName): () => Date {
  return () => new Date(world.t + world[name].skew);
}

async function newLibrary(world: World, name: SideName): Promise<Library> {
  return Library.create(createMemoryPlatform(), { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF, now: nowOf(world, name) });
}

function advance(world: World, rng: Rng): void {
  const r = rng();
  // Mostly small steps, sometimes the same millisecond, sometimes hours.
  const ms = r < 0.15 ? 0 : r < 0.7 ? rng.int(2000) : r < 0.95 ? rng.int(600_000) : rng.int(86_400_000);
  world.t += ms;
  vi.setSystemTime(new Date(world.t));
}

async function setup(world: World, rng: Rng): Promise<void> {
  vi.setSystemTime(new Date(world.t));
  // Placeholders so nowOf can read skews while libraries are created.
  const blank = { skew: 0 } as Side;
  world.A = { ...blank, name: 'A' };
  world.B = { ...blank, name: 'B', skew: (rng.int(2) ? -1 : 1) * rng.int(300_000) };
  const libA = await newLibrary(world, 'A');
  const pa = await libA.createProject({ name: 'Fuzz', coderName: 'Ana' });
  world.A = { name: 'A', lib: libA, p: pa, undo: new UndoManager(), skew: 0, docBatches: [], codeBatches: [], memoBatches: [], conflicts: [] };
  const docs = 2 + rng.int(3);
  for (let i = 0; i < docs; i++) await createDocument(pa, { name: `Interview ${i + 1}`, kind: 'transcript', text: randomText(rng) });
  const { code: parent } = await createCode(pa, { name: 'Family' });
  await createCode(pa, { name: 'Trust' });
  await createCode(pa, { name: 'Work', parent_id: parent.id });
  await createCode(pa, { name: 'Themes', codable: false });
  for (let i = 0; i < 8; i++) await opApplyCode(world, world.A, rng).catch((e: unknown) => refusedOrThrow(e));
  await createMemo(pa, { title: 'Project notes', body: 'About Porto', target: { kind: 'project', id: null } });
  advance(world, rng);
  const libB = await newLibrary(world, 'B');
  const pb = await importProjectFile(libB, await exportProjectFile(pa, { includePseudonyms: false }), { kind: 'none' }, { asCopyOfSameProject: true });
  await pb.setMe((await pb.addCoder('Rui')).id);
  world.B = { name: 'B', lib: libB, p: pb, undo: new UndoManager(), skew: world.B.skew, docBatches: [], codeBatches: [], memoBatches: [], conflicts: [] };
  advance(world, rng);
}

const byId = <T extends { id: string }>(list: T[]) => list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const live = async <K extends Kind>(s: Side, kind: K) => byId(await s.p.store.list(kind));

// ---------------------------------------------------------------------------------------------
// Operations

/** Refusals a domain operation may answer with (the operation then changes nothing). */
const REFUSALS = new Set(['not_found', 'not_codable', 'empty_span', 'cycle', 'invalid_argument', 'too_large', 'duplicate']);

function refusedOrThrow(e: unknown): string {
  if (e instanceof ServiceError && REFUSALS.has(e.code)) return `refused (${e.code})`;
  throw e;
}

function record(s: Side, u: Undoable | undefined): void {
  if (u) s.undo.record(u);
}

async function opApplyCode(world: World, s: Side, rng: Rng): Promise<string> {
  const doc = rng.pick(await live(s, 'document'));
  const code = rng.pick(await live(s, 'code'));
  if (!doc || !code) return 'applyCode: nothing';
  const t = (await s.p.store.get('doctext', doc.id))!.text;
  const start = rng.int(t.length + 1);
  const end = Math.min(t.length, start + 1 + rng.int(30));
  const r = await applyCode(s.p, { documentId: doc.id, start, end, codeId: code.id });
  record(s, r.undo);
  return `applyCode ${code.name} → ${doc.name} [${start},${end})`;
}

async function pickCoding(s: Side, rng: Rng) {
  return rng.pick(await live(s, 'coding'));
}

const OPS: { name: string; w: number; run: (world: World, s: Side, rng: Rng) => Promise<string> }[] = [
  { name: 'applyCode', w: 14, run: opApplyCode },
  {
    name: 'removeCoding', w: 4, run: async (_w, s, rng) => {
      const c = await pickCoding(s, rng);
      if (!c) return 'removeCoding: nothing';
      record(s, (await removeCoding(s.p, [c.id])).undo);
      return `removeCoding ${c.id.slice(0, 6)}`;
    },
  },
  {
    name: 'resizeCoding', w: 5, run: async (_w, s, rng) => {
      const c = await pickCoding(s, rng);
      if (!c) return 'resizeCoding: nothing';
      const a = c.start + rng.int(11) - 5;
      const b = c.end + rng.int(11) - 5;
      record(s, (await resizeCoding(s.p, c.id, a, b)).undo);
      return `resizeCoding ${c.id.slice(0, 6)} [${c.start},${c.end}) → [${a},${b})`;
    },
  },
  {
    name: 'recode', w: 2, run: async (_w, s, rng) => {
      const c = await pickCoding(s, rng);
      const code = rng.pick(await live(s, 'code'));
      if (!c || !code) return 'recode: nothing';
      record(s, (await recode(s.p, c.id, code.id)).undo);
      return `recode ${c.id.slice(0, 6)} → ${code.name}`;
    },
  },
  {
    name: 'setComment', w: 4, run: async (_w, s, rng) => {
      const c = await pickCoding(s, rng);
      if (!c) return 'setComment: nothing';
      const comment = rng.chance(0.2) ? '' : randomPiece(rng, 1 + rng.int(6));
      record(s, (await setComment(s.p, c.id, comment)).undo);
      return `setComment ${c.id.slice(0, 6)} ${JSON.stringify(comment)}`;
    },
  },
  {
    name: 'editText', w: 12, run: async (_w, s, rng) => {
      const doc = rng.pick(await live(s, 'document'));
      if (!doc) return 'editText: nothing';
      let t = (await s.p.store.get('doctext', doc.id))!.text;
      const n = 1 + rng.int(3);
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const pos = rng.int(t.length + 1);
        const bias = t.length > 1500 ? 60 : 10;
        const del = rng.chance(0.5) ? 0 : rng.int(Math.min(bias, t.length - pos) + 1);
        const ins = rng.chance(0.3) ? '' : randomPiece(rng);
        t = t.slice(0, pos) + ins + t.slice(pos + del);
        parts.push(`${pos}-${del}+${JSON.stringify(ins)}`);
      }
      record(s, (await editDocumentText(s.p, doc.id, t)).undo);
      return `editText ${doc.name} ${parts.join(' ')}`;
    },
  },
  {
    name: 'createCode', w: 3, run: async (_w, s, rng) => {
      if ((await s.p.store.count('code')) > 14) return 'createCode: enough';
      const parent = rng.chance(0.5) ? rng.pick(await live(s, 'code')) : undefined;
      const name = `${rng.pick(CODE_NAMES)!}${rng.chance(0.5) ? ` ${rng.int(50)}` : ''}`;
      const codable = rng.chance(0.85);
      record(s, (await createCode(s.p, { name, parent_id: parent?.id ?? null, codable })).undo);
      return `createCode ${name}${parent ? ` under ${parent.name}` : ''}${codable ? '' : ' (category)'}`;
    },
  },
  {
    name: 'updateCode', w: 3, run: async (_w, s, rng) => {
      const code = rng.pick(await live(s, 'code'));
      if (!code) return 'updateCode: nothing';
      const r = rng();
      const patch = r < 0.4 ? { name: `${rng.pick(CODE_NAMES)!} ${rng.int(99)}` } : r < 0.7 ? { codable: !code.codable } : { description: randomPiece(rng, 3) };
      record(s, (await updateCode(s.p, code.id, patch)).undo);
      return `updateCode ${code.name} ${JSON.stringify(patch)}`;
    },
  },
  {
    name: 'moveCode', w: 3, run: async (_w, s, rng) => {
      const codes = await live(s, 'code');
      const code = rng.pick(codes);
      if (!code) return 'moveCode: nothing';
      const parent = rng.chance(0.4) ? null : rng.pick(codes)!;
      const before = rng.chance(0.5) ? null : rng.pick(codes.filter((c) => c.parent_id === (parent?.id ?? null)));
      record(s, (await moveCode(s.p, code.id, parent?.id ?? null, before?.id ?? null)).undo);
      return `moveCode ${code.name} → ${parent?.name ?? '/'}`;
    },
  },
  {
    name: 'mergeCodes', w: 2, run: async (_w, s, rng) => {
      const codes = await live(s, 'code');
      const target = rng.pick(codes);
      const source = rng.pick(codes);
      if (!target || !source) return 'mergeCodes: nothing';
      const sources = [source.id, ...(rng.chance(0.3) ? [rng.pick(codes)!.id] : [])];
      record(s, (await mergeCodes(s.p, sources, target.id)).undo);
      return `mergeCodes ${sources.length} → ${target.name}`;
    },
  },
  {
    name: 'deleteCode', w: 2, run: async (_w, s, rng) => {
      const code = rng.pick(await live(s, 'code'));
      if (!code) return 'deleteCode: nothing';
      const withChildren = rng.chance(0.5) ? 'delete' : 'lift';
      const r = await deleteCode(s.p, code.id, { withChildren });
      s.codeBatches.push(r.batch);
      record(s, r.undo);
      return `deleteCode ${code.name} (${withChildren})`;
    },
  },
  {
    name: 'restoreCodes', w: 1, run: async (_w, s, rng) => {
      const b = rng.pick(s.codeBatches);
      if (!b) return 'restoreCodes: nothing';
      const r = await restoreCodes(s.p, b);
      return `restoreCodes ${b.slice(0, 6)} → ${r.codes}`;
    },
  },
  {
    name: 'deleteDocuments', w: 1.5, run: async (_w, s, rng) => {
      const docs = await live(s, 'document');
      if (docs.length < 2) return 'deleteDocuments: keep one';
      const doc = rng.pick(docs)!;
      const r = await deleteDocuments(s.p, [doc.id]);
      s.docBatches.push(r.batch);
      record(s, r.undo);
      return `deleteDocuments ${doc.name}`;
    },
  },
  {
    name: 'restoreDocuments', w: 1.5, run: async (_w, s, rng) => {
      const b = rng.pick(s.docBatches);
      if (!b) return 'restoreDocuments: nothing';
      const r = await restoreDocuments(s.p, b);
      return `restoreDocuments ${b.slice(0, 6)} → ${r.documents}`;
    },
  },
  {
    name: 'createDocument', w: 1, run: async (_w, s, rng) => {
      if ((await s.p.store.count('document')) >= 5) return 'createDocument: enough';
      const r = await createDocument(s.p, { name: `Notes ${rng.int(100)}`, kind: 'text', text: randomText(rng) });
      record(s, r.undo);
      return `createDocument ${r.document.name}`;
    },
  },
  {
    name: 'createMemo', w: 3, run: async (_w, s, rng) => {
      const r = rng();
      let target: Parameters<typeof createMemo>[1]['target'] = { kind: 'project', id: null };
      if (r < 0.3) {
        const d = rng.pick(await live(s, 'document'));
        if (d) target = { kind: 'document', id: d.id };
      } else if (r < 0.6) {
        const c = rng.pick(await live(s, 'code'));
        if (c) target = { kind: 'code', id: c.id };
      } else if (r < 0.9) {
        const c = await pickCoding(s, rng);
        if (c) target = { kind: 'coding', id: c.id };
      }
      record(s, (await createMemo(s.p, { title: randomPiece(rng, 2), body: randomPiece(rng, 5), target })).undo);
      return `createMemo on ${target.kind}`;
    },
  },
  {
    name: 'updateMemo', w: 2, run: async (_w, s, rng) => {
      const m = rng.pick(await live(s, 'memo'));
      if (!m) return 'updateMemo: nothing';
      record(s, (await updateMemo(s.p, m.id, rng.chance(0.5) ? { title: randomPiece(rng, 2) } : { body: m.body + randomPiece(rng, 3) })).undo);
      return `updateMemo ${m.id.slice(0, 6)}`;
    },
  },
  {
    name: 'deleteMemo', w: 1, run: async (_w, s, rng) => {
      const m = rng.pick(await live(s, 'memo'));
      if (!m) return 'deleteMemo: nothing';
      const r = await deleteMemo(s.p, m.id);
      s.memoBatches.push(r.batch);
      record(s, r.undo);
      return `deleteMemo ${m.id.slice(0, 6)}`;
    },
  },
  {
    name: 'restoreMemos', w: 0.5, run: async (_w, s, rng) => {
      const b = rng.pick(s.memoBatches);
      if (!b) return 'restoreMemos: nothing';
      return `restoreMemos ${b.slice(0, 6)} → ${await restoreMemos(s.p, b)}`;
    },
  },
  {
    name: 'renameDocument', w: 1, run: async (_w, s, rng) => {
      const d = rng.pick(await live(s, 'document'));
      if (!d) return 'renameDocument: nothing';
      const name = `${rng.pick(['Interview', 'Mariana', 'Porto notes', 'Field'])!} ${rng.int(20)}`;
      record(s, (await renameDocument(s.p, d.id, name)).undo);
      return `renameDocument ${d.name} → ${name}`;
    },
  },
  {
    name: 'splitCode', w: 1, run: async (_w, s, rng) => {
      const c = await pickCoding(s, rng);
      if (!c) return 'splitCode: nothing';
      const r = await splitCode(s.p, c.code_id, { newName: `${rng.pick(CODE_NAMES)!} part`, codingIds: [c.id] });
      record(s, r.undo);
      return `splitCode → ${r.code.name}`;
    },
  },
  {
    name: 'resolveConflict', w: 2, run: async (_w, s, rng) => {
      const c = s.conflicts.shift();
      if (!c) return 'resolveConflict: nothing';
      const here = await s.p.store.get('doctext', c.documentId);
      if (!here || here.deleted) return 'resolveConflict: document gone';
      if (rng.chance(0.5)) {
        record(s, (await takeTeammateText(s.p, c.documentId, c.theirText!, c.theirRevs!)).undo);
        return `resolveConflict ${c.name}: takes the teammate's text`;
      }
      // Brings the teammate's words over by hand: their text's tail onto this one.
      const theirs = c.theirText ?? '';
      const cut = rng.int(theirs.length + 1);
      record(s, (await editDocumentText(s.p, c.documentId, here.text + theirs.slice(cut, cut + 20))).undo);
      return `resolveConflict ${c.name}: by hand`;
    },
  },
  {
    name: 'pseudonymise', w: 1.5, run: async (_w, s, rng) => {
      const key = await live(s, 'pseudonym');
      const pair = rng.pick(NAMES.filter((n) => !key.some((k) => k.original === n.original)));
      if (!pair) return 'pseudonymise: key complete';
      const made = await createPseudonym(s.p, pair);
      record(s, made.undo);
      const r = await apply(s.p, [made.pseudonym.id]);
      record(s, r.undo);
      return `pseudonymise ${pair.original} → ${pair.replacement} ×${r.replacements}`;
    },
  },
  {
    name: 'deletePseudonym', w: 0.5, run: async (_w, s, rng) => {
      const p = rng.pick(await live(s, 'pseudonym'));
      if (!p) return 'deletePseudonym: nothing';
      const erase = rng.chance(0.5);
      record(s, await deletePseudonym(s.p, p.id, { erase }));
      return `deletePseudonym ${p.original}${erase ? ' (erase)' : ''}`;
    },
  },
  { name: 'undo', w: 8, run: (world, s) => undoRedo(world, s, 'undo') },
  { name: 'redo', w: 2, run: (world, s) => undoRedo(world, s, 'redo') },
  {
    name: 'undoThenRedo', w: 3, run: async (world, s, rng) => {
      const n = 1 + rng.int(3);
      const out: string[] = [];
      for (let i = 0; i < n; i++) out.push(await undoRedo(world, s, 'undo'));
      for (let i = 0; i < n; i++) if (rng.chance(0.7)) out.push(await undoRedo(world, s, 'redo'));
      return out.join('; ');
    },
  },
  { name: 'merge', w: 6, run: (world, s) => mergeInto(world, s, other(world, s)).then((r) => `merge ← ${other(world, s).name} ${brief(r)}`) },
  { name: 'converge', w: 1.5, run: (world) => converge(world) },
  { name: 'reexport', w: 1, run: (world, s, rng) => reexport(world, s, rng) },
  {
    name: 'skew', w: 0.5, run: async (_w, s, rng) => {
      // The computer's clock is set differently (even backwards).
      s.skew = (rng.int(2) ? -1 : 1) * rng.int(3_600_000);
      return `skew ${s.skew}`;
    },
  },
];
const TOTAL_W = OPS.reduce((n, o) => n + o.w, 0);

const other = (world: World, s: Side): Side => (s.name === 'A' ? world.B : world.A);
const brief = (r: MergeResult) => `+${r.added} ~${r.updated} ⚠${r.textConflicts.length} ↦${r.reanchored} −${r.removedCodings} ↺${r.revived.length} ↻${r.repseudonymised.length}`;

/** Everything in the database, for "a refused step writes nothing". */
async function snapshot(s: Side): Promise<string> {
  const out: string[] = [];
  for await (const { kind, record } of s.p.store.all()) out.push(`${kind}:${JSON.stringify(record)}`);
  return out.join('\n');
}

async function undoRedo(_world: World, s: Side, dir: 'undo' | 'redo'): Promise<string> {
  const can = dir === 'undo' ? s.undo.canUndo : s.undo.canRedo;
  if (!can) return `${dir}: nothing`;
  const label = (dir === 'undo' ? s.undo.labels.undo : s.undo.labels.redo)!;
  const before = await snapshot(s);
  try {
    await (dir === 'undo' ? s.undo.undo() : s.undo.redo());
    return `${dir} ${label.label} ${label.detail}`;
  } catch (e) {
    const refused = (e instanceof ServiceError && e.code === 'changed_since') || e instanceof ErasedRecordError;
    if (!refused) throw new Violation(`${dir} ${label.label} threw ${String(e)}\n${(e as Error).stack}`);
    if ((await snapshot(s)) !== before) throw new Violation(`${dir} ${label.label} was refused but wrote something`);
    return `${dir} ${label.label}: refused`;
  }
}

// ---------------------------------------------------------------------------------------------
// Merging and copies

async function appliedKey(s: Side) {
  return (await s.p.store.list('pseudonym')).filter((p) => p.applied_at !== null);
}

/** Where an original of the side's applied key is in its live texts and fields. */
async function originalsLeft(s: Side): Promise<string[]> {
  if (!(await appliedKey(s)).length) return [];
  const p = await preview(s.p, undefined, { appliedOnly: true, protect: true });
  return [...p.documents.map((d) => `text of ${d.name}: ${d.samples.map((x) => x.match).join(', ')}`), ...p.fields.map((f) => `${f.kind}.${f.field} of ${f.label}: ${f.sample.match}`)];
}

/**
 * The researcher applies the key again to what they typed since (a name, in a comment): so "no
 * original after the merge" checks only what the merge brought.
 */
async function cleanKey(world: World, s: Side): Promise<void> {
  if (!(await originalsLeft(s)).length) return;
  const r = await apply(s.p, (await appliedKey(s)).map((p) => p.id));
  record(s, r.undo);
  const left = await originalsLeft(s);
  if (left.length) throw new Violation(`applying the key left originals on ${s.name}: ${left.join('; ')}`);
  world.log.push(`  (${s.name} applies its key again ×${r.replacements})`);
}

async function mergeInto(world: World, into: Side, from: Side): Promise<MergeResult> {
  await cleanKey(world, into);
  const bundle = readTramaZip(await exportProjectFile(from.p, { includePseudonyms: false }));

  const r = await mergeTeammateCopy(into.p, bundle);
  into.conflicts = r.textConflicts;
  await checkSide(into, `after merging into ${into.name}`);
  const left = await originalsLeft(into);
  if (left.length) throw new Violation(`originals of the applied key on ${into.name} after a merge: ${left.join('; ')}`);
  if (r.originalsFound.length) throw new Violation(`merge reported originals found: ${JSON.stringify(r.originalsFound)}`);
  return r;
}

/** Both sides merge each other with nothing between: same live content (when no conflict). */
async function converge(world: World): Promise<string> {
  // Each side first applies its key to what it typed since: that is an edit, not part of merging.
  await cleanKey(world, world.A);
  await cleanKey(world, world.B);
  const r1 = await mergeInto(world, world.A, world.B);
  const r2 = await mergeInto(world, world.B, world.A);
  let note = `converge A←B ${brief(r1)} B←A ${brief(r2)}`;
  if (r1.textConflicts.length || r2.textConflicts.length) return `${note} (conflicts: not compared)`;
  if (r2.repseudonymised.length) {
    // B's key replaced names A had typed: A takes that in one more merge.
    const r3 = await mergeInto(world, world.A, world.B);
    note += ` A←B ${brief(r3)}`;
    if (r3.textConflicts.length) return `${note} (conflicts: not compared)`;
  }
  return note + (await checkConverged(world));
}

async function reexport(world: World, s: Side, rng: Rng): Promise<string> {
  // A copy of a copy: this computer's project moved to another (its own copy), or replaced by a
  // fresh copy of the teammate's.
  const fromSelf = rng.chance(0.6);
  const src = fromSelf ? s : other(world, s);
  const withKey = fromSelf && rng.chance(0.5);
  const bytes = await exportProjectFile(src.p, { includePseudonyms: withKey });
  const meId = s.p.me.id;
  const meName = s.p.me.name;
  await s.lib.lock();
  const lib = await newLibrary(world, s.name);
  const p = await importProjectFile(lib, bytes, { kind: 'none' }, { asCopyOfSameProject: true });
  const coder = await p.store.get('coder', meId);
  await p.setMe(coder && !coder.deleted ? coder.id : (await p.addCoder(meName)).id);
  Object.assign(s, { lib, p, undo: new UndoManager(), docBatches: [], codeBatches: [], memoBatches: [], conflicts: [] });
  return `reexport ${s.name} from ${src.name}${withKey ? ' (with key)' : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Invariants

async function checkSide(s: Side, where: string): Promise<void> {
  const st = s.p.store;
  const fail = (msg: string) => {
    throw new Violation(`${s.name} ${where}: ${msg}`);
  };
  const docs = new Map((await st.list('document', { includeDeleted: true })).map((d) => [d.id, d]));
  const texts = new Map((await st.list('doctext', { includeDeleted: true })).map((t) => [t.id, t]));
  const codes = new Map((await st.list('code', { includeDeleted: true })).map((c) => [c.id, c]));
  for (const d of docs.values()) {
    const t = texts.get(d.id);
    if (!t) fail(`document ${d.name} has no doctext`);
    if (!d.deleted && t!.deleted) fail(`live document ${d.name} with a deleted doctext`);
    if (d.deleted && !t!.deleted) fail(`deleted document ${d.name} with a live doctext`);
    if (!d.deleted && d.chars !== t!.text.length) fail(`document ${d.name}: chars ${d.chars} ≠ text length ${t!.text.length}`);
  }
  for (const t of texts.values()) if (!docs.has(t.id)) fail(`doctext ${t.id} without document`);
  for (const c of await st.list('coding')) {
    const d = docs.get(c.document_id);
    const t = texts.get(c.document_id);
    const code = codes.get(c.code_id);
    const id = `coding ${c.id.slice(0, 8)} (${code?.name ?? '?'} in ${d?.name ?? '?'})`;
    if (!d || d.deleted) fail(`${id}: its document is ${d ? 'deleted' : 'missing'}`);
    if (!code || code.deleted) fail(`${id}: its code is ${code ? 'deleted' : 'missing'}`);
    if (!code!.codable) fail(`${id}: its code is a category`);
    const text = t!.text;
    if (!(c.start >= 0 && c.start < c.end && c.end <= text.length)) fail(`${id}: span [${c.start},${c.end}) outside 0..${text.length}`);
    if (text.slice(c.start, c.end) !== c.text) fail(`${id}: text ${JSON.stringify(c.text)} ≠ ${JSON.stringify(text.slice(c.start, c.end))}`);
  }
  for (const m of await st.list('memo')) {
    if (m.target.kind === 'project') continue;
    const target = await st.get(m.target.kind, m.target.id);
    if (!target || target.deleted) fail(`memo ${JSON.stringify(m.title)} targets a ${target ? 'deleted' : 'missing'} ${m.target.kind}`);
  }
  // A code whose parent is deleted is shown at the top (core/qda/tree.ts) and goes back under it
  // when the parent is restored; a cycle among live codes is never right.
  for (const c of codes.values()) {
    if (c.deleted) continue;
    const seen = new Set<string>([c.id]);
    for (let at = c; at.parent_id !== null; ) {
      const parent = codes.get(at.parent_id);
      if (!parent || parent.deleted) break;
      if (seen.has(parent.id)) fail(`codes form a cycle through ${c.name}`);
      seen.add(parent.id);
      at = parent;
    }
  }
}

const COMPARED: Kind[] = ['coder', 'document', 'doctext', 'code', 'coding', 'memo', 'case', 'docgroup', 'attribute'];

async function liveContent(s: Side): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const kind of COMPARED) {
    for (const r of await s.p.store.list(kind)) {
      const { updated_at_hlc: _h, ...rest } = r as Entity<Kind>;
      out.set(`${kind}:${r.id}`, JSON.stringify(rest, Object.keys(rest).sort()));
    }
  }
  return out;
}

async function differences(world: World): Promise<{ key: string; text: string }[]> {
  const a = await liveContent(world.A);
  const b = await liveContent(world.B);
  const diffs: { key: string; text: string }[] = [];
  for (const [k, v] of a) if (b.get(k) !== v) diffs.push({ key: k, text: `${k}\n  A: ${v}\n  B: ${b.get(k) ?? '(not live)'}` });
  for (const [k, v] of b) if (!a.has(k)) diffs.push({ key: k, text: `${k}\n  A: (not live)\n  B: ${v}` });
  return diffs;
}

/**
 * The copies hold the same live content. One allowance: what B put back while merging A's copy
 * (codings brought back from its trash with a code or document that came back) that A holds only
 * as a tombstone reaches A with A's next merge. A copy never carries a deleted record's content,
 * so A could not have put it back itself (or kept its own, older content under B's delete).
 */
async function checkConverged(world: World): Promise<string> {
  let diffs = await differences(world);
  if (!diffs.length) return '';
  const carried = async (key: string) => {
    const [kind, id] = key.split(':') as [Kind, string];
    const mine = await world.A.p.store.get(kind, id);
    const theirs = await world.B.p.store.get(kind, id);
    return !!mine && mine.deleted && !!theirs && !theirs.deleted && theirs.updated_at_hlc > mine.updated_at_hlc;
  };
  let allowed = true;
  for (const d of diffs) if (!(await carried(d.key))) allowed = false;
  let note = '';
  if (allowed) {
    const r3 = await mergeInto(world, world.A, world.B);
    note = ` then A←B ${brief(r3)}`;
    diffs = await differences(world);
  }
  if (diffs.length) {
    const shown: string[] = [];
    for (const d of diffs.slice(0, 6)) {
      const [kind, id] = d.key.split(':') as [Kind, string];
      const a = await world.A.p.store.get(kind, id);
      shown.push(`${d.text}\n  A has: ${a ? JSON.stringify(a) : 'nothing'}`);
    }
    throw new Violation(`copies differ after merging each other${note}:\n${shown.join('\n')}`);
  }
  return note;
}

// ---------------------------------------------------------------------------------------------
// Running

interface Failure {
  seed: number;
  episode: number;
  step: number;
  message: string;
  log: string[];
}

function pickOp(rng: Rng) {
  let r = rng() * TOTAL_W;
  for (const o of OPS) {
    r -= o.w;
    if (r < 0) return o;
  }
  return OPS[OPS.length - 1]!;
}

/** One episode: a fresh project and its copy, then `steps` operations (except `skip`). */
async function runEpisode(seed: number, episode: number, steps: number, skip: ReadonlySet<number> = new Set()): Promise<Failure | null> {
  const epSeed = hash32(seed, episode);
  appRandom = prng(hash32(epSeed, 0xa11));
  const world = { t: T0 + episode * 86_400_000, log: [], seedOf: (i: number) => hash32(epSeed, i + 1) } as unknown as World;
  let step = -1;
  try {
    await setup(world, rngOf(hash32(epSeed, 0x5e7)));
    await checkSide(world.A, 'after setup');
    await checkSide(world.B, 'after setup');
    for (step = 0; step < steps; step++) {
      if (skip.has(step)) continue;
      // Each step's choices come from its own stream, so leaving steps out (minimising) keeps
      // the others as they were.
      const rng = rngOf(world.seedOf(step));
      advance(world, rng);
      const side = rng.chance(0.5) ? world.A : world.B;
      const op = pickOp(rng);
      let line: string;
      world.log.push(`${step} ${side.name} ${op.name} …`);
      try {
        line = `${step} ${side.name} ${await op.run(world, side, rng)}`;
      } catch (e) {
        if (e instanceof ServiceError && REFUSALS.has(e.code)) line = `${step} ${side.name} ${op.name}: refused (${e.code})`;
        else throw e;
      }
      world.log[world.log.length - 1] = line;
      if (TRACE) appendFileSync(TRACE, `${seed}:${episode} ${line}\n`);
      await checkSide(world.A, `after step ${step} (${op.name})`);
      await checkSide(world.B, `after step ${step} (${op.name})`);
    }
    // The end: both merge each other, then everything holds and the copies agree.
    step = steps;
    world.log.push(`end ${await converge(world)}`);
    return null;
  } catch (e) {
    const message = e instanceof Violation ? e.message : `unexpected ${String(e)}\n${(e as Error).stack ?? ''}`;
    return { seed, episode, step, message, log: world.log };
  } finally {
    await world.A?.lib?.lock().catch(() => undefined);
    await world.B?.lib?.lock().catch(() => undefined);
  }
}

/** Delta debugging over the steps of a failing episode: the fewest steps that still fail. */
async function minimise(f: Failure, steps: number): Promise<Failure> {
  const kind = (m: string) => m.replace(/[0-9a-f]{8}/g, '').split('\n')[0]!.replace(/after step \d+/, '').replace(/\d+/g, '#');
  const want = kind(f.message);
  let keep = [...Array(Math.min(steps, f.step + 1)).keys()];
  let best = f;
  const fails = async (subset: number[]) => {
    const skip = new Set([...Array(steps).keys()].filter((i) => !subset.includes(i)));
    const r = await runEpisode(f.seed, f.episode, Math.max(...subset, -1) + 1, skip);
    if (r && kind(r.message) === want) {
      best = r;
      return true;
    }
    return false;
  };
  let n = 2;
  while (keep.length >= 1) {
    const size = Math.ceil(keep.length / n);
    let reduced = false;
    for (let i = 0; i < keep.length; i += size) {
      const without = keep.filter((_, j) => j < i || j >= i + size);
      if (await fails(without)) {
        keep = without;
        n = Math.max(n - 1, 2);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (size === 1) break;
      n = Math.min(keep.length, n * 2);
    }
  }
  return best;
}

function report(f: Failure): string {
  return `seed ${f.seed} episode ${f.episode} step ${f.step}: ${f.message}\n--- operations ---\n${f.log.slice(-60).join('\n')}`;
}

describe('fuzzing two copies of a project that merge each other', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      if (!array) return array;
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(appRandom() * 256);
      return array;
    });
  });
  afterAll(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const episodes = Math.max(1, Math.ceil(ITERATIONS / EPISODE));
  for (const seed of SEEDS) {
    it(`holds every invariant (seed ${seed}, ${ITERATIONS} operations)`, async () => {
      for (let e = 0; e < episodes; e++) {
        if (ONLY && ONLY !== `${seed}:${e}`) continue;
        const steps = Math.min(EPISODE, ITERATIONS - e * EPISODE);
        const skip = KEEP ? new Set([...Array(steps).keys()].filter((i) => !KEEP.includes(i))) : undefined;
        let f = await runEpisode(seed, e, KEEP ? Math.max(...KEEP) + 1 : steps, skip);
        if (f && MINIMIZE) f = await minimise(f, steps);
        expect(f && report(f)).toBeNull();
      }
    }, 600_000);
  }
});
