import React from 'react';
import { AudioLines, BookOpen, ClipboardPaste, FilePen, FileText, Sheet, ShieldCheck, Upload, type LucideIcon } from 'lucide-react';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';

/** The empty Import screen: choose or drop files, or start another way. */
export function StartPanel({ onChoose, onPaste, onNew, onCodebook }: { onChoose: () => void; onPaste: () => void; onNew: () => void; onCodebook: () => void }) {
  const { t } = useI18n();
  return (
    <div className="imp-start" data-testid="import-start-panel">
      <div className="imp-start__inner">
        <section className="imp-zone" aria-labelledby="imp-zone-title">
          <div className="imp-zone__icon" aria-hidden>
            <Upload size={26} strokeWidth={1.5} />
          </div>
          <h2 id="imp-zone-title" className="imp-zone__title">
            {t('importer.start.dropTitle')}
          </h2>
          <p className="imp-zone__body">{t('importer.start.dropBody')}</p>
          <Button variant="primary" size="lg" icon={FileText} onClick={onChoose} data-autofocus data-testid="import-choose">
            {t('importer.start.choose')}
          </Button>
          <p className="imp-zone__safe">
            <ShieldCheck size={14} aria-hidden />
            {t('importer.start.privacy')}
          </p>
        </section>

        <div className="imp-ways">
          <Way icon={ClipboardPaste} title={t('importer.start.paste')} body={t('importer.start.pasteBody')} onClick={onPaste} testId="import-paste" />
          <Way icon={FilePen} title={t('importer.start.newDoc')} body={t('importer.start.newDocBody')} onClick={onNew} testId="import-new" />
          <Way icon={BookOpen} title={t('importer.start.codebook')} body={t('importer.start.codebookBody')} onClick={onCodebook} testId="import-codebook" />
        </div>

        <section className="imp-formats" aria-labelledby="imp-formats-title">
          <h2 id="imp-formats-title" className="imp-formats__title">
            {t('importer.start.formats')}
          </h2>
          <dl className="imp-formats__list">
            <Format icon={FileText} title={t('importer.start.documents')} body={t('importer.start.documentsList')} />
            <Format icon={AudioLines} title={t('importer.start.transcripts')} body={t('importer.start.transcriptsList')} />
            <Format icon={Sheet} title={t('importer.start.surveys')} body={t('importer.start.surveysList')} />
          </dl>
          <p className="imp-formats__note">{t('importer.start.mediaNote')}</p>
        </section>
      </div>
    </div>
  );
}

function Way({ icon: Icon, title, body, onClick, testId }: { icon: LucideIcon; title: string; body: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" className="imp-way" onClick={onClick} data-testid={testId}>
      <span className="imp-way__icon" aria-hidden>
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <span className="imp-way__text">
        <span className="imp-way__title">{title}</span>
        <span className="imp-way__body">{body}</span>
      </span>
    </button>
  );
}

function Format({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="imp-format">
      <dt>
        <Icon size={15} strokeWidth={1.75} aria-hidden />
        {title}
      </dt>
      <dd>{body}</dd>
    </div>
  );
}
