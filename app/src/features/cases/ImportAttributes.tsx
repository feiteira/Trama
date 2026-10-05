import React, { useMemo, useState } from 'react';
import { CircleCheck, FileSpreadsheet, FolderOpen } from 'lucide-react';
import { parseCsv } from '../../core/import/csv';
import { decodeText } from '../../core/import/text';
import type { ImportedTable } from '../../core/import/types';
import { readXlsx, type XlsxSheet } from '../../core/import/xlsx';
import { type AttributeImport, importAttributeTable, listAttributes } from '../../services/cases';
import { useHold, usePlatform, useProject } from '../../shell/AppState';
import { useUndo } from '../../shell/undo';
import { useLive } from '../../shell/useLive';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Checkbox, Switch } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Badge, Notice } from '../../ui/components/Feedback';
import { Select } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { baseName } from '../log/exportFile';
import { countMatches, guessNameColumn, planColumns, tableToImport } from './importTable';

const PREVIEW_ROWS = 6;

interface Loaded {
  file: string;
  bytes: Uint8Array;
  xlsx: boolean;
  sheets: XlsxSheet[];
  sheet: number;
  table: ImportedTable;
}

/** Attributes from a spreadsheet (one row per case): pick, preview, choose columns, import. */
export function ImportAttributes({ onClose }: { onClose: () => void }) {
  const { t, tp } = useI18n();
  const project = useProject();
  const platform = usePlatform();
  const { record } = useUndo();
  const toast = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [nameColumn, setNameColumn] = useState(0);
  const [columns, setColumns] = useState<ReadonlySet<number>>(new Set());
  const [createMissing, setCreateMissing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [result, setResult] = useState<AttributeImport | null>(null);
  useHold(busy);

  const { data: ctx } = useLive(async (store) => ({ cases: await store.list('case'), attrs: await listAttributes(project) }), [], ['case', 'attribute']);
  const caseNames = useMemo(() => (ctx?.cases ?? []).map((c) => c.name), [ctx]);

  const choose = (table: ImportedTable) => {
    const guess = guessNameColumn(table.headers, table.rows, caseNames);
    setNameColumn(guess);
    setColumns(new Set(table.headers.map((_, i) => i).filter((i) => i !== guess)));
  };

  const pick = async () => {
    setReadError(null);
    try {
      const [path] = await platform.dialogs.pickFiles(t('cases.import.pickTitle'), [{ name: t('cases.import.filter'), extensions: ['csv', 'tsv', 'txt', 'xlsx'] }], false);
      if (!path) return;
      setBusy(true);
      const bytes = await platform.files.read(path);
      const file = baseName(path);
      const xlsx = /\.xlsx$/i.test(file);
      const next = xlsx ? (() => {
        const r = readXlsx(bytes, file);
        return { file, bytes, xlsx, sheets: r.sheets, sheet: r.sheet, table: r.table };
      })() : { file, bytes, xlsx, sheets: [], sheet: 0, table: parseCsv(decodeText(bytes), file, /\.tsv$/i.test(file) ? { delimiter: '\t' } : {}) };
      if (!next.table.headers.length || !next.table.rows.length) {
        setReadError(t('cases.import.emptyFile', { file }));
        return;
      }
      setLoaded(next);
      choose(next.table);
    } catch (e) {
      console.error(e);
      setReadError(t('cases.import.readFailed', { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const switchSheet = (index: number) => {
    if (!loaded) return;
    try {
      const r = readXlsx(loaded.bytes, loaded.file, { sheet: index });
      setLoaded({ ...loaded, sheet: r.sheet, table: r.table });
      choose(r.table);
    } catch (e) {
      setReadError(t('cases.import.readFailed', { message: e instanceof Error ? e.message : String(e) }));
    }
  };

  const plan = useMemo(() => (loaded ? planColumns(loaded.table.headers, loaded.table.rows, nameColumn, ctx?.attrs ?? []) : []), [loaded, nameColumn, ctx]);
  const counts = useMemo(() => (loaded ? countMatches(loaded.table.rows, nameColumn, caseNames) : { matched: 0, missing: 0 }), [loaded, nameColumn, caseNames]);
  const chosen = plan.filter((p) => columns.has(p.index));

  const run = async () => {
    if (!loaded || !chosen.length) return;
    setBusy(true);
    try {
      const table = tableToImport(
        loaded.table.headers,
        loaded.table.rows,
        nameColumn,
        chosen.map((p) => p.index),
      );
      const r = await importAttributeTable(project, table.rows, { header: true, nameColumn: table.nameColumn, createMissing });
      record(r.undo);
      setResult(r);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (i: number, on: boolean) =>
    setColumns((cur) => {
      const next = new Set(cur);
      on ? next.add(i) : next.delete(i);
      return next;
    });

  const typeLabel = (p: (typeof plan)[number]) => (p.kind === 'existing' ? t('cases.import.existing', { type: t(`cases.types.${p.attr.type}`) }) : t('cases.import.new', { type: t(`cases.types.${p.type}`) }));

  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (result) {
    body = (
      <div className="imp__done" data-testid="import-summary">
        <div className="imp__done-head">
          <CircleCheck size={20} aria-hidden strokeWidth={1.75} />
          <span>{t('cases.import.doneTitle')}</span>
        </div>
        <dl className="imp__stats">
          <div>
            <dt>{t('cases.import.matched')}</dt>
            <dd data-testid="import-matched">{result.matched}</dd>
          </div>
          <div>
            <dt>{t('cases.import.created')}</dt>
            <dd data-testid="import-created">{result.created}</dd>
          </div>
          <div>
            <dt>{t('cases.import.unmatched')}</dt>
            <dd data-testid="import-unmatched">{result.unmatched.length}</dd>
          </div>
          <div>
            <dt>{t('cases.import.attributesCreated')}</dt>
            <dd>{result.attributesCreated}</dd>
          </div>
        </dl>
        {result.unmatched.length ? (
          <Notice tone="warning" title={t('cases.import.unmatchedTitle')}>
            <p className="imp__names">{result.unmatched.slice(0, 30).join(', ') + (result.unmatched.length > 30 ? ', …' : '')}</p>
          </Notice>
        ) : null}
        {result.invalid ? <Notice tone="warning">{tp('cases.import.invalid', result.invalid)}</Notice> : null}
      </div>
    );
    footer = (
      <Button variant="primary" onClick={onClose} data-testid="import-close">
        {t('common.done')}
      </Button>
    );
  } else if (!loaded) {
    body = (
      <div className="imp__pick">
        <div className="imp__pick-icon" aria-hidden>
          <FileSpreadsheet size={24} strokeWidth={1.5} />
        </div>
        <p className="imp__pick-text">{t('cases.import.intro')}</p>
        <ExampleTable />
        <Button variant="primary" icon={FolderOpen} onClick={() => void pick()} busy={busy} data-testid="import-pick">
          {t('cases.import.pick')}
        </Button>
        {readError ? <Notice tone="danger">{readError}</Notice> : null}
      </div>
    );
    footer = (
      <Button variant="ghost" onClick={onClose}>
        {t('common.cancel')}
      </Button>
    );
  } else {
    const { table } = loaded;
    body = (
      <div className="imp">
        <div className="imp__file">
          <FileSpreadsheet size={16} aria-hidden strokeWidth={1.75} />
          <span className="imp__file-name">{loaded.file}</span>
          <span className="t-muted t-small">{tp('cases.import.rows', table.rows.length)}</span>
          <Button size="sm" variant="ghost" onClick={() => void pick()} data-testid="import-repick">
            {t('cases.import.another')}
          </Button>
        </div>
        {readError ? <Notice tone="danger">{readError}</Notice> : null}
        <div className="imp__controls">
          {loaded.sheets.length > 1 ? (
            <Select<string>
              label={t('cases.import.sheet')}
              size="sm"
              value={String(loaded.sheet)}
              onChange={(v) => switchSheet(Number(v))}
              options={loaded.sheets.map((s, i) => ({ value: String(i), label: s.name }))}
              data-testid="import-sheet"
            />
          ) : null}
          <Select<string>
            label={t('cases.import.nameColumn')}
            size="sm"
            value={String(nameColumn)}
            onChange={(v) => {
              const n = Number(v);
              setColumns((cur) => {
                const next = new Set(cur);
                next.delete(n);
                if (nameColumn !== n) next.add(nameColumn);
                return next;
              });
              setNameColumn(n);
            }}
            options={table.headers.map((h, i) => ({ value: String(i), label: h }))}
            hint={t('cases.import.matchHint', { matched: counts.matched, missing: counts.missing })}
            data-testid="import-name-column"
          />
        </div>

        <div className="imp__preview" role="region" aria-label={t('cases.import.preview')} tabIndex={0}>
          <table className="imp__table">
            <thead>
              <tr>
                {table.headers.map((h, i) => {
                  const p = plan.find((x) => x.index === i);
                  const isName = i === nameColumn;
                  return (
                    <th key={i} className={cx(isName && 'imp__th--name', !isName && !columns.has(i) && 'imp__th--off')}>
                      {isName ? (
                        <div className="imp__th">
                          <span className="imp__th-name">{h}</span>
                          <Badge tone="info">{t('cases.import.caseNames')}</Badge>
                        </div>
                      ) : (
                        <div className="imp__th">
                          <Checkbox checked={columns.has(i)} onChange={(on) => toggle(i, on)} label={<span className="imp__th-name">{h}</span>} data-testid={`import-col-${i}`} />
                          {p ? <span className="imp__th-type">{typeLabel(p)}</span> : null}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, PREVIEW_ROWS).map((r, ri) => (
                <tr key={ri}>
                  {table.headers.map((_, i) => (
                    <td key={i} className={cx(i === nameColumn && 'imp__td--name', i !== nameColumn && !columns.has(i) && 'imp__td--off')}>
                      {r[i] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {table.rows.length > PREVIEW_ROWS ? <p className="imp__more">{tp('cases.import.moreRows', table.rows.length - PREVIEW_ROWS)}</p> : null}
        </div>

        <Switch
          checked={createMissing}
          onChange={setCreateMissing}
          label={t('cases.import.createMissing')}
          description={counts.missing ? tp('cases.import.createMissingHint', counts.missing) : t('cases.import.createMissingNone')}
          data-testid="import-create-missing"
        />
      </div>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={() => void run()} disabled={!chosen.length} busy={busy} data-testid="import-run">
          {chosen.length ? tp('cases.import.run', chosen.length) : t('cases.import.runNone')}
        </Button>
      </>
    );
  }

  return (
    <Dialog open onClose={onClose} size={loaded && !result ? 'xl' : 'md'} dismissible={!busy} title={t('cases.import.title')} footer={footer} data-testid="import-attributes">
      {body}
    </Dialog>
  );
}

/** What such a spreadsheet looks like. */
function ExampleTable() {
  const { t } = useI18n();
  const ex = t('cases.import.example').split('|');
  const cells = [ex.slice(0, 3), ex.slice(3, 6), ex.slice(6, 9)];
  return (
    <table className="imp__example" aria-label={t('cases.import.exampleLabel')}>
      <tbody>
        {cells.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
