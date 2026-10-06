// What a merge found beyond the counts reaches the researcher: texts changed on both sides (the
// teammate's edit did not come in), moved and removed codings, real names brought back.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase } from '../../core/crypto/keyring';
import { readTramaZip } from '../../core/export/trama';
import type { UiLocale } from '../../core/i18n/languages';
import { createMemoryPlatform } from '../../platform/memory';
import { exportProjectFile, importProjectFile, mergeTeammateCopy, previewMerge } from '../../services/datafile';
import { createDocument, editDocumentText } from '../../services/documents';
import { Library } from '../../services/library';
import type { Project } from '../../services/project';
import { apply, createPseudonym } from '../../services/pseudonyms';
import { FAST_KDF } from '../../services/testing';
import { I18nProvider } from '../../ui/i18n';
import { hasFindings, MergeReport, type MergeFindings } from './MergeReport';

const TEXT = 'Ana: I started in Porto with Rui.\nAna: Trust came later.';

async function twoCopies(prepare?: (p: Project) => Promise<unknown>) {
  let t = new Date('2026-10-05T12:00:00Z').getTime();
  const now = () => new Date(t);
  const advance = () => void (t += 1000);
  const mk = () => Library.create(createMemoryPlatform(), { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF, now });
  const ana = await mk();
  const pa = await ana.createProject({ name: 'Shared', coderName: 'Ana' });
  const { document: doc } = await createDocument(pa, { name: 'Interview 1', kind: 'transcript', text: TEXT });
  await prepare?.(pa);
  advance();
  const rui = await mk();
  const pr = await importProjectFile(rui, await exportProjectFile(pa, { includePseudonyms: false }), { kind: 'none' }, { asCopyOfSameProject: true });
  await pr.setMe((await pr.addCoder('Rui')).id);
  advance();
  return { advance, pa, pr, doc };
}

const copyOf = async (p: Project) => readTramaZip(await exportProjectFile(p, { includePseudonyms: false }));

const html = (findings: MergeFindings, stage: 'preview' | 'done', locale: UiLocale = 'en', actions = false) =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <MergeReport findings={findings} stage={stage} {...(actions ? { onOpenDocument: () => undefined, onPseudonymise: () => undefined } : {})} />
    </I18nProvider>,
  );

describe('MergeReport', () => {
  it('a text corrected on both sides is listed by name in the preview and after merging', async () => {
    const { advance, pa, pr, doc } = await twoCopies();
    await editDocumentText(pa, doc.id, TEXT.replace('Porto', 'Porto city'));
    advance();
    await editDocumentText(pr, doc.id, TEXT.replace('later.', 'later!'));
    const bundle = await copyOf(pr);

    const preview = await previewMerge(pa, bundle);
    expect(preview.textConflicts.map((c) => c.name)).toEqual(['Interview 1']);
    const before = html(preview, 'preview');
    expect(before).toContain('data-testid="merge-report-conflicts"');
    expect(before).toContain('The text of 1 document was changed on both sides');
    expect(before).toContain('Interview 1');
    expect(before).toContain('will not come in');

    const result = await mergeTeammateCopy(pa, bundle);
    expect((await pa.store.get('doctext', doc.id))!.text).not.toContain('later!');
    for (const locale of ['en', 'pt', 'es'] as const) {
      const after = html(result, 'done', locale, true);
      expect(after).toContain('data-testid="merge-report-conflicts"');
      expect(after).toContain('Interview 1');
      expect(after).not.toMatch(/\{\w+\}|agreement\.merge/);
    }
    expect(html(result, 'done', 'pt')).toContain('O texto de 1 documento foi alterado dos dois lados');
  });

  it('names a teammate’s older text brings back are replaced again, and said so', async () => {
    const { pa, pr, doc } = await twoCopies(async (p) => {
      await createPseudonym(p, { original: 'Porto', replacement: 'the city' });
      await apply(p);
    });
    // Rui's copy is pseudonymised; he types the real name back in while correcting the text.
    const his = (await pr.store.get('doctext', doc.id))!.text;
    expect(his).toContain('the city');
    await editDocumentText(pr, doc.id, his.replace('the city', 'Porto'));
    const result = await mergeTeammateCopy(pa, await copyOf(pr));
    expect((await pa.store.get('doctext', doc.id))!.text).not.toContain('Porto');
    expect(result.repseudonymised?.length).toBeGreaterThan(0);
    const out = html(result, 'done', 'en', true);
    expect(out).toContain('data-testid="merge-report-repseudonymised"');
    // What could not be replaced again is a danger notice with a way to the pseudonymisation screen.
    const left = html({ textConflicts: [], originalsFound: [{ documentId: doc.id, name: 'Interview 1' }] }, 'done', 'en', true);
    expect(left).toContain('data-testid="merge-report-originals"');
    expect(left).toContain('Real names are back in 1 document');
    expect(left).toContain('data-testid="merge-report-pseudonymise"');
  });

  it('offers the teammate’s text for a conflict after merging, and lists replaced texts, kept deletions and names replaced again', () => {
    const f: MergeFindings = {
      textConflicts: [{ documentId: 'd1', name: 'Entrevista 7 — Teresa', theirText: 'x', theirRevs: [] }],
      textsReplaced: [{ documentId: 'd2', name: 'Interview 2' }],
      revived: [{ kind: 'code', id: 'c1', name: 'Trust' }],
      repseudonymised: [{ kind: 'text', id: 'd1', field: 'd1', label: 'Entrevista 7 — Teresa' }],
    };
    const done = renderToStaticMarkup(
      <I18nProvider locale="pt">
        <MergeReport findings={f} stage="done" onOpenDocument={() => undefined} onTakeTheirs={() => undefined} />
      </I18nProvider>,
    );
    expect(done).toContain('data-testid="merge-report-take-theirs"');
    expect(done).toContain('Usar o texto do colega');
    expect(done).toContain('O texto do seu colega substituiu o deste projeto em 1 documento');
    expect(done).toContain('1 item eliminado foi mantido');
    expect(done).toContain('voltou a ser substituído');
    // A kept code is named, not offered as a document to open.
    expect(done).toMatch(/<span class="merge-report__doc-name">Trust<\/span>/);
    const taken = renderToStaticMarkup(
      <I18nProvider locale="en">
        <MergeReport findings={f} stage="done" onTakeTheirs={() => undefined} taken={new Set(['d1'])} />
      </I18nProvider>,
    );
    expect(taken).toContain('Their text is used now');
    expect(taken).not.toContain('merge-report-take-theirs');
    // The preview never offers it: nothing has been merged yet.
    expect(html(f, 'preview')).not.toContain('merge-report-take-theirs');
  });

  it('shows moved and removed codings, and nothing at all when there is nothing to report', () => {
    const f: MergeFindings = { textConflicts: [], reanchored: 2, removedCodings: 1, originalsFound: [{ documentId: 'd', name: 'Interview 7' }] };
    const out = html(f, 'done', 'es', true);
    expect(out).toContain('Se han vuelto a colocar 2 segmentos codificados');
    expect(out).toContain('Se ha eliminado 1 segmento codificado');
    expect(out).toContain('Vuelve a haber nombres reales en 1 documento');
    const empty: MergeFindings = { textConflicts: [], reanchored: 0, removedCodings: 0, originalsFound: [] };
    expect(hasFindings(empty)).toBe(false);
    expect(html(empty, 'done')).toBe('');
  });
});
