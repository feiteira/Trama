import { describe, expect, it } from 'vitest';
import { SqlJsDb } from '../../platform/sqljs';
import { formatHlc, parseHlc } from '../hlc';
import type { Coding, Draft, Kind } from '../model/types';
import { ValidationError } from '../model/validate';
import { SCHEMA_VERSION } from './schema';
import { Store } from './store';

/** A clock the test moves by hand. */
function clock(start = '2026-10-05T12:00:00Z') {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => void (t += ms),
    set: (iso: string) => void (t = new Date(iso).getTime()),
  };
}

const coder = (name = 'Ana'): Draft<'coder'> => ({ name, color: '#3a6ea5' });
const code = (name: string, parent_id: string | null = null, order = 1): Draft<'code'> => ({
  name, parent_id, color: '#e4572e', description: '', inclusion: '', exclusion: '', example: '', order, codable: true, shortcut: null,
});
const doc = (name: string, order = 1): Draft<'document'> => ({
  name, kind: 'text', group_ids: [], case_id: null, source: null, original: null, media: null, chars: 0, order, color: null,
});
const coding = (document_id: string, code_id: string, coder_id: string, start: number, end: number): Draft<'coding'> => ({
  document_id, code_id, coder_id, start, end, text: 'x', comment: '',
});

async function open(c = clock()) {
  const db = await SqlJsDb.create();
  return { db, store: await Store.open(db, { now: c.now }), clock: c };
}

describe('Store basics', () => {
  it('creates, reads, lists and counts records of the Trama kinds', async () => {
    const { store } = await open();
    const ana = await store.put('coder', coder());
    expect(ana.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ana.created_at).toBe('2026-10-05T12:00:00.000Z');
    expect(ana.deleted).toBe(false);
    expect(await store.get('coder', ana.id)).toEqual(ana);
    expect(await store.get('coder', 'missing')).toBeNull();

    const parent = await store.put('code', code('Confiança', null, 2));
    await store.put('code', code('Família', parent.id, 1));
    await store.put('code', code('Trabalho', parent.id, 0.5));
    const kids = await store.list('code', { where: 'parent_id = ?', params: [parent.id], order: 'sort' });
    expect(kids.map((k) => k.name)).toEqual(['Trabalho', 'Família']);
    expect(await store.count('code')).toBe(3);
    expect(await store.count('code', 'parent_id IS NULL')).toBe(1);
    expect(await store.list('code', { limit: 2 })).toHaveLength(2);
  });

  it('keeps Unicode intact, including astral characters and combining marks', async () => {
    const { store } = await open();
    const d = await store.put('document', doc('Entrevista — São João 🇵🇹'));
    const t = await store.put('doctext', { id: d.id, text: 'Olá 👋🏽 mundo\nÉ assim', sync: [] });
    expect((await store.get('document', d.id))!.name).toBe('Entrevista — São João 🇵🇹');
    expect((await store.get('doctext', t.id))!.text).toBe('Olá 👋🏽 mundo\nÉ assim');
  });

  it('validates every write and tidies what it can', async () => {
    const { store } = await open();
    await expect(store.put('coder', { name: '   ', color: '#3a6ea5' })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.put('coder', { name: 'Ana', color: 'red' })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.put('doctext', { text: 'a\r\nb', sync: [] })).rejects.toBeInstanceOf(ValidationError);
    const c = await store.put('coder', { name: '  Ana   Sousa ', color: '#3A6EA5' });
    expect(c.name).toBe('Ana Sousa');
    expect(c.color).toBe('#3a6ea5');
  });

  it('writes nothing of a batch when one record is invalid', async () => {
    const { store } = await open();
    await expect(
      store.putMany([
        { kind: 'coder', draft: coder('Ana') },
        { kind: 'coder', draft: { name: '', color: '#3a6ea5' } },
      ]),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await store.count('coder')).toBe(0);
  });

  it('updates a record, keeping its creation time and stamping it newer', async () => {
    const { store, clock: c } = await open();
    const d = await store.put('document', doc('Interview 1'));
    c.advance(60_000);
    const u = await store.update('document', d.id, { name: 'Interview 1 (Inês)' });
    expect(u.name).toBe('Interview 1 (Inês)');
    expect(u.created_at).toBe(d.created_at);
    expect(u.updated_at_hlc > d.updated_at_hlc).toBe(true);
    await expect(store.update('document', 'missing', { name: 'x' })).rejects.toThrow(/not found/);
  });

  it('notifies subscribers of the kinds that changed', async () => {
    const { store } = await open();
    const seen: Kind[][] = [];
    const off = store.subscribe((kinds) => seen.push([...kinds]));
    await store.putMany([
      { kind: 'coder', draft: coder() },
      { kind: 'code', draft: code('A') },
    ]);
    off();
    await store.put('coder', coder('Rui'));
    expect(seen).toEqual([['coder', 'code']]);
  });

  it('summarises a column without reading record data', async () => {
    const { store } = await open();
    const ana = await store.put('coder', coder());
    const d = await store.put('document', doc('D'));
    const a = await store.put('code', code('A'));
    const b = await store.put('code', code('B'));
    await store.putMany([
      { kind: 'coding', draft: coding(d.id, a.id, ana.id, 0, 5) },
      { kind: 'coding', draft: coding(d.id, a.id, ana.id, 10, 20) },
      { kind: 'coding', draft: coding(d.id, b.id, ana.id, 3, 4) },
    ]);
    const s = await store.summarise('coding', 'code_id', 'start');
    const byCode = Object.fromEntries(s.map((r) => [r.key, r]));
    expect(byCode[a.id]).toMatchObject({ count: 2, max: 10 });
    expect(byCode[b.id]).toMatchObject({ count: 1, max: 3 });
    await expect(store.summarise('coding', 'nope', 'start')).rejects.toThrow(/no indexed column/);
  });
});

describe('deleting and restoring', () => {
  it('leaves tombstones that lists skip, and restores them validated', async () => {
    const { store, clock: c } = await open();
    const a = await store.put('code', code('A'));
    const b = await store.put('code', code('B'));
    c.advance(1000);
    expect(await store.remove('code', [a.id, b.id, 'missing'], { batch: 'batch-1' })).toBe(2);
    expect(await store.remove('code', [a.id])).toBe(0); // already deleted
    expect(await store.list('code')).toEqual([]);
    expect(await store.count('code')).toBe(0);
    const all = await store.list('code', { includeDeleted: true });
    expect(all.map((r) => r.deleted)).toEqual([true, true]);
    expect(all.every((r) => (r as { deleted_batch?: string }).deleted_batch === 'batch-1')).toBe(true);

    const deleted = await store.listDeleted('code', c.now().getTime() - 5000);
    expect(deleted).toHaveLength(2);
    c.advance(1000);
    const restored = await store.restore('code', [a.id, 'missing']);
    expect(restored.map((r) => r.id)).toEqual([a.id]);
    const back = (await store.get('code', a.id))!;
    expect(back.deleted).toBe(false);
    expect((back as { deleted_batch?: string }).deleted_batch).toBeUndefined();
    expect(back.created_at).toBe(a.created_at);
    expect(await store.restore('code', [a.id])).toEqual([]); // already live
  });

  it('scrubs deleted content for good, and never restores a scrubbed record', async () => {
    const { store } = await open();
    const d = await store.put('document', doc('Secret name'));
    const t = await store.put('doctext', { id: d.id, text: 'Maria said…', sync: [] });
    expect(await store.scrub('doctext', [t.id], () => ({ text: '', sync: [] }))).toBe(0); // live: untouched
    await store.remove('doctext', [t.id]);
    expect(await store.scrub('doctext', [t.id], () => ({ text: '', sync: [] }))).toBe(1);
    const scrubbed = (await store.get('doctext', t.id))!;
    expect(scrubbed.text).toBe('');
    expect(scrubbed.deleted).toBe(true);
    expect(await store.restore('doctext', [t.id])).toEqual([]);
    expect(await store.listDeleted('doctext', 0)).toEqual([]);
  });
});

describe('merging records from elsewhere', () => {
  it('keeps the newer version of each record (last writer wins by HLC)', async () => {
    const mine = await open(clock('2026-10-05T12:00:00Z'));
    const theirs = await open(clock('2026-10-05T12:00:00Z'));
    const shared = await mine.store.put('code', code('Trust'));
    // The teammate's copy starts with the same record.
    await theirs.store.merge([{ kind: 'code', record: shared }]);

    mine.clock.advance(1000);
    await mine.store.update('code', shared.id, { description: 'mine, older' });
    theirs.clock.advance(5000);
    const theirEdit = await theirs.store.update('code', shared.id, { description: 'theirs, newer' });
    const theirNew = await theirs.store.put('code', code('Hope'));

    const written = await mine.store.merge([
      { kind: 'code', record: theirEdit },
      { kind: 'code', record: theirNew },
    ]);
    expect(written).toBe(2);
    expect((await mine.store.get('code', shared.id))!.description).toBe('theirs, newer');
    expect((await mine.store.get('code', theirNew.id))!.name).toBe('Hope');

    // Merging the same again, or an older version, changes nothing.
    expect(await mine.store.merge([{ kind: 'code', record: theirEdit }])).toBe(0);
    expect(await mine.store.merge([{ kind: 'code', record: shared }])).toBe(0);
  });

  it('carries deletes both ways, and a later edit wins over an earlier delete', async () => {
    const a = await open(clock('2026-10-05T12:00:00Z'));
    const b = await open(clock('2026-10-05T12:00:00Z'));
    const rec = await a.store.put('memo', { title: 'Idea', body: 'x', target: { kind: 'project', id: null }, coder_id: null, color: null });
    await b.store.merge([{ kind: 'memo', record: rec }]);
    a.clock.advance(1000);
    await a.store.remove('memo', [rec.id]);
    b.clock.advance(2000);
    const edited = await b.store.update('memo', rec.id, { body: 'y' });
    await a.store.merge([{ kind: 'memo', record: edited }]);
    expect((await a.store.get('memo', rec.id))!).toMatchObject({ deleted: false, body: 'y' });

    b.clock.advance(5000);
    await b.store.remove('memo', [rec.id]);
    const tomb = (await b.store.get('memo', rec.id))!;
    await a.store.merge([{ kind: 'memo', record: tomb }]);
    expect((await a.store.get('memo', rec.id))!.deleted).toBe(true);
  });

  it('never issues a stamp older than one it merged (a teammate whose clock runs ahead)', async () => {
    const mine = await open(clock('2026-10-05T12:00:00Z'));
    const ahead = await open(clock('2027-01-01T00:00:00Z'));
    const future = await ahead.store.put('coder', coder('Rui'));
    await mine.store.merge([{ kind: 'coder', record: future }]);
    const next = await mine.store.put('coder', coder('Ana'));
    expect(next.updated_at_hlc > future.updated_at_hlc).toBe(true);
    // An edit made here after the merge must win over the merged version.
    const edited = await mine.store.update('coder', future.id, { name: 'Rui S.' });
    expect(edited.updated_at_hlc > future.updated_at_hlc).toBe(true);
  });

  it('ignores unknown kinds and writes large merges in chunks', async () => {
    const src = await open();
    const ana = await src.store.put('coder', coder());
    const d = await src.store.put('document', doc('D'));
    const k = await src.store.put('code', code('K'));
    const many: Coding[] = [];
    for (let i = 0; i < 1234; i++) many.push((await src.store.put('coding', coding(d.id, k.id, ana.id, i, i + 1))) as Coding);
    const dst = await open();
    const n = await dst.store.merge([
      ...many.map((record) => ({ kind: 'coding' as const, record })),
      { kind: 'nonsense' as Kind, record: ana },
    ]);
    expect(n).toBe(1234);
    expect(await dst.store.count('coding')).toBe(1234);
  });
});

describe('clock and metadata', () => {
  it('orders stamps by write, also within one millisecond and when the clock goes back', async () => {
    const { store, clock: c } = await open();
    const stamps: string[] = [];
    for (let i = 0; i < 5; i++) stamps.push((await store.put('coder', coder(`C${i}`))).updated_at_hlc);
    c.set('2020-01-01T00:00:00Z'); // the computer's clock jumps back
    stamps.push((await store.put('coder', coder('Late'))).updated_at_hlc);
    expect([...stamps].sort()).toEqual(stamps);
    expect(new Set(stamps).size).toBe(stamps.length);
    expect(await store.latestHlc()).toBe(stamps[stamps.length - 1]);
  });

  it('resumes after the newest stored stamp when reopened', async () => {
    const c = clock('2026-10-05T12:00:00Z');
    const db = await SqlJsDb.create();
    const s1 = await Store.open(db, { now: c.now });
    const last = await s1.put('coder', coder());
    c.set('2026-01-01T00:00:00Z');
    const s2 = await Store.open(db, { now: c.now });
    expect(s2.projectId).toBe(s1.projectId);
    expect(s2.hlc.device).toBe(s1.hlc.device);
    const next = await s2.put('coder', coder('B'));
    expect(next.updated_at_hlc > last.updated_at_hlc).toBe(true);
  });

  it('has no stamp while empty', async () => {
    const { store } = await open();
    expect(await store.latestHlc()).toBeNull();
  });

  it('stores device-local metadata outside the records', async () => {
    const { store } = await open();
    expect(await store.getMeta('me')).toBeNull();
    await store.setMeta('me', 'coder-1');
    await store.setMeta('me', 'coder-2');
    expect(await store.getMeta('me')).toBe('coder-2');
    await store.deleteMeta('me');
    expect(await store.getMeta('me')).toBeNull();
    expect(await store.getMeta('schema_version')).toBe(String(SCHEMA_VERSION));
    expect(await store.getMeta('project_id')).toBe(store.projectId);
  });

  it('keeps a project id written before it opened (the library chooses it)', async () => {
    const db = await SqlJsDb.create();
    await db.script('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    await db.exec("INSERT INTO meta (key, value) VALUES ('project_id', 'chosen-id')");
    expect((await Store.open(db)).projectId).toBe('chosen-id');
  });

  it('refuses a project saved by a newer version of Trama', async () => {
    const db = await SqlJsDb.create();
    await Store.open(db);
    await db.exec("UPDATE meta SET value = ? WHERE key = 'schema_version'", [String(SCHEMA_VERSION + 1)]);
    await expect(Store.open(db)).rejects.toThrow(/newer version of Trama/);
  });

  it('lists every record of every kind, tombstones included, for export', async () => {
    const { store } = await open();
    const a = await store.put('coder', coder());
    const k = await store.put('code', code('K'));
    await store.remove('code', [k.id]);
    await store.put('setting', { id: 'project.name', value: 'Estudo' });
    const all = [];
    for await (const r of store.all()) all.push(r);
    expect(all.map((r) => `${r.kind}:${r.record.deleted}`).sort()).toEqual(['code:true', 'coder:false', 'setting:false']);
    expect(all.find((r) => r.kind === 'coder')!.record.id).toBe(a.id);
  });

  it('writes stamps in the documented format', async () => {
    const { store } = await open();
    const r = await store.put('coder', coder());
    const p = parseHlc(r.updated_at_hlc);
    expect(formatHlc(p)).toBe(r.updated_at_hlc);
    expect(p.ms).toBe(new Date('2026-10-05T12:00:00Z').getTime());
  });
});
