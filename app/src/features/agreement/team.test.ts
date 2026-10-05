import { describe, expect, it } from 'vitest';
import type { BundleRecord } from '../../core/export/bundle';
import { NotTramaFileError, UnlockRequiredError } from '../../core/export/trama';
import { DecryptError } from '../../core/crypto/frames';
import { DataFileError } from '../../services/datafile';
import { makeTestProject } from '../../services/testing';
import { classifyMerge, copyFileName, fileProblem, localStamps, previewMerge, sameProject } from './team';

const base = (id: string, hlc: string, deleted = false) => ({ id, created_at: '2026-01-01T00:00:00Z', updated_at_hlc: hlc, deleted });

describe('merge preview', () => {
  it('counts new, newer and unchanged records the way a merge decides', () => {
    const local = new Map([
      [
        'coding',
        new Map([
          ['c1', 'h5'],
          ['c2', 'h5'],
        ]),
      ],
      ['coder', new Map([['ana', 'h1']])],
    ]) as Parameters<typeof classifyMerge>[2];
    const records = [
      { kind: 'coder', record: { ...base('ana', 'h1'), name: 'Ana', color: '#000000' } },
      { kind: 'coder', record: { ...base('rui', 'h2'), name: 'Rui', color: '#b5179e' } },
      { kind: 'coder', record: { ...base('gone', 'h2', true), name: '', color: '#000000' } },
      { kind: 'coding', record: { ...base('c1', 'h9') } },
      { kind: 'coding', record: { ...base('c2', 'h1') } },
      { kind: 'coding', record: { ...base('c3', 'h1') } },
      { kind: 'memo', record: { ...base('m1', 'h1') } },
      { kind: 'log', record: { ...base('l1', 'h1') } },
    ] as unknown as BundleRecord[];
    const p = classifyMerge('Gardens', records, local);
    expect(p).toMatchObject({ projectName: 'Gardens', added: 5, updated: 1, unchanged: 2 });
    expect(p.byKind.coding).toEqual({ added: 1, updated: 1 });
    expect(p.byKind.memo).toEqual({ added: 1, updated: 0 });
    // Coders and the audit trail are "other"; a record arriving deleted shows nowhere.
    expect(p.byKind.other).toEqual({ added: 2, updated: 0 });
    expect(p.newCoders).toEqual([{ id: 'rui', name: 'Rui', color: '#b5179e' }]);
  });

  it('reads the stamps of the project, deleted records included', async () => {
    const project = await makeTestProject();
    const code = await project.store.put('code', {
      name: 'Trust',
      parent_id: null,
      color: '#e4572e',
      description: '',
      inclusion: '',
      exclusion: '',
      example: '',
      order: 1,
      codable: true,
      shortcut: null,
    });
    await project.store.remove('code', [code.id]);
    const stamps = await localStamps(project.store);
    expect(stamps.get('code')?.has(code.id)).toBe(true);
    expect(stamps.get('coder')?.get(project.me.id)).toBe(project.me.updated_at_hlc);
    const preview = await previewMerge(project.store, {
      project: { id: project.id, name: 'Copy', description: '', origin: null },
      records: [{ kind: 'coder', record: project.me }],
      blobs: new Map(),
      warnings: [],
    });
    expect(preview).toMatchObject({ added: 0, updated: 0, unchanged: 1, newCoders: [] });
  });

  it('accepts only copies of the same project', () => {
    expect(sameProject({ project: { id: 'p1', name: '', description: '', origin: null } }, 'p1')).toBe(true);
    expect(sameProject({ project: { id: 'p2', name: '', description: '', origin: null } }, 'p1')).toBe(false);
    expect(sameProject({ project: { id: null, name: '', description: '', origin: null } }, 'p1')).toBe(false);
  });
});

describe('file problems', () => {
  it('names why a file cannot be merged', () => {
    expect(fileProblem(new DataFileError('DIFFERENT_PROJECT', 'x'))).toBe('differentProject');
    expect(fileProblem(new NotTramaFileError('not-zip'))).toBe('notTrama');
    expect(fileProblem(new DecryptError())).toBe('wrongPassword');
    expect(fileProblem(new UnlockRequiredError('library-key'))).toBe('backup');
    expect(fileProblem(new Error('disk'))).toBe('unknown');
  });

  it('makes safe file names for copies', () => {
    expect(copyFileName('Gardens: wave 2', 'Rui')).toBe('Gardens wave 2 - Rui.trama');
    expect(copyFileName('a/b', '')).toBe('a b.trama');
    expect(copyFileName('', '')).toBe('project.trama');
  });
});
