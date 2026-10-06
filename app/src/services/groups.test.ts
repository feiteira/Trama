import { describe, expect, it } from 'vitest';
import { PALETTE } from '../core/model/types';
import { createDocument } from './documents';
import { addToGroup, createGroup, deleteGroup, listGroups, recolourGroup, removeFromGroup, renameGroup, reorderGroup } from './groups';
import { listLog } from './log';
import { makeTestProject } from './testing';

async function setup() {
  const ctx = await makeTestProject();
  const d1 = (await createDocument(ctx, { name: 'Entrevista 1', kind: 'text', text: 'a' })).document;
  const d2 = (await createDocument(ctx, { name: 'Entrevista 2', kind: 'text', text: 'b' })).document;
  return { ctx, d1, d2 };
}

describe('groups', () => {
  it('creates, renames, recolours and reorders', async () => {
    const { ctx } = await setup();
    const a = await createGroup(ctx, { name: ' Onda  1 ' });
    const b = await createGroup(ctx, { name: 'Professores' });
    expect(a.group.name).toBe('Onda 1');
    expect(a.group.color).toBe(PALETTE[0]);
    expect(b.group.color).toBe(PALETTE[1]);
    expect((await renameGroup(ctx, a.group.id, 'Wave 1')).group.name).toBe('Wave 1');
    expect((await recolourGroup(ctx, a.group.id, '#29A37A')).group.color).toBe('#29a37a');
    await reorderGroup(ctx, b.group.id, a.group.id);
    expect((await listGroups(ctx)).map((g) => g.name)).toEqual(['Professores', 'Wave 1']);
    await expect(renameGroup(ctx, a.group.id, ' ')).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('adds and removes documents', async () => {
    const { ctx, d1, d2 } = await setup();
    const { group } = await createGroup(ctx, { name: 'Wave 1' });
    const r = await addToGroup(ctx, group.id, [d1.id, d2.id, d1.id]);
    expect(r.changed).toBe(2);
    expect((await addToGroup(ctx, group.id, [d1.id])).changed).toBe(0);
    expect((await ctx.store.get('document', d1.id))!.group_ids).toEqual([group.id]);
    expect((await listLog(ctx, { action: 'group.edit' }))[0]!.summary).toBe('"Entrevista 1", "Entrevista 2" → "Wave 1"');
    const removed = await removeFromGroup(ctx, group.id, [d2.id]);
    expect((await ctx.store.get('document', d2.id))!.group_ids).toEqual([]);
    await removed.undo.undo();
    await r.undo.undo();
    expect((await ctx.store.get('document', d1.id))!.group_ids).toEqual([]);
  });

  it('deletes a group, taking it out of documents; undo puts it back', async () => {
    const { ctx, d1, d2 } = await setup();
    const { group } = await createGroup(ctx, { name: 'Wave 1' });
    const { group: other } = await createGroup(ctx, { name: 'Porto' });
    await addToGroup(ctx, group.id, [d1.id, d2.id]);
    await addToGroup(ctx, other.id, [d1.id]);
    const r = await deleteGroup(ctx, group.id);
    expect(r.documents).toBe(2);
    expect((await ctx.store.get('document', d1.id))!.group_ids).toEqual([other.id]);
    expect((await ctx.store.get('docgroup', group.id))!.deleted).toBe(true);
    await r.undo.undo();
    expect((await ctx.store.get('document', d1.id))!.group_ids).toEqual([group.id, other.id]);
    expect((await ctx.store.get('docgroup', group.id))!.deleted).toBe(false);
  });
});
