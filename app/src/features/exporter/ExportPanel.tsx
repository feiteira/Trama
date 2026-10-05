import React, { useEffect, useState, type ReactNode } from 'react';
import { BookMarked, CircleHelp, FileText, Network, Package, type LucideIcon } from 'lucide-react';
import { utf8 } from '../../core/bytes';
import { buildDocx, buildHtml, csvBytes } from '../../core/export/office';
import { exportQdc, exportQdpx } from '../../core/export/refi';
import type { FileFilter } from '../../platform/types';
import { exportProjectFile, projectToBundle } from '../../services/datafile';
import { JobStopped } from '../../services/jobs';
import { useHold, usePlatform, useProject } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { RadioGroup, Switch } from '../../ui/components/Choice';
import { Notice } from '../../ui/components/Feedback';
import { TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import {
  type CodebookFormat, CODEBOOK_FORMATS, DEFAULT_TRAMA, exportFileName, type ReportFormat, REPORT_FORMATS, tramaExportOptions, type TramaOptions,
  tramaProblem,
} from './exportModel';
import { codebookReport, codebookRows, loadReportData, projectReport } from './report';

type Busy = 'trama' | 'qdpx' | 'codebook' | 'report' | null;

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path;

/** The app's version, for the files' "made by" field. */
function useVersion(): string {
  const platform = usePlatform();
  const [version, setVersion] = useState(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '');
  useEffect(() => {
    let live = true;
    platform
      .info()
      .then((i) => live && setVersion(i.version))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [platform]);
  return version;
}

export function ExportPanel() {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const project = useProject();
  const platform = usePlatform();
  const toast = useToast();
  const { go } = useRouter();
  const version = useVersion();
  const origin = `Trama ${version}`.trim();
  const [busy, setBusy] = useState<Busy>(null);
  useHold(busy !== null);

  const [trama, setTrama] = useState<TramaOptions>(DEFAULT_TRAMA);
  const [tramaTried, setTramaTried] = useState(false);
  const [hasPseudonyms, setHasPseudonyms] = useState(false);
  const [crlf, setCrlf] = useState(false);
  const [qdpxWarnings, setQdpxWarnings] = useState<string[] | null>(null);
  const [codebookFormat, setCodebookFormat] = useState<CodebookFormat>('qdc');
  const [reportFormat, setReportFormat] = useState<ReportFormat>('docx');

  useEffect(() => {
    void project.store
      .count('pseudonym')
      .then((n) => setHasPseudonyms(n > 0))
      .catch(() => undefined);
  }, [project]);

  /**
   * Asks where to save first (so nothing is built or logged for a cancelled export), then
   * builds the bytes, writes them and says where they went.
   */
  async function save(kind: Exclude<Busy, null>, opts: { title: string; what: string | null; ext: string; filter: FileFilter; build: () => Promise<Uint8Array> }): Promise<boolean> {
    if (busy) return false;
    const path = await platform.dialogs.saveFile(opts.title, exportFileName(project.info.name, opts.what, opts.ext, new Date()), [opts.filter]);
    if (!path) return false;
    setBusy(kind);
    try {
      const bytes = await opts.build();
      await platform.files.write(path, bytes);
      toast.show({ message: t('exporter.export.saved', { name: baseName(path) }), tone: 'success', durationMs: 8000 });
      return true;
    } catch (e) {
      if (e instanceof JobStopped || !project.isOpen) return false;
      console.error('export failed', e);
      toast.show({ message: t('exporter.export.failed', { message: e instanceof Error ? e.message : String(e) }), tone: 'danger' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const problem = tramaProblem(trama);
  async function exportTrama() {
    setTramaTried(true);
    if (problem) return;
    const ok = await save('trama', {
      title: t('exporter.export.trama.dialogTitle'),
      what: null,
      ext: 'trama',
      filter: { name: t('exporter.export.trama.fileType'), extensions: ['trama'] },
      build: () => exportProjectFile(project, tramaExportOptions(trama)),
    });
    if (ok) {
      setTrama((o) => ({ ...o, password: '', confirm: '' }));
      setTramaTried(false);
    }
  }

  async function exportRefi() {
    let warnings: string[] = [];
    const ok = await save('qdpx', {
      title: t('exporter.export.qdpx.dialogTitle'),
      what: null,
      ext: 'qdpx',
      filter: { name: t('exporter.export.qdpx.fileType'), extensions: ['qdpx'] },
      build: async () => {
        const bundle = await projectToBundle(project, { includeDeleted: false, includePseudonyms: false });
        const out = exportQdpx(bundle, { origin, crlfForMaxqda: crlf });
        warnings = [...bundle.warnings, ...out.warnings];
        await project.log('export', `.qdpx${crlf ? ' (MAXQDA line endings)' : ''}`);
        return out.bytes;
      },
    });
    setQdpxWarnings(ok && warnings.length ? warnings : null);
  }

  async function exportCodebook() {
    const f = codebookFormat;
    const fileType = { qdc: t('exporter.export.codebook.fileTypeQdc'), docx: t('exporter.export.codebook.fileTypeDocx'), csv: t('exporter.export.codebook.fileTypeCsv') }[f];
    if ((await project.store.count('code')) === 0) {
      toast.show(t('exporter.export.codebook.empty'));
      return;
    }
    await save('codebook', {
      title: t('exporter.export.codebook.dialogTitle'),
      what: t('exporter.export.codebook.fileName'),
      ext: f,
      filter: { name: fileType, extensions: [f] },
      build: async () => {
        let bytes: Uint8Array;
        if (f === 'qdc') bytes = utf8(exportQdc(await project.store.list('code'), { origin }));
        else {
          const data = await loadReportData(project, project.info);
          bytes = f === 'docx' ? buildDocx(codebookReport(data, i18n, { generator: origin, now: new Date() })) : csvBytes(codebookRows(data.codes, i18n), { delimiter: locale === 'en' ? ',' : ';' });
        }
        await project.log('export', `codebook .${f}`);
        return bytes;
      },
    });
  }

  async function exportReport() {
    const f = reportFormat;
    await save('report', {
      title: t('exporter.export.report.dialogTitle'),
      what: t('exporter.export.report.fileName'),
      ext: f,
      filter: { name: f === 'docx' ? t('exporter.export.codebook.fileTypeDocx') : t('exporter.export.report.fileTypeHtml'), extensions: [f] },
      build: async () => {
        const data = await loadReportData(project, project.info);
        const doc = projectReport(data, i18n, { generator: origin, now: new Date() });
        const bytes = f === 'docx' ? buildDocx(doc) : utf8(buildHtml(doc));
        await project.log('export', `project report .${f}`);
        return bytes;
      },
    });
  }

  const exportButton = (kind: Exclude<Busy, null>, run: () => void) => (
    <Button variant="secondary" onClick={run} busy={busy === kind} disabled={busy !== null && busy !== kind} data-testid={`export-${kind}`}>
      {busy === kind ? t('exporter.export.working') : t('exporter.export.button')}
    </Button>
  );

  return (
    <div className="xp">
      <p className="proj__lead">{t('exporter.export.intro')}</p>

      <ExportCard icon={Package} title={t('exporter.export.trama.title')} ext=".trama" body={t('exporter.export.trama.body')} action={exportButton('trama', () => void exportTrama())} testId="export-card-trama">
        <Switch
          checked={trama.protect}
          onChange={(protect) => setTrama((o) => ({ ...o, protect }))}
          label={t('exporter.export.trama.protect')}
          description={t('exporter.export.trama.protectHint')}
          data-testid="trama-protect"
        />
        {trama.protect ? (
          <div className="xp__pw">
            <TextField
              type="password"
              label={t('exporter.export.trama.password')}
              value={trama.password}
              onChange={(password) => setTrama((o) => ({ ...o, password }))}
              autoComplete="new-password"
              error={tramaTried && problem === 'passwordRequired' ? t('exporter.export.trama.passwordRequired') : undefined}
              data-testid="trama-password"
            />
            <TextField
              type="password"
              label={t('exporter.export.trama.confirm')}
              value={trama.confirm}
              onChange={(confirm) => setTrama((o) => ({ ...o, confirm }))}
              autoComplete="new-password"
              error={tramaTried && problem === 'mismatch' ? t('exporter.export.trama.mismatch') : undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void exportTrama();
              }}
              data-testid="trama-confirm"
            />
          </div>
        ) : null}
        <Switch
          checked={trama.includePseudonyms}
          onChange={(includePseudonyms) => setTrama((o) => ({ ...o, includePseudonyms }))}
          label={t('exporter.export.trama.pseudonyms')}
          description={hasPseudonyms ? t('exporter.export.trama.pseudonymsHint') : t('exporter.export.trama.noPseudonyms')}
          disabled={!hasPseudonyms}
          data-testid="trama-pseudonyms"
        />
        {trama.includePseudonyms ? (
          <Notice tone="warning" data-testid="trama-pseudonyms-warning">
            {t('exporter.export.trama.pseudonymsWarning')}
          </Notice>
        ) : null}
      </ExportCard>

      <ExportCard icon={Network} title={t('exporter.export.qdpx.title')} ext=".qdpx" body={t('exporter.export.qdpx.body')} action={exportButton('qdpx', () => void exportRefi())} testId="export-card-qdpx">
        <Switch checked={crlf} onChange={setCrlf} label={t('exporter.export.qdpx.maxqda')} description={t('exporter.export.qdpx.maxqdaHint')} data-testid="qdpx-maxqda" />
        <div className="xp__note">
          <p>{t('exporter.export.qdpx.note')}</p>
          <button type="button" className="xp__link" onClick={() => go({ name: 'help', topic: 'refi-qda' })} data-testid="qdpx-help">
            <CircleHelp size={13} aria-hidden />
            {t('exporter.export.qdpx.learnMore')}
          </button>
        </div>
        {qdpxWarnings ? (
          <Notice tone="warning" title={t('exporter.export.qdpx.warningsTitle')} data-testid="qdpx-warnings">
            <ul className="xp__warnings">
              {qdpxWarnings.slice(0, 12).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {qdpxWarnings.length > 12 ? <li>…</li> : null}
            </ul>
          </Notice>
        ) : null}
      </ExportCard>

      <ExportCard icon={BookMarked} title={t('exporter.export.codebook.title')} ext={`.${codebookFormat}`} body={t('exporter.export.codebook.body')} action={exportButton('codebook', () => void exportCodebook())} testId="export-card-codebook">
        <RadioGroup<CodebookFormat>
          label={t('exporter.export.format')}
          variant="segmented"
          value={codebookFormat}
          onChange={setCodebookFormat}
          options={CODEBOOK_FORMATS.map((f) => ({ value: f, label: t(`exporter.export.codebook.${f}`) }))}
          className="xp__formats"
          data-testid="codebook-format"
        />
      </ExportCard>

      <ExportCard icon={FileText} title={t('exporter.export.report.title')} ext={`.${reportFormat}`} body={t('exporter.export.report.body')} action={exportButton('report', () => void exportReport())} testId="export-card-report">
        <RadioGroup<ReportFormat>
          label={t('exporter.export.format')}
          variant="segmented"
          value={reportFormat}
          onChange={setReportFormat}
          options={REPORT_FORMATS.map((f) => ({ value: f, label: t(`exporter.export.report.${f}`) }))}
          className="xp__formats"
          data-testid="report-format"
        />
      </ExportCard>
    </div>
  );
}

function ExportCard({ icon: Icon, title, ext, body, action, children, testId }: { icon: LucideIcon; title: string; ext: string; body: string; action: ReactNode; children?: ReactNode; testId: string }) {
  const id = `${testId}-title`;
  return (
    <section className="xcard" aria-labelledby={id} data-testid={testId}>
      <div className="xcard__icon" aria-hidden>
        <Icon size={19} strokeWidth={1.6} />
      </div>
      <div className="xcard__main">
        <div className="xcard__head">
          <div className="xcard__titles">
            <h3 className="xcard__title" id={id}>
              {title}
            </h3>
            <span className="xcard__ext" translate="no">
              {ext}
            </span>
          </div>
          <div className="xcard__action">{action}</div>
        </div>
        <p className="xcard__body">{body}</p>
        {children ? <div className="xcard__options">{children}</div> : null}
      </div>
    </section>
  );
}
