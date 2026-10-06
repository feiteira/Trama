import { describe, expect, it } from 'vitest';
import { NotTramaFileError } from '../core/export/trama';
import { catalogs } from '../core/i18n/catalogs';
import { UI_LOCALES } from '../core/i18n/languages';
import { translate } from '../core/i18n/translate';
import { SCHEMA_VERSION } from '../core/store/schema';
import { NewerSchemaError, Store } from '../core/store/store';
import { PlatformError } from '../platform/types';
import { SqlJsDb } from '../platform/sqljs';
import { problemKey, problemOf } from './problems';

describe('problems said in words', () => {
  it('a project saved by a newer Trama is a NewerSchemaError, said as such', async () => {
    const db = await SqlJsDb.create();
    await Store.open(db);
    await db.exec("UPDATE meta SET value = ? WHERE key = 'schema_version'", [String(SCHEMA_VERSION + 1)]);
    const e = await Store.open(db).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NewerSchemaError);
    expect(problemOf(e)).toBe('newerProject');
    expect(translate(catalogs.pt, catalogs.en, problemKey(e)!)).toBe('Este projeto foi guardado por uma versão mais recente do Trama. Atualize o Trama para o abrir.');
  });

  it('recognises a newer file, a full disk, a folder it may not write to, a missing folder and a wrong key', () => {
    expect(problemOf(new NotTramaFileError('newer-version', '2'))).toBe('newerFile');
    expect(problemOf(new NotTramaFileError('not-zip'))).toBeNull();
    // What the Rust shell sends for ENOSPC, and SQLite's own words.
    expect(problemOf(new PlatformError('IO_ERROR', 'file error: No space left on device (os error 28)'))).toBe('diskFull');
    expect(problemOf(new PlatformError('IO_ERROR', 'database error: database or disk is full'))).toBe('diskFull');
    expect(problemOf(new PlatformError('IO_ERROR', 'There is not enough space on the disk. (os error 112)'))).toBe('diskFull');
    expect(problemOf(new PlatformError('IO_ERROR', 'file error: Permission denied (os error 13)'))).toBe('permission');
    expect(problemOf(new PlatformError('PERMISSION_DENIED', 'nope'))).toBe('permission');
    expect(problemOf(new PlatformError('NOT_FOUND', 'gone'))).toBe('notFound');
    expect(problemOf(new PlatformError('WRONG_KEY', 'file is not a database'))).toBe('wrongKey');
    expect(problemOf(new Error('something else (os error 113)'))).toBeNull();
    expect(problemOf('nothing')).toBeNull();
  });

  it('every sentence exists in every language', () => {
    for (const locale of UI_LOCALES) {
      for (const p of ['newerProject', 'newerFile', 'diskFull', 'permission', 'notFound', 'wrongKey'] as const) {
        const text = translate(catalogs[locale], catalogs.en, `common.problems.${p}`);
        expect(text.length).toBeGreaterThan(20);
        if (locale !== 'en') expect(text).not.toBe(translate(catalogs.en, catalogs.en, `common.problems.${p}`));
      }
    }
  });
});
