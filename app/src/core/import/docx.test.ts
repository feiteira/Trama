import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { forgeSize } from '../export/forgeZip.testutil';
import { type MammothLike, docxToText, loadMammoth } from './docx';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/import/${name}`, import.meta.url)));

/** The report fixture with an image added to its body. */
function withImage(): Uint8Array {
  const files = unzipSync(fixture('report.docx'));
  const dec = (n: string) => new TextDecoder().decode(files[n]);
  const drawing =
    '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1" cy="1"/><wp:docPr id="1" name="Foto" descr="uma foto"/>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  files['word/document.xml'] = strToU8(dec('word/document.xml').replace('<w:body>', `<w:body>${drawing}`));
  files['word/_rels/document.xml.rels'] = strToU8(
    dec('word/_rels/document.xml.rels').replace(
      '</Relationships>',
      '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
    ),
  );
  files['[Content_Types].xml'] = strToU8(dec('[Content_Types].xml').replace('<Default Extension="xml"', '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"'));
  files['word/media/image1.png'] = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
  return zipSync(files);
}

describe('docxToText', () => {
  it('reads headings, runs, tabs, breaks, lists, tables and footnotes', async () => {
    const r = await docxToText(fixture('report.docx'));
    expect(r.text).toBe(
      [
        'Relatório de campo',
        'Olá, mundo \u{1f30d} \u{2014} ação & coração.',
        'Antes\tdepois',
        'nova linha',
        '\u{2022} Ponto um',
        '\u{2022} Ponto dois',
        '1. Passo',
        'Nome\tIdade',
        'Ana\t34',
        'Com nota[1] e fim.',
        'Último parágrafo.',
        '[1] Uma nota de rodapé fictícia.',
      ].join('\n'),
    );
    expect(r.warnings).toEqual([]);
  });

  it('keeps transcript-like paragraphs as they are (the dispatcher reads the turns)', async () => {
    const r = await docxToText(fixture('otter.docx'));
    expect(r.text.split('\n').slice(0, 3)).toEqual(['Entrevista 4 \u{2014} Otter', 'Speaker 1  0:01', 'Olá, obrigado por ter vindo.']);
  });

  it('counts images instead of embedding them', async () => {
    const r = await docxToText(withImage());
    expect(r.warnings).toEqual(['doc.imagesSkipped:1']);
    expect(r.text.startsWith('Relatório de campo')).toBe(true);
    expect(r.text).not.toContain('data:');
  });

  it('returns empty text for an empty document', async () => {
    expect((await docxToText(fixture('empty.docx'))).text).toBe('');
  });

  it('reports damaged files', async () => {
    await expect(docxToText(fixture('not-a-zip.docx'))).rejects.toMatchObject({ code: 'DAMAGED', detail: 'docx' });
    await expect(docxToText(zipSync({ 'a.txt': strToU8('x') }))).rejects.toMatchObject({ code: 'DAMAGED' });
    await expect(docxToText(new Uint8Array())).rejects.toMatchObject({ code: 'DAMAGED' });
  });

  it('uses an injected mammoth and gives it both buffer forms', async () => {
    let seen: Record<string, unknown> = {};
    const fake: MammothLike = {
      convertToHtml: (input) => {
        seen = input as Record<string, unknown>;
        return Promise.resolve({ value: '<h1>T</h1><p>a\tb</p>', messages: [] });
      },
      images: { imgElement: () => ({}) },
    };
    expect((await docxToText(new Uint8Array([1, 2, 3]), fake)).text).toBe('T\na\tb');
    expect(seen.arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(seen.buffer).toBe(seen.arrayBuffer);
  });

  it('loads mammoth once', async () => {
    expect(await loadMammoth()).toBe(await loadMammoth());
    expect(typeof (await loadMammoth()).convertToHtml).toBe('function');
  });
});

describe('zip bombs', () => {
  it('refuses a Word file whose parts would inflate to gigabytes, before mammoth sees it', async () => {
    const forged = forgeSize(fixture('empty.docx'), 'word/document.xml', 0xf0000000);
    let called = false;
    const fake: MammothLike = {
      convertToHtml: () => {
        called = true;
        return Promise.resolve({ value: '', messages: [] });
      },
      images: { imgElement: () => ({}) },
    };
    await expect(docxToText(forged, fake)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(called).toBe(false);
  });
});
