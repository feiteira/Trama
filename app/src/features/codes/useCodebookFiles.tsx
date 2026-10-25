import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { decodeText, utf8 } from '../../core/bytes';
import { exportQdc, importQdc, RefiError } from '../../core/export/refi';
import { buildDocx, buildXlsx, csvBytes } from '../../core/export/office';
import { parseCsv } from '../../core/import/csv';
import { readXlsx } from '../../core/import/xlsx';
import * as codesService from '../../services/codes';
import { usePlatform, useProject } from '../../shell/AppState';
import { useUndo } from '../../shell/undo';
import { useI18n } from '../../ui/i18n';
import { useToast } from '../../ui/components/Toast';
import { pathsOf } from '../common/codeTreeModel';
import type { CodeData } from '../common/CodeTreeActions';
import {
  codebookMarkdown,
  codebookReport,
  codebookTable,
  COLUMNS,
  importedFromQdc,
  parseCodebookTable,
  pathKey,
  planCodebookMerge,
  safeFileName,
  type CodebookEntry,
  type ImportedCode,
  type ReportLabels,
} from './codebookIO';
import { ImportCodebookDialog } from './CodesDialogs';
import { say, tableWarnings } from '../importer/messages';

export type ExportFormat = 'qdc' | 'docx' | 'csv' | 'xlsx' | 'md';

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

interface Pending {
  fileName: string;
  codes: ImportedCode[];
  skipped: number;
  warnings: string[];
  /** The file's quotes do not balance (rows may have run together): shown, and confirmed before importing. */
  quotes?: string;
}

/** Exporting the codebook to files, and importing one (preview, then merge by name). */
export function useCodebookFiles(data: CodeData | undefined): { exportAs: (f: ExportFormat) => Promise<void>; importFile: () => Promise<void>; busy: boolean; dialog: React.ReactNode } {
  const { t, tp, locale, meta, date } = useI18n();
  const platform = usePlatform();
  const project = useProject();
  const toast = useToast();
  const { record, undo } = useUndo();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [overwrite, setOverwrite] = useState(false);

  const entries = (): CodebookEntry[] => {
    if (!data) return [];
    const paths = pathsOf(data.items);
    return data.rows.map((r) => ({ code: r.code, depth: r.depth, path: paths.get(r.code.id) ?? [r.code.name], own: r.own, total: r.total, documents: r.documents }));
  };

  const reportLabels = (): ReportLabels => ({
    title: t('codes.io.reportTitle'),
    subtitle: `${project.info.name} · ${date(DateTime.now(), 'long')}`,
    generator: `Trama ${VERSION}`.trim(),
    lang: meta.bcp47,
    definition: t('codes.fields.description'),
    inclusion: t('codes.fields.inclusion'),
    exclusion: t('codes.fields.exclusion'),
    example: t('codes.fields.example'),
    category: t('codes.io.category'),
    usage: (e) => `${tp('common.count.codings', e.own)} · ${tp('common.count.documents', e.documents)}`,
    shortcut: (n) => t('codes.tree.shortcut', { n }),
    empty: t('codes.io.empty'),
  });

  const save = async (bytes: Uint8Array, ext: string, filterName: string) => {
    const base = safeFileName(`${project.info.name} – ${t('codes.io.fileBase')}`);
    const path = await platform.dialogs.saveFile(t('codes.io.saveTitle'), `${base}.${ext}`, [{ name: filterName, extensions: [ext] }]);
    if (!path) return;
    await platform.files.write(path, bytes);
    await project.log('export', `codebook .${ext}`).catch(() => undefined);
    const file = path.split(/[\\/]/).pop() ?? path;
    toast.show({ message: t('codes.io.exported', { file }), tone: 'success' });
  };

  const exportAs = async (format: ExportFormat) => {
    if (!data || busy) return;
    setBusy(true);
    try {
      const list = entries();
      const table = () =>
        codebookTable(list, {
          headers: Object.fromEntries(COLUMNS.map((c) => [c, t(`codes.io.headers.${c}`)])) as Record<(typeof COLUMNS)[number], string>,
          yes: t('common.yes'),
          no: t('common.no'),
        });
      switch (format) {
        case 'qdc':
          await save(utf8(exportQdc(data.rows.map((r) => r.code), { origin: `Trama ${VERSION}`.trim() })), 'qdc', t('codes.io.formats.qdc'));
          break;
        case 'docx':
          await save(buildDocx(codebookReport(list, reportLabels())), 'docx', t('codes.io.formats.docx'));
          break;
        case 'csv':
          // Excel in Portugal and Spain expects ';' (the comma is the decimal separator).
          await save(csvBytes(table(), { delimiter: locale === 'en' ? ',' : ';' }), 'csv', t('codes.io.formats.csv'));
          break;
        case 'xlsx':
          await save(buildXlsx([{ name: t('codes.io.reportTitle'), rows: table() }], { title: t('codes.io.reportTitle'), creator: `Trama ${VERSION}`.trim() }), 'xlsx', t('codes.io.formats.xlsx'));
          break;
        case 'md':
          await save(utf8(codebookMarkdown(list, reportLabels())), 'md', t('codes.io.formats.md'));
          break;
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const importFile = async () => {
    if (busy) return;
    try {
      const [path] = await platform.dialogs.pickFiles(t('codes.io.pickTitle'), [{ name: t('codes.io.formats.any'), extensions: ['qdc', 'csv', 'tsv', 'txt', 'xlsx'] }], false);
      if (!path) return;
      setBusy(true);
      const bytes = await platform.files.read(path);
      const fileName = path.split(/[\\/]/).pop() ?? path;
      const ext = fileName.toLowerCase().split('.').pop() ?? '';
      let next: Pending;
      if (ext === 'qdc' || ext === 'xml') {
        const qdc = importQdc(bytes);
        next = { fileName, codes: importedFromQdc(qdc), skipped: 0, warnings: qdc.warnings.length ? [t('codes.import.setsIgnored')] : [] };
      } else {
        const table = ext === 'xlsx' ? readXlsx(bytes, fileName).table : parseCsv(decodeText(bytes), fileName, ext === 'tsv' ? { delimiter: '\t' } : {});
        const res = parseCodebookTable(table.headers, table.rows);
        if (res.problem) {
          toast.show({ message: res.problem === 'noNameColumn' ? t('codes.import.noNameColumn') : t('codes.import.empty'), tone: 'danger' });
          return;
        }
        const notes = tableWarnings(table.warnings, meta.bcp47, 'codes.import.malformedQuotes');
        next = { fileName, codes: res.codes, skipped: res.skipped, warnings: notes.others.map((m) => say(m, t, tp)), ...(notes.quotes ? { quotes: say(notes.quotes, t, tp) } : {}) };
      }
      if (!next.codes.length) {
        toast.show({ message: t('codes.import.empty'), tone: 'danger' });
        return;
      }
      setOverwrite(false);
      setPending(next);
    } catch (e) {
      if (e instanceof RefiError) toast.show({ message: t('codes.import.notCodebook'), tone: 'danger' });
      else toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const existing = useMemo(() => {
    if (!data) return [];
    const paths = pathsOf(data.items);
    return data.rows.map((r) => ({ id: r.code.id, path: paths.get(r.code.id) ?? [r.code.name], code: r.code }));
  }, [data]);
  const plan = useMemo(() => (pending ? planCodebookMerge(existing, pending.codes, { overwrite }) : null), [pending, existing, overwrite]);

  // One batch (one write, one Undo step, one refresh) rather than a service call per code:
  // a codebook of hundreds of codes imports in a moment.
  const applyPlan = async () => {
    if (!plan || !pending) return;
    try {
      const existingIds = new Map(existing.map((e) => [pathKey(e.path), e.id]));
      const planned = new Set<string>();
      const drafts: codesService.CodeDraft[] = [];
      const updates: { id: string; patch: codesService.CodePatch }[] = [];
      for (const it of plan.items) {
        if (it.status === 'new') {
          const key = pathKey(it.path);
          const parentKey = it.path.length > 1 ? pathKey(it.path.slice(0, -1)) : null;
          const parentId = parentKey === null ? undefined : existingIds.get(parentKey);
          const parent = parentId ? { id: parentId } : parentKey !== null && planned.has(parentKey) ? { ref: parentKey } : null;
          drafts.push({ ref: key, parent, name: it.path[it.path.length - 1]!, ...it.fields });
          planned.add(key);
        } else if (it.status === 'update' && it.existingId) {
          updates.push({ id: it.existingId, patch: it.fields });
        }
      }
      const { codes, updated, undo: entry } = await codesService.createCodes(project, drafts, { updates, source: pending.fileName });
      if (codes.length || updated) {
        record(entry);
        toast.show({
          message: t('codes.import.done', { created: codes.length, updated }),
          tone: 'success',
          action: { label: t('common.undo'), run: () => undo(), testId: 'toast-undo' },
        });
      }
      setPending(null);
    } catch (e) {
      toast.error(e);
    }
  };

  const dialog =
    pending && plan ? (
      <ImportCodebookDialog
        fileName={pending.fileName}
        plan={plan}
        skipped={pending.skipped}
        warnings={pending.warnings}
        {...(pending.quotes ? { quotes: pending.quotes } : {})}
        overwrite={overwrite}
        onOverwrite={setOverwrite}
        onCancel={() => setPending(null)}
        onConfirm={applyPlan}
      />
    ) : null;

  return { exportAs, importFile, busy, dialog };
}
