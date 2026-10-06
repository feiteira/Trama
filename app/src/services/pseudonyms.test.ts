import { describe, expect, it } from 'vitest';
import { createCode } from './codes';
import { applyCode } from './codings';
import { createDocument, getText } from './documents';
import { listLog } from './log';
import {
  apply,
  createPseudonym,
  deletePseudonym,
  findMatches,
  listPseudonyms,
  preview,
  suggestCandidates,
  updatePseudonym,
} from './pseudonyms';
import { makeTestProject } from './testing';

const T1 = 'Entrevistadora: Onde trabalha?\nAna Lima: Trabalho em Braga com a Ana e o Rui.\nEntrevistadora: E a Anabela?';
const T2 = 'Rui: A ANA LIMA ligou-me. Ana  Lima é minha vizinha.';

async function setup() {
  const ctx = await makeTestProject();
  const d1 = (await createDocument(ctx, { name: 'Entrevista 1', kind: 'transcript', text: T1 })).document;
  const d2 = (await createDocument(ctx, { name: 'Entrevista 2', kind: 'transcript', text: T2 })).document;
  return { ctx, d1, d2 };
}

describe('findMatches', () => {
  it('honours whole words and case', () => {
    const rule = { original: 'Ana', whole_word: true, case_sensitive: true };
    expect(findMatches(T1, rule).map((m) => T1.slice(m.start, m.end))).toEqual(['Ana', 'Ana']);
    expect(findMatches(T1, { ...rule, whole_word: false }).length).toBe(3); // Anabela too
    expect(findMatches(T2, { ...rule, original: 'ana lima', case_sensitive: false }).map((m) => T2.slice(m.start, m.end))).toEqual(['ANA LIMA', 'Ana  Lima']);
    expect(findMatches('São Tomé e são tomé', { original: 'são tomé', whole_word: true, case_sensitive: false }).length).toBe(2);
    expect(findMatches('a.b axb', { original: 'a.b', whole_word: false, case_sensitive: true }).length).toBe(1);
    expect(findMatches('', rule)).toEqual([]);
  });

  it('does not match across line breaks', () => {
    expect(findMatches('Ana\nLima', { original: 'Ana Lima', whole_word: true, case_sensitive: true })).toEqual([]);
  });
});

describe('the key', () => {
  it('creates, refuses duplicates, updates and lists', async () => {
    const { ctx } = await setup();
    const { pseudonym } = await createPseudonym(ctx, { original: ' Ana  Lima ', replacement: 'P1' });
    expect(pseudonym.original).toBe('Ana Lima');
    expect(pseudonym.whole_word && pseudonym.case_sensitive).toBe(true);
    await expect(createPseudonym(ctx, { original: 'Ana Lima', replacement: 'X' })).rejects.toMatchObject({ code: 'invalid_argument' });
    await createPseudonym(ctx, { original: 'Braga', replacement: '[cidade]' });
    expect((await listPseudonyms(ctx)).map((p) => p.original)).toEqual(['Ana Lima', 'Braga']);
    expect((await updatePseudonym(ctx, pseudonym.id, { replacement: 'Participante 1' })).pseudonym.replacement).toBe('Participante 1');
  });

  it('deletes, optionally erasing the original from the database', async () => {
    const { ctx } = await setup();
    const a = (await createPseudonym(ctx, { original: 'Ana', replacement: 'P1' })).pseudonym;
    const b = (await createPseudonym(ctx, { original: 'Rui', replacement: 'P2' })).pseudonym;
    const undo = await deletePseudonym(ctx, a.id);
    await undo.undo();
    expect((await ctx.store.get('pseudonym', a.id))!.deleted).toBe(false);
    await deletePseudonym(ctx, b.id, { erase: true });
    const tomb = (await ctx.store.get('pseudonym', b.id))!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.original).not.toBe('Rui');
    expect(JSON.stringify(await ctx.store.list('pseudonym', { includeDeleted: true }))).not.toContain('Rui');
  });
});

describe('suggestCandidates', () => {
  it('finds names that are not just sentence starts', () => {
    const text = [
      'Entrevistadora: Como conheceu a Maria da Silva?',
      'Rui: Conheci a Maria da Silva em Coimbra. Depois fomos ao Porto. Ela trabalha com o João.',
      'Rui: O João é simpático. Depois disso, nada.',
    ].join('\n');
    const c = suggestCandidates([text]);
    const names = c.map((x) => x.text);
    expect(names).toContain('Maria da Silva');
    expect(names).toContain('Coimbra');
    expect(names).toContain('Porto');
    expect(names).toContain('Rui');
    expect(c.find((x) => x.text === 'João')!.count).toBe(2);
    expect(names).not.toContain('Depois');
    expect(names).not.toContain('Ela');
    expect(names).not.toContain('Entrevistadora');
    expect(names).not.toContain('Conheci');
    expect(c.find((x) => x.text === 'Maria da Silva')!.count).toBe(2);
  });

  it('handles English and Spanish, exclusions and empty input', () => {
    const c = suggestCandidates(['I met Sarah Connor on Monday. Sarah said hi.', '¿Vio a Pedro? Sí, Pedro estaba en Sevilla.'], { exclude: ['sevilla'] });
    const names = c.map((x) => x.text);
    expect(names).toEqual(expect.arrayContaining(['Sarah Connor', 'Pedro']));
    expect(names).not.toContain('Monday');
    expect(names).not.toContain('Sevilla');
    expect(names).not.toContain('I');
    expect(suggestCandidates([])).toEqual([]);
    expect(suggestCandidates([''])).toEqual([]);
  });

  it('never suggests contractions, and takes possessives as the name', () => {
    const c = suggestCandidates([
      'Rui: Well, I’m not sure. I\'ll ask, and I\'ve told Ana\'s mother. Then I’d go, but I don\'t know. Don’t worry, We\'re fine, You\'ll see.',
      'Rui: Ana’s garden is big, and Rui\'s too. It\'s Ana. Can\'t say more, That\'s all, said O\'Brien, and D\'Angelo.',
    ]);
    const names = c.map((x) => x.text);
    for (const w of ['I’m', "I'll", "I've", 'I’d', "Don't", 'Don’t', "We're", "You'll", "Can't", "It's", 'It', "That's", 'That']) expect(names).not.toContain(w);
    expect(names).toEqual(expect.arrayContaining(['Ana', 'Rui', "O'Brien", "D'Angelo"]));
    expect(names).not.toContain('Ana’s');
    expect(c.find((x) => x.text === 'Ana')!.count).toBe(3);
  });

  it('leaves out the words spoken sentences start with, in English, Portuguese and Spanish', () => {
    const lines = [
      'Rui: Now, Maria said yes. Well, Maria knew. Yes, and Maybe, Okay, So, But, And, Then, Also, Actually Maria.',
      'Ana: Então, a Maria disse. Bem, Sim, Pois, Mas, Agora, Olha, Pronto, Talvez, Claro — a Maria sabia.',
      'Eva: Bueno, Pues, Entonces, Ahora, Vale, Oye, Vamos, Hombre — la Maria lo sabía.',
      // Mid-sentence after a comma too, where a capital usually means a name.
      'Rui: and then, Now Maria, Agora Maria, Ahora Maria, Bueno Maria.',
      // A transcriber's note between sentences does not hide where the next one starts.
      'Rui: Terrifying. [laughs] Sounds daft. (pausa) Parece parvo, e a Maria. [ri-se] Durante anos. Mi casa.',
      // Spanish and Portuguese function words, plural days, and a leading particle once "E" is gone.
      'Eva: lo vi el lunes, En casa y Al final. On Saturdays Maria came. E das Amoreiras, Maria.',
    ];
    const names = suggestCandidates([lines.join('\n')]).map((x) => x.text);
    for (const w of ['Sounds', 'Parece', 'Durante', 'Mi', 'En', 'Al', 'Saturdays', 'das Amoreiras', 'Now', 'Well', 'Yes', 'Maybe', 'Okay', 'So', 'But', 'And', 'Then', 'Also', 'Actually', 'Então', 'Bem', 'Sim', 'Pois', 'Mas', 'Agora', 'Olha', 'Pronto', 'Talvez', 'Claro', 'Bueno', 'Pues', 'Entonces', 'Ahora', 'Vale', 'Oye', 'Vamos', 'Hombre']) {
      expect(names, w).not.toContain(w);
      expect(names.some((n) => n.startsWith(`${w} `)), w).toBe(false);
    }
    expect(names).toEqual(expect.arrayContaining(['Maria', 'Rui', 'Ana', 'Eva', 'Amoreiras']));
  });
});

describe('preview and apply', () => {
  it('previews per document without changing anything', async () => {
    const { ctx, d1, d2 } = await setup();
    const full = (await createPseudonym(ctx, { original: 'Ana Lima', replacement: 'P1', case_sensitive: false })).pseudonym;
    const short = (await createPseudonym(ctx, { original: 'Ana', replacement: 'P9' })).pseudonym;
    const p = await preview(ctx);
    expect(p.total).toBe(4);
    expect(p.counts.get(full.id)).toBe(3);
    expect(p.counts.get(short.id)).toBe(1); // "Ana Lima" wins where both match
    const doc1 = p.documents.find((d) => d.documentId === d1.id)!;
    expect(doc1.count).toBe(2);
    expect(doc1.samples[0]!.match).toBe('Ana Lima');
    expect(doc1.samples[0]!.after.startsWith(': Trabalho')).toBe(true);
    expect(p.documents.find((d) => d.documentId === d2.id)!.count).toBe(2);
    expect((await getText(ctx, d1.id)).text).toBe(T1);
    expect((await preview(ctx, [])).total).toBe(0);
  });

  it('replaces across documents, longer originals first, remapping codings', async () => {
    const { ctx, d1, d2 } = await setup();
    const { code } = await createCode(ctx, { name: 'Trabalho' });
    const s = T1.indexOf('Trabalho em');
    const e = T1.indexOf(' e o Rui') + ' e o Rui'.length;
    const { coding } = await applyCode(ctx, { documentId: d1.id, start: s, end: e, codeId: code.id });
    const label = await applyCode(ctx, { documentId: d1.id, start: T1.indexOf('Ana Lima'), end: T1.indexOf('Ana Lima') + 8, codeId: code.id });
    const { coding: c2 } = await applyCode(ctx, { documentId: d2.id, start: 0, end: T2.length, codeId: code.id });
    const full = (await createPseudonym(ctx, { original: 'Ana Lima', replacement: 'P1', case_sensitive: false })).pseudonym;
    const short = (await createPseudonym(ctx, { original: 'Ana', replacement: 'Participante 9' })).pseudonym;
    await createPseudonym(ctx, { original: 'Rui', replacement: 'P2' });
    await createPseudonym(ctx, { original: 'Braga', replacement: '[cidade]' });

    const r = await apply(ctx);
    expect(r.documents).toBe(2);
    expect(r.replacements).toBe(7);
    expect(r.removedCodings).toBe(0);
    const t1 = (await getText(ctx, d1.id)).text;
    expect(t1).toBe('Entrevistadora: Onde trabalha?\nP1: Trabalho em [cidade] com a Participante 9 e o P2.\nEntrevistadora: E a Anabela?');
    const t2 = (await getText(ctx, d2.id)).text;
    expect(t2).toBe('P2: A P1 ligou-me. P1 é minha vizinha.');
    const c = (await ctx.store.get('coding', coding.id))!;
    expect(c.text).toBe('Trabalho em [cidade] com a Participante 9 e o P2');
    expect(t1.slice(c.start, c.end)).toBe(c.text);
    expect((await ctx.store.get('coding', label.coding.id))!.text).toBe('P1');
    expect((await ctx.store.get('coding', c2.id))!.text).toBe(t2);
    expect((await ctx.store.get('pseudonym', full.id))!.applied_count).toBe(3);
    expect((await ctx.store.get('pseudonym', short.id))!.applied_at).not.toBeNull();

    // The log says how much, never what.
    const [entry] = await listLog(ctx, { action: 'pseudonym.apply' });
    expect(entry!.summary).toBe('×7 → "Entrevista 1", "Entrevista 2"');
    const everything = JSON.stringify(await listLog(ctx, { limit: 1000 }));
    expect(everything).not.toMatch(/Ana|Lima|Braga/);
    expect((await listLog(ctx, { action: 'document.edit' })).length).toBe(0);

    await r.undo.undo();
    expect((await getText(ctx, d1.id)).text).toBe(T1);
    expect((await ctx.store.get('coding', coding.id))!.text).toBe('Trabalho em Braga com a Ana e o Rui');
    expect((await ctx.store.get('pseudonym', full.id))!.applied_count).toBe(0);
    await r.undo.redo();
    expect((await getText(ctx, d2.id)).text).toBe(t2);
  });

  it('reports progress document by document', async () => {
    const { ctx } = await setup();
    await createDocument(ctx, { name: 'Entrevista 3', kind: 'text', text: 'Sem nomes.' });
    await createPseudonym(ctx, { original: 'Rui', replacement: 'P2' });
    const steps: [number, number][] = [];
    const r = await apply(ctx, undefined, { onProgress: (d, t) => void steps.push([d, t]) });
    expect(r.documents).toBe(2);
    expect(steps).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('applies only the chosen entries and handles no matches', async () => {
    const { ctx, d1 } = await setup();
    const braga = (await createPseudonym(ctx, { original: 'Braga', replacement: 'X' })).pseudonym;
    await createPseudonym(ctx, { original: 'Rui', replacement: 'P2' });
    const r = await apply(ctx, [braga.id]);
    expect(r.replacements).toBe(1);
    expect((await getText(ctx, d1.id)).text).toContain('o Rui.');
    const none = await apply(ctx, ['missing']);
    expect(none.replacements).toBe(0);
    const absent = (await createPseudonym(ctx, { original: 'Zacarias', replacement: 'Z' })).pseudonym;
    const r2 = await apply(ctx, [absent.id]);
    expect(r2.documents).toBe(0);
    expect((await ctx.store.get('pseudonym', absent.id))!.applied_count).toBe(0);
  });
});

describe('erased key entries stay erased', () => {
  it('Undo/Redo never brings an erased original back (P1: create, edit, erase, undo, undo)', async () => {
    const { UndoManager } = await import('./undo');
    const ctx = await makeTestProject();
    const m = new UndoManager();
    const { pseudonym } = await createPseudonym(ctx, { original: 'Maria Silva', replacement: 'P1' });
    m.record((await updatePseudonym(ctx, pseudonym.id, { replacement: '[Participant 1]' })).undo);
    m.record(await deletePseudonym(ctx, pseudonym.id, { erase: true }));
    expect(m.canUndo).toBe(false);
    expect(await m.undo()).toBeNull();
    const stored = await ctx.store.get('pseudonym', pseudonym.id);
    expect(stored).toMatchObject({ original: '∅', deleted: true });
    expect(await listPseudonyms(ctx)).toEqual([]);
  });

  it('P2: create recorded, erase, undo, undo, redo — still erased', async () => {
    const { UndoManager } = await import('./undo');
    const ctx = await makeTestProject();
    const m = new UndoManager();
    const r = await createPseudonym(ctx, { original: 'Maria Silva', replacement: 'P1' });
    m.record(r.undo);
    m.record(await deletePseudonym(ctx, r.pseudonym.id, { erase: true }));
    await m.undo();
    await m.undo();
    await m.redo();
    expect(await listPseudonyms(ctx)).toEqual([]);
    // Even an Undoable kept elsewhere cannot write over the erased record.
    await expect(r.undo.redo()).rejects.toThrow();
    await expect(r.undo.undo()).rejects.toThrow();
    expect((await ctx.store.get('pseudonym', r.pseudonym.id))!.original).toBe('∅');
  });
});

describe('pseudonymisation covers names, comments, memos and definitions', () => {
  it('P3: replaces the original everywhere but the audit trail, which the preview reports', async () => {
    const { inVivo, setComment } = await import('./codings');
    const { createMemo } = await import('./memos');
    const { createCase } = await import('./cases');
    const { UndoManager } = await import('./undo');
    const ctx = await makeTestProject();
    const text = 'Interviewer: Hello.\nMaria Silva: I trust my neighbours.';
    const { case: cs } = await createCase(ctx, { name: 'Maria Silva', description: 'Maria Silva, 64, gardener' });
    const { document: doc } = await createDocument(ctx, { name: 'Interview — Maria Silva', kind: 'transcript', text, case_id: cs.id });
    const s = text.indexOf('Maria Silva: I trust');
    const v = await inVivo(ctx, { documentId: doc.id, start: s, end: text.length });
    await setComment(ctx, v.coding.id, 'Maria Silva hesitates here');
    await createMemo(ctx, { title: 'About Maria Silva', body: 'Maria Silva is the gardener.', target: { kind: 'project', id: null } });
    await createPseudonym(ctx, { original: 'Maria Silva', replacement: '[P1]' });

    const p = await preview(ctx);
    expect(p.textTotal).toBe(1);
    expect(new Set(p.fields.map((f) => `${f.kind}.${f.field}`))).toEqual(
      new Set(['document.name', 'case.name', 'case.description', 'code.name', 'coding.comment', 'memo.title', 'memo.body']),
    );
    expect(p.total).toBe(p.textTotal + p.fields.reduce((n, f) => n + f.count, 0));
    expect(p.logEntries).toBeGreaterThan(0);

    const m = new UndoManager();
    const r = await apply(ctx);
    m.record(r.undo);
    expect(r.fieldReplacements).toBe(7);
    const live = async () => {
      const found: string[] = [];
      for (const kind of ['document', 'doctext', 'case', 'code', 'coding', 'memo'] as const) {
        for (const rec of await ctx.store.list(kind)) if (JSON.stringify(rec).includes('Maria Silva')) found.push(kind);
      }
      return found;
    };
    expect(await live()).toEqual([]);
    expect((await ctx.store.get('document', doc.id))!.name).toBe('Interview — [P1]');
    // The apply log entry itself names no original.
    expect((await listLog(ctx, { action: 'pseudonym.apply' }))[0]!.summary).not.toContain('Maria');
    await m.undo();
    expect((await ctx.store.get('memo', (await ctx.store.list('memo'))[0]!.id))!.body).toBe('Maria Silva is the gardener.');
    expect((await ctx.store.get('document', doc.id))!.name).toBe('Interview — Maria Silva');
  });
});
