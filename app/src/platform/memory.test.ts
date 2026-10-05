import { describe, expect, it } from 'vitest';
import { utf8 } from '../core/bytes';
import { createMemoryPlatform } from './memory';
import { PlatformError } from './types';

const key = (n: number) => new Uint8Array(32).fill(n);

describe('memory platform', () => {
  it('keeps one database per project, which only its own key opens', async () => {
    const p = createMemoryPlatform();
    await expect(p.projects.open('a', key(1), false)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const db = await p.projects.open('a', key(1), true);
    await db.script('CREATE TABLE t (x TEXT)');
    await db.exec('INSERT INTO t VALUES (?)', ['olá']);
    await db.close();
    await expect(db.query('SELECT 1')).rejects.toMatchObject({ code: 'NOT_OPEN' }); // a closed handle
    await expect(p.projects.open('a', key(2), false)).rejects.toMatchObject({ code: 'WRONG_KEY' });
    await expect(p.projects.open('a', key(2), true)).rejects.toMatchObject({ code: 'WRONG_KEY' });
    const again = await p.projects.open('a', key(1), false);
    expect(await again.query('SELECT x FROM t')).toEqual([{ x: 'olá' }]);
    expect(await p.projects.list()).toEqual(['a']);
    expect(await p.projects.exists('a')).toBe(true);
    await expect(p.projects.open('../escape', key(1), true)).rejects.toBeInstanceOf(PlatformError);
  });

  it('keeps blobs per project and removes them with the project', async () => {
    const p = createMemoryPlatform();
    await p.projects.open('a', key(1), true);
    await p.blobs.write('a', 'b1', utf8('one'));
    await p.blobs.write('b', 'b1', utf8('other'));
    expect(await p.blobs.read('a', 'b1')).toEqual(utf8('one'));
    expect(await p.blobs.read('b', 'b1')).toEqual(utf8('other'));
    await expect(p.blobs.read('a', 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(p.blobs.write('a', 'Bad/Id', utf8('x'))).rejects.toMatchObject({ code: 'INVALID' });
    const handle = await p.projects.open('a', key(1), false);
    await p.projects.erase('a');
    await expect(p.blobs.read('a', 'b1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(handle.query('SELECT 1')).rejects.toMatchObject({ code: 'NOT_OPEN' });
    expect(await p.projects.list()).toEqual([]);
  });

  it('erases everything but the device preferences', async () => {
    const p = createMemoryPlatform();
    await p.prefs.set({ locale: 'pt' });
    await p.keyring.write('{}');
    await p.libraryFile.write('x');
    await p.projects.open('a', key(1), true);
    await p.eraseAll();
    expect(await p.keyring.read()).toBeNull();
    expect(await p.libraryFile.read()).toBeNull();
    expect(await p.projects.list()).toEqual([]);
    expect(await p.prefs.get()).toEqual({ locale: 'pt' });
  });

  it('models files, folders and dialogs', async () => {
    const p = createMemoryPlatform({ dialogAnswers: ['/picked', ['/a.txt', '/b.txt'], null], defaultFolder: '/default' });
    expect(await p.dialogs.pickFolder('x')).toBe('/picked');
    expect(await p.files.exists('/picked')).toBe(true);
    expect(await p.files.list('/picked', false)).toEqual([]);
    expect(await p.dialogs.pickFiles('x', [], true)).toEqual(['/a.txt', '/b.txt']);
    expect(await p.dialogs.saveFile('x', 'f.trama', [])).toBeNull(); // cancelled
    expect(await p.dialogs.saveFile('x', 'f.trama', [])).toBe('/demo/exports/f.trama');
    expect(await p.dialogs.pickFolder('x')).toBe('/default');
    await p.files.write('/d/sub/f.txt', utf8('x'));
    expect((await p.files.list('/d', false)).map((e) => [e.name, e.is_dir])).toEqual([['sub', true]]);
    expect((await p.files.list('/d', true)).map((e) => e.name)).toEqual(['sub', 'f.txt']);
    await p.files.remove('/d/sub/f.txt');
    expect(await p.files.exists('/d/sub')).toBe(true); // the folder stays
    await expect(p.files.list('/nowhere', false)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(p.files.join('/d/', 'x')).toBe('/d/x');
  });

  it('reports itself as the web build, with a version', async () => {
    const info = await createMemoryPlatform({ example: true }).info();
    expect(info).toMatchObject({ os: 'web', example: true });
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
