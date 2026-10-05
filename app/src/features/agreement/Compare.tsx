import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Scale, Users } from 'lucide-react';
import { DateTime } from 'luxon';
import { buildDocx, buildHtml, buildXlsx, csvBytes } from '../../core/export/office';
import { utf8 } from '../../core/bytes';
import type { Code, Coding } from '../../core/model/types';
import { buildTree } from '../../core/qda/tree';
import { useProject } from '../../shell/AppState';
import { useLive } from '../../shell/useLive';
import { Button } from '../../ui/components/Button';
import { EmptyState, Notice, Spinner } from '../../ui/components/Feedback';
import type { MenuEntry } from '../../ui/components/Menu';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { Disagreements } from './Disagreements';
import { saveBytes } from './files';
import { codeRows, codeUse, codingsOf, defaultPair, docsBothCoded, fmtInt, type Level, pairDisagreements, runAgreement } from './model';
import { buildReport, buildWorkbook, codeTable, type ReportInput } from './report';
import { CodeTable, DocTable, HowCalculated, SummaryCards } from './Results';
import { PickerDialog, Setup } from './Setup';

interface Selection {
  /** The coder pair the selection belongs to: choosing other coders starts afresh. */
  pair: string;
  docs: string[] | null;
  codes: string[] | null;
}

/** Compare two coders: setup, summary, tables and the disagreements. */
export function Compare({ onTeam, onExportItems }: { onTeam: () => void; onExportItems: (items: MenuEntry[] | null) => void }) {
  const { t, tp, meta, date } = useI18n();
  const project = useProject();
  const toast = useToast();

  const base = useLive(
    async (s) => {
      const [coders, documents, codes, counts] = await Promise.all([
        s.list('coder'),
        s.list('document', { order: 'sort' }),
        s.list('code'),
        s.summarise('coding', 'coder_id', 'start'),
      ]);
      const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
      return {
        coders: coders.sort((a, b) => collator.compare(a.name, b.name)),
        documents,
        codes: buildTree(codes).flatten(),
        counts: new Map(counts.map((c) => [c.key, c.count])),
      };
    },
    [],
    ['coder', 'document', 'code', 'coding'],
  );

  const [chosen, setChosen] = useState<{ a: string | null; b: string | null } | null>(null);
  const coders = base.data?.coders ?? [];
  const valid = (id: string | null | undefined) => !!id && coders.some((c) => c.id === id);
  const fallback = useMemo(
    () => defaultPair(coders, base.data?.counts ?? new Map(), project.needsCoder ? null : project.me.id),
    [coders, base.data?.counts, project],
  );
  const a = chosen && valid(chosen.a) ? chosen.a : fallback.a;
  const b = chosen && valid(chosen.b) && chosen.b !== a ? chosen.b : fallback.b !== a ? fallback.b : (coders.find((c) => c.id !== a)?.id ?? null);
  const pair = `${a}|${b}`;

  const live = useLive(
    (s) => (a && b && a !== b ? s.list('coding', { where: 'coder_id IN (?, ?)', params: [a, b] }) : Promise.resolve([] as Coding[])),
    [a, b],
    ['coding'],
  );
  const codings = live.data;
  const codingsA = useMemo(() => codingsOf(codings ?? [], a), [codings, a]);
  const codingsB = useMemo(() => codingsOf(codings ?? [], b), [codings, b]);
  const codingsById = useMemo(() => new Map((codings ?? []).map((c) => [c.id, c])), [codings]);

  const [sel, setSel] = useState<Selection>({ pair: '', docs: null, codes: null });
  const mySel = sel.pair === pair ? sel : { pair, docs: null, codes: null };
  const [level, setLevel] = useState<Level>('character');
  const [threshold, setThreshold] = useState(0.9);
  const deferredThreshold = useDeferredValue(threshold);
  const [howOpen, setHowOpen] = useState(false);
  const [picking, setPicking] = useState<'docs' | 'codes' | null>(null);
  const [filterDoc, setFilterDoc] = useState<string | null>(null);

  const documents = base.data?.documents ?? [];
  const docById = useMemo(() => new Map(documents.map((d) => [d.id, d])), [documents]);
  const docNames = useMemo(() => new Map(documents.map((d) => [d.id, d.name])), [documents]);
  const flatCodes = base.data?.codes ?? [];
  const codeMap = useMemo(() => new Map<string, Code>(flatCodes.map((c) => [c.code.id, c.code])), [flatCodes]);

  const bothCoded = useMemo(() => docsBothCoded(documents, codingsA, codingsB), [documents, codingsA, codingsB]);
  const docIds = useMemo(() => (mySel.docs ?? bothCoded).filter((id) => docById.has(id)), [mySel.docs, bothCoded, docById]);
  const use = useMemo(
    () =>
      codeUse(
        flatCodes.map((c) => c.code),
        codingsA,
        codingsB,
        docIds,
      ),
    [flatCodes, codingsA, codingsB, docIds],
  );
  const codeIds = useMemo(() => (mySel.codes ?? use.both).filter((id) => codeMap.has(id)), [mySel.codes, use.both, codeMap]);
  const oneOnlyLeftOut = useMemo(() => {
    const chosenCodes = new Set(codeIds);
    return use.oneOnly.filter((id) => !chosenCodes.has(id)).length;
  }, [use.oneOnly, codeIds]);

  const result = useMemo(() => {
    if (!docIds.length || !codeIds.length || !codings) return null;
    const docs = docIds.map((id) => ({ id, length: docById.get(id)?.chars ?? 0 }));
    return runAgreement({ codingsA, codingsB, documents: docs, codeIds, threshold: deferredThreshold });
  }, [docIds, codeIds, codings, codingsA, codingsB, docById, deferredThreshold]);

  const rows = useMemo(() => (result ? codeRows(result, codeMap) : []), [result, codeMap]);
  const docOrder = useMemo(() => new Map(docIds.map((id, i) => [id, i])), [docIds]);
  const items = useMemo(() => (result ? pairDisagreements(result.segment.disagreements, docOrder) : []), [result, docOrder]);
  const docLabels = useMemo(() => docIds.map((id) => docNames.get(id) ?? '?'), [docIds, docNames]);

  const coderA = coders.find((c) => c.id === a) ?? null;
  const coderB = coders.find((c) => c.id === b) ?? null;
  const names = { a: coderA?.name ?? 'A', b: coderB?.name ?? 'B' };

  const isDefaultDocs = mySel.docs === null;
  const isDefaultCodes = mySel.codes === null;
  const docSummary = `${tp('agreement.setup.docsCount', docIds.length)}${isDefaultDocs && docIds.length ? ` · ${t('agreement.setup.bothCoded')}` : ''}`;
  const codeSummary = `${tp('agreement.setup.codesCount', codeIds.length)}${isDefaultCodes && codeIds.length ? ` · ${t('agreement.setup.bothUsed')}` : ''}`;

  const exportItems = useMemo<MenuEntry[] | null>(() => {
    if (!result || !coderA || !coderB) return null;
    const input = async (): Promise<ReportInput> => {
      const info = await project.platform.info();
      return {
        t,
        tp,
        bcp47: meta.bcp47,
        projectName: project.info.name,
        coderA: { name: coderA.name, color: coderA.color },
        coderB: { name: coderB.name, color: coderB.color },
        date: date(DateTime.now(), 'long'),
        version: info.version,
        result,
        rows,
        documentNames: docNames,
        codeNames: codeMap,
        threshold: deferredThreshold,
        disagreements: items,
        codingText: new Map([...codingsById].map(([id, c]) => [id, c.text])),
      };
    };
    const run = (ext: 'docx' | 'html' | 'xlsx' | 'csv') => async () => {
      try {
        const i = await input();
        const title = t('agreement.report.title');
        let bytes: Uint8Array;
        let filter: string;
        if (ext === 'docx') {
          bytes = buildDocx(buildReport(i));
          filter = t('agreement.export.docx');
        } else if (ext === 'html') {
          bytes = utf8(buildHtml(buildReport(i)));
          filter = t('agreement.export.html');
        } else if (ext === 'xlsx') {
          bytes = buildXlsx(buildWorkbook(i), { title, creator: `Trama ${i.version}` });
          filter = t('agreement.export.xlsx');
        } else {
          // Excel in Portugal and Spain opens ';'-separated files by double-click.
          bytes = csvBytes(codeTable(i), { delimiter: meta.bcp47.startsWith('en') ? ',' : ';' });
          filter = t('agreement.export.csv');
        }
        const saved = await saveBytes(
          project.platform,
          t('agreement.export.dialogTitle'),
          `${project.info.name} - ${title} (${names.a}, ${names.b}).${ext}`,
          { name: filter, extensions: [ext] },
          bytes,
        );
        if (!saved) return;
        await project.log('export', `agreement .${ext} (${names.a} / ${names.b})`);
        toast.show({ message: t('agreement.export.saved', { name: saved }), tone: 'success' });
      } catch (e) {
        console.error('agreement export failed', e);
        toast.show({ message: t('agreement.export.failed', { message: e instanceof Error ? e.message : String(e) }), tone: 'danger' });
      }
    };
    return [
      { id: 'docx', label: t('agreement.export.docx'), hint: '.docx', onSelect: () => void run('docx')(), testId: 'agreement-export-docx' },
      { id: 'html', label: t('agreement.export.html'), hint: '.html', onSelect: () => void run('html')(), testId: 'agreement-export-html' },
      { kind: 'separator' },
      { id: 'xlsx', label: t('agreement.export.xlsx'), hint: '.xlsx', onSelect: () => void run('xlsx')(), testId: 'agreement-export-xlsx' },
      { id: 'csv', label: t('agreement.export.csv'), hint: '.csv', onSelect: () => void run('csv')(), testId: 'agreement-export-csv' },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, rows, items, coderA, coderB, codingsById, docNames, codeMap, deferredThreshold, t, tp, meta.bcp47]);

  useEffect(() => {
    onExportItems(exportItems);
  }, [exportItems, onExportItems]);
  useEffect(() => () => onExportItems(null), [onExportItems]);

  const docItems = useMemo(() => {
    const count = (list: readonly Coding[]) => {
      const m = new Map<string, number>();
      for (const c of list) m.set(c.document_id, (m.get(c.document_id) ?? 0) + 1);
      return m;
    };
    const ca = count(codingsA);
    const cb = count(codingsB);
    return documents.map((d) => {
      const na = ca.get(d.id) ?? 0;
      const nb = cb.get(d.id) ?? 0;
      return {
        id: d.id,
        label: d.name,
        hint:
          na || nb
            ? t('agreement.picker.counts', { a: `${names.a} ${fmtInt(na, meta.bcp47)}`, b: `${names.b} ${fmtInt(nb, meta.bcp47)}` })
            : t('agreement.picker.notCoded'),
      };
    });
  }, [documents, codingsA, codingsB, names.a, names.b, t, meta.bcp47]);
  const codeItems = useMemo(() => {
    const docs = new Set(docIds);
    const count = (list: readonly Coding[]) => {
      const m = new Map<string, number>();
      for (const c of list) if (docs.has(c.document_id)) m.set(c.code_id, (m.get(c.code_id) ?? 0) + 1);
      return m;
    };
    const ca = count(codingsA);
    const cb = count(codingsB);
    return flatCodes.map(({ code, depth }) => {
      const na = ca.get(code.id) ?? 0;
      const nb = cb.get(code.id) ?? 0;
      return {
        id: code.id,
        label: code.name,
        color: code.color,
        depth,
        heading: !code.codable,
        hint: na || nb ? t('agreement.picker.counts', { a: `${names.a} ${fmtInt(na, meta.bcp47)}`, b: `${names.b} ${fmtInt(nb, meta.bcp47)}` }) : undefined,
      };
    });
  }, [flatCodes, docIds, codingsA, codingsB, names.a, names.b, t, meta.bcp47]);

  if (!base.data) {
    return (
      <div className="agr-loading">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }

  if (coders.length < 2) {
    return (
      <EmptyState
        icon={Users}
        title={t('agreement.empty.oneCoderTitle')}
        actions={
          <Button variant="primary" onClick={onTeam} data-testid="agreement-to-team">
            {t('agreement.empty.toTeam')}
          </Button>
        }
        className="agr-empty"
        data-testid="agreement-empty"
      >
        {t('agreement.empty.oneCoderBody')}
      </EmptyState>
    );
  }

  return (
    <div className="agr-compare">
      <Setup
        coders={coders}
        a={a}
        b={b}
        onCoders={(na, nb) => {
          setChosen({ a: na, b: nb });
          setFilterDoc(null);
        }}
        docSummary={docSummary}
        codeSummary={codeSummary}
        onChooseDocs={() => setPicking('docs')}
        onChooseCodes={() => setPicking('codes')}
        level={level}
        onLevel={setLevel}
        threshold={threshold}
        onThreshold={setThreshold}
        oneOnly={oneOnlyLeftOut}
        onIncludeOneOnly={() => setSel({ ...mySel, codes: [...new Set([...codeIds, ...use.oneOnly])] })}
      />

      <PickerDialog
        open={picking === 'docs'}
        onClose={() => setPicking(null)}
        title={t('agreement.setup.chooseDocuments')}
        items={docItems}
        selected={docIds}
        presets={[
          { id: 'both', label: t('agreement.picker.bothCoded'), ids: bothCoded },
          { id: 'all', label: t('agreement.picker.all'), ids: documents.map((d) => d.id) },
          { id: 'none', label: t('agreement.picker.none'), ids: [] },
        ]}
        onApply={(ids) => {
          setSel({ ...mySel, docs: ids });
          setPicking(null);
          if (filterDoc && !ids.includes(filterDoc)) setFilterDoc(null);
        }}
        testId="agreement-pick-docs"
      />
      <PickerDialog
        open={picking === 'codes'}
        onClose={() => setPicking(null)}
        title={t('agreement.setup.chooseCodes')}
        items={codeItems}
        selected={codeIds}
        presets={[
          { id: 'both', label: t('agreement.picker.usedByBoth'), ids: use.both },
          {
            id: 'either',
            label: t('agreement.picker.usedByEither'),
            ids: flatCodes.map((c) => c.code.id).filter((id) => use.both.includes(id) || use.oneOnly.includes(id)),
          },
          { id: 'all', label: t('agreement.picker.all'), ids: flatCodes.filter((c) => c.code.codable).map((c) => c.code.id) },
          { id: 'none', label: t('agreement.picker.none'), ids: [] },
        ]}
        onApply={(ids) => {
          setSel({ ...mySel, codes: ids });
          setPicking(null);
        }}
        testId="agreement-pick-codes"
      />

      {!codings ? (
        <div className="agr-loading">
          <Spinner label={t('common.loading')} />
        </div>
      ) : !result || !coderA || !coderB ? (
        <EmptyState icon={Scale} title={t('agreement.empty.nothingTitle')} className="agr-empty" data-testid="agreement-nothing">
          {bothCoded.length === 0 ? t('agreement.empty.noOverlapBody', { a: names.a, b: names.b }) : t('agreement.empty.nothingBody')}
        </EmptyState>
      ) : (
        <>
          {a === b ? <Notice tone="warning">{t('agreement.empty.sameCoder')}</Notice> : null}
          <SummaryCards level={level} result={result} threshold={deferredThreshold} names={names} />
          <HowCalculated level={level} threshold={deferredThreshold} open={howOpen} onToggle={setHowOpen} />
          <CodeTable level={level} rows={rows} result={result} docLabels={docLabels} names={names} />
          <DocTable
            level={level}
            result={result}
            docNames={docNames}
            names={names}
            filterDoc={filterDoc}
            onShowDisagreements={(id) => {
              setFilterDoc(id);
              document.getElementById('agr-disagreements')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />
          <Disagreements
            key={pair}
            items={items}
            codingsById={codingsById}
            codingsA={codingsA}
            codingsB={codingsB}
            coderA={coderA}
            coderB={coderB}
            codes={codeMap}
            docNames={docNames}
            documentIds={docIds}
            threshold={deferredThreshold}
            filterDoc={filterDoc}
            onFilterDoc={setFilterDoc}
          />
        </>
      )}
    </div>
  );
}
