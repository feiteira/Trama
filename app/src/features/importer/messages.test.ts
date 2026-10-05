import { describe, expect, it } from 'vitest';
import { ImportError } from '../../core/import';
import { failureMessage, failureOf, isSerious, pageList, warningMessage } from './messages';

describe('failures', () => {
  it('keeps the importer code and detail', () => {
    expect(failureOf(new ImportError('UNSUPPORTED', 'doc'))).toMatchObject({ code: 'UNSUPPORTED', detail: 'doc' });
    expect(failureOf(new Error('boom'))).toEqual({ code: 'ERROR', detail: null, message: 'boom' });
  });

  it('says what to do with files Trama cannot read', () => {
    expect(failureMessage({ code: 'UNSUPPORTED', detail: 'doc' })).toEqual({ key: 'importer.errors.unsupportedDoc' });
    expect(failureMessage({ code: 'UNSUPPORTED', detail: 'media' })).toEqual({ key: 'importer.errors.unsupportedMedia' });
    expect(failureMessage({ code: 'UNSUPPORTED', detail: 'zip' })).toEqual({ key: 'importer.errors.unsupported' });
    expect(failureMessage({ code: 'UNSUPPORTED', detail: null })).toEqual({ key: 'importer.errors.unsupported' });
    expect(failureMessage({ code: 'EMPTY', detail: null })).toEqual({ key: 'importer.errors.empty' });
    expect(failureMessage({ code: 'DAMAGED', detail: 'pdf' })).toEqual({ key: 'importer.errors.damaged' });
    expect(failureMessage({ code: 'ENCRYPTED_PDF', detail: 'password' })).toEqual({ key: 'importer.errors.pdfPassword' });
    expect(failureMessage({ code: 'ENCRYPTED_PDF', detail: 'incorrect-password' })).toEqual({ key: 'importer.errors.pdfWrongPassword' });
    expect(failureMessage({ code: 'ERROR', detail: null, message: 'x' })).toEqual({ key: 'importer.errors.other', vars: { message: 'x' } });
  });
});

describe('warnings', () => {
  it('lists image pages in the interface language', () => {
    expect(warningMessage('pdf.imagePages:2,5', 'en')).toEqual({ plural: 'importer.warnings.pdfImagePages', n: 2, vars: { pages: '2 and 5' } });
    expect(warningMessage('pdf.imagePages:3', 'pt-PT')).toMatchObject({ n: 1, vars: { pages: '3' } });
    expect(pageList('1,2,3', 'es-ES')).toBe('1, 2 y 3');
    expect(pageList('1,2,3,4,5,6,7,8,9', 'en')).toBe('1, 2, 3, 4, 5, 6, 7…');
  });

  it('counts skipped things and falls back for unknown codes', () => {
    expect(warningMessage('doc.imagesSkipped:4', 'en')).toEqual({ plural: 'importer.warnings.imagesSkipped', n: 4 });
    expect(warningMessage('text.legacyEncoding', 'en')).toEqual({ key: 'importer.warnings.legacyEncoding' });
    expect(warningMessage('rtf.codePage:932', 'en')).toEqual({ key: 'importer.warnings.rtfCodePage', vars: { page: '932' } });
    expect(warningMessage('new.thing', 'en')).toEqual({ key: 'importer.warnings.other', vars: { code: 'new.thing' } });
    expect(isSerious('pdf.noText')).toBe(true);
    expect(isSerious('doc.commentsSkipped:1')).toBe(false);
  });
});
