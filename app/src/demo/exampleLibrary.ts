import type { KdfParams } from '../core/crypto/kdf';
import type { UiLocale } from '../core/i18n/languages';
import type { Platform } from '../platform/types';
import { EXAMPLE_KDF, EXAMPLE_PASSPHRASE, EXAMPLE_RECOVERY_PHRASE } from './exampleConstants';
import { Library } from '../services/library';
import type { Project } from '../services/project';
import { exampleCoderNames, exampleProjectInfo, seedExampleProject } from './exampleProject';

// The example library: fictional, made afresh each time, opened with a passphrase everyone
// knows. Used by the browser demo, by "Try the example project" on the welcome screen (in a
// memory platform, so the researcher's own library is never touched) and by the desktop app's
// `--example` mode.

export { EXAMPLE_KDF, EXAMPLE_PASSPHRASE, EXAMPLE_RECOVERY_PHRASE } from './exampleConstants';

export interface ExampleLibrary {
  library: Library;
  project: Project;
}

/** Creates the example library on an empty platform, with the example project open. */
export async function createExampleLibrary(platform: Platform, opts: { locale: UiLocale; coderName?: string; params?: KdfParams; now?: () => Date }): Promise<ExampleLibrary> {
  const library = await Library.create(
    platform,
    { passphrase: EXAMPLE_PASSPHRASE, recoveryPhrase: EXAMPLE_RECOVERY_PHRASE },
    { params: opts.params ?? EXAMPLE_KDF, now: opts.now },
  );
  try {
    const project = await addExampleProject(library, opts.locale, opts.coderName);
    return { library, project };
  } catch (e) {
    await library.lock();
    throw e;
  }
}

/** Adds the example project to a library (and opens it). Removed again if seeding fails. */
export async function addExampleProject(library: Library, locale: UiLocale, coderName?: string): Promise<Project> {
  const info = exampleProjectInfo(locale);
  const project = await library.createProject({
    name: info.name,
    description: info.description,
    // The example's codings are signed by `me`: the researcher's own name when known, else
    // the fictional researcher of the study.
    coderName: coderName?.trim() || exampleCoderNames(locale).researcher,
  });
  try {
    await seedExampleProject(project, locale);
  } catch (e) {
    await library.deleteProject(project.id).catch(() => undefined);
    throw e;
  }
  return project;
}
