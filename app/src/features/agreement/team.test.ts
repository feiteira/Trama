import { describe, expect, it } from 'vitest';
import { NotTramaFileError, UnlockRequiredError } from '../../core/export/trama';
import { DecryptError } from '../../core/crypto/frames';
import { DataFileError } from '../../services/datafile';
import { copyFileName, fileProblem, PREVIEW_KINDS, previewRows, sameProject } from './team';

describe('merge preview rows', () => {
  it('lists documents, codes, codings, memos and cases, and sums the rest as other', () => {
    const rows = previewRows({ byKind: { coding: { added: 2, updated: 1 }, coder: { added: 1, updated: 0 }, log: { added: 3, updated: 0 }, memo: { added: 0, updated: 4 } } });
    expect(rows.coding).toEqual({ added: 2, updated: 1 });
    expect(rows.memo).toEqual({ added: 0, updated: 4 });
    expect(rows.document).toEqual({ added: 0, updated: 0 });
    expect(rows.other).toEqual({ added: 4, updated: 0 });
    expect(Object.keys(rows)).toEqual([...PREVIEW_KINDS, 'other']);
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
    // A copy saved by a newer Trama is not "damaged": it says to update Trama.
    expect(fileProblem(new NotTramaFileError('newer-version', '2'))).toBe('newer');
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
