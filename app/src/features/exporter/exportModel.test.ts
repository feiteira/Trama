import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAMA, exportFileName, extensionOf, tramaExportOptions, tramaProblem } from './exportModel';

describe('trama options', () => {
  it('needs nothing without protection, and the key stays out by default', () => {
    expect(tramaProblem(DEFAULT_TRAMA)).toBeNull();
    expect(tramaExportOptions(DEFAULT_TRAMA)).toEqual({ includePseudonyms: false });
  });

  it('asks for a password typed twice the same way', () => {
    expect(tramaProblem({ ...DEFAULT_TRAMA, protect: true })).toBe('passwordRequired');
    expect(tramaProblem({ ...DEFAULT_TRAMA, protect: true, password: 'abc', confirm: 'abd' })).toBe('mismatch');
    // The same text in two Unicode forms is the same password.
    expect(tramaProblem({ ...DEFAULT_TRAMA, protect: true, password: 'mãe', confirm: 'mãe' })).toBeNull();
    expect(tramaExportOptions({ protect: true, password: 'pw', confirm: 'pw', includePseudonyms: true })).toEqual({ password: 'pw', includePseudonyms: true });
    // A password left in the fields while protection is off is not used.
    expect(tramaExportOptions({ protect: false, password: 'pw', confirm: 'pw', includePseudonyms: false })).toEqual({ includePseudonyms: false });
  });
});

describe('file names', () => {
  it('names files after the project, what they are and the date, safely', () => {
    const now = new Date(2026, 9, 5, 10);
    expect(exportFileName('Community gardens', null, 'trama', now)).toBe('Community gardens 2026-10-05.trama');
    expect(exportFileName('Jardins: estudo/piloto', 'livro de códigos', 'qdc', now)).toBe('Jardins_ estudo_piloto - livro de códigos 2026-10-05.qdc');
    expect(exportFileName('   ', null, 'qdpx', now)).toBe('Trama 2026-10-05.qdpx');
  });

  it('picks the extension', () => {
    expect(extensionOf('trama')).toBe('trama');
    expect(extensionOf('qdpx')).toBe('qdpx');
    expect(extensionOf('codebook', 'csv')).toBe('csv');
    expect(extensionOf('report', 'html')).toBe('html');
  });
});
