import { describe, expect, it } from 'vitest';
import { createMemoryPlatform } from '../platform/memory';
import { Library } from '../services/library';
import { FAST_KDF } from '../services/testing';
import { addExampleProject, createExampleLibrary, EXAMPLE_PASSPHRASE, EXAMPLE_RECOVERY_PHRASE } from './exampleLibrary';
import { exampleCoderNames, exampleProjectInfo } from './exampleProject';

describe('the example library', () => {
  it('is created with the example project open and seeded', async () => {
    const platform = createMemoryPlatform();
    const { library, project } = await createExampleLibrary(platform, { locale: 'pt', params: FAST_KDF });
    expect(library.current?.id).toBe(project.id);
    expect(project.info.name).toBe(exampleProjectInfo('pt').name);
    expect(project.me.name).toBe(exampleCoderNames('pt').researcher);
    expect(await project.store.count('document')).toBeGreaterThan(0);
    expect(await project.store.count('coding')).toBeGreaterThan(0);
    await library.lock();
  });

  it('opens with the known passphrase and recovery phrase', async () => {
    const platform = createMemoryPlatform();
    const { library } = await createExampleLibrary(platform, { locale: 'en', params: FAST_KDF });
    await library.lock();
    const a = await Library.unlock(platform, 'passphrase', EXAMPLE_PASSPHRASE);
    expect(a.projects).toHaveLength(1);
    await a.lock();
    const b = await Library.unlock(platform, 'recovery_phrase', EXAMPLE_RECOVERY_PHRASE);
    await b.lock();
  });

  it('signs the example with the researcher’s own name when given', async () => {
    const platform = createMemoryPlatform();
    const { library, project } = await createExampleLibrary(platform, { locale: 'es', coderName: '  Lucía  ', params: FAST_KDF });
    expect(project.me.name).toBe('Lucía');
    // A second copy can be added beside it: each example is its own project.
    const second = await addExampleProject(library, 'es');
    expect(second.id).not.toBe(project.id);
    expect(library.projects).toHaveLength(2);
    await library.lock();
  });

  it('refuses to make a second example library on the same platform', async () => {
    const platform = createMemoryPlatform();
    const { library } = await createExampleLibrary(platform, { locale: 'en', params: FAST_KDF });
    await library.lock();
    await expect(createExampleLibrary(platform, { locale: 'en', params: FAST_KDF })).rejects.toThrow();
  });
});
