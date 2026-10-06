// The audit trail records an export once the file is written: a cancelled save or a full disk
// leaves no "Exported the project" entry behind.
import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase } from '../../core/crypto/keyring';
import { createMemoryPlatform } from '../../platform/memory';
import { PlatformError } from '../../platform/types';
import { exportProjectFile, logProjectExport } from '../../services/datafile';
import { createDocument } from '../../services/documents';
import { Library } from '../../services/library';
import { FAST_KDF } from '../../services/testing';
import { problemOf } from '../../ui/problems';

describe('export audit entries', () => {
  it('builds without logging when asked, and logs after a successful write', async () => {
    const platform = createMemoryPlatform();
    const library = await Library.create(platform, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF });
    const project = await library.createProject({ name: 'Study', coderName: 'Ana' });
    await createDocument(project, { name: 'Interview', kind: 'text', text: 'Some text.' });
    const exports = async () => (await project.store.list('log')).filter((l) => l.action === 'export').length;

    const bytes = await exportProjectFile(project, { includePseudonyms: false, log: false });
    // The write fails as the desktop shell reports a full disk: nothing is logged.
    const full = new PlatformError('IO_ERROR', 'file error: No space left on device (os error 28)');
    const write = async () => {
      throw full;
    };
    await expect(write()).rejects.toBe(full);
    expect(problemOf(full)).toBe('diskFull');
    expect(await exports()).toBe(0);

    await platform.files.write('/tmp/study.trama', bytes);
    await logProjectExport(project, { includePseudonyms: false, password: 'x' });
    const logs = (await project.store.list('log')).filter((l) => l.action === 'export');
    expect(logs.map((l) => l.summary)).toEqual(['.trama (password)']);
    // Callers that do not save the bytes themselves keep the entry as before.
    await exportProjectFile(project, { includePseudonyms: false });
    expect(await exports()).toBe(2);
    await library.lock();
  });
});
