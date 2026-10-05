// English is the source of truth. Each namespace lives in its own file so features can be
// translated independently; pt and es files are typed against these, so a missing key fails tsc.
import { common } from './common';
import { app } from './app';
import { onboarding } from './onboarding';
import { projects } from './projects';
import { workbench } from './workbench';
import { documents } from './documents';
import { codes } from './codes';
import { segments } from './segments';
import { memos } from './memos';
import { cases } from './cases';
import { analysis } from './analysis';
import { agreement } from './agreement';
import { importer } from './importer';
import { exporter } from './exporter';
import { settings } from './settings';
import { pseudonyms } from './pseudonyms';
import { log } from './log';
import { help } from './help';

export const en = {
  common,
  app,
  onboarding,
  projects,
  workbench,
  documents,
  codes,
  segments,
  memos,
  cases,
  analysis,
  agreement,
  importer,
  exporter,
  settings,
  pseudonyms,
  log,
  help,
};

type DeepStringify<T> = T extends string ? string : { [K in keyof T]: DeepStringify<T[K]> };
export type Messages = DeepStringify<typeof en>;
