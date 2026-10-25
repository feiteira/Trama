import React, { useMemo, useRef, useState } from 'react';
import { AudioLines, FileAudio, KeyRound, Pencil, Trash2, X } from 'lucide-react';
import type { Case, DocGroup, DocKind } from '../../core/model/types';
import { LIMITS } from '../../core/model/types';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { Checkbox, Switch } from '../../ui/components/Choice';
import { Badge, Notice } from '../../ui/components/Feedback';
import { Select, TextField } from '../../ui/components/Field';
import { Popover } from '../../ui/components/Popover';
import { GroupPicker } from './GroupPicker';
import { failureMessage, isSerious, say, warningMessage } from './messages';
import { type Duplicate, formatBytes, formatMs, kindOptions, previewOf, type ReviewRow, speakerSummary } from './model';
import { SurveyMapping } from './SurveyMapping';
import type { SurveyCount } from './survey';

export interface ProjectLists {
  /** text_sha256 → document name. */
  hashes: Map<string, string>;
  cases: Case[];
  groups: DocGroup[];
}

const NONE = '__none';
const NEW = '__new';
const OTHER = '__other';
const HEAD = '__head';

/** Everything about one incoming document: name, kind, case, groups, checks and a preview. */
export function RowDetail({
  row,
  lists,
  duplicate,
  surveyCount,
  onPatch,
  onKind,
  onPassword,
  onSheet,
  onAttach,
  onRemove,
  onRenameSpeaker,
}: {
  row: ReviewRow;
  lists: ProjectLists | undefined;
  duplicate: Duplicate | null;
  surveyCount: SurveyCount;
  onPatch: (f: (r: ReviewRow) => ReviewRow) => void;
  onKind: (k: DocKind) => void;
  onPassword: (password: string) => void;
  onSheet: (sheet: number) => void;
  onAttach: () => void;
  onRemove: () => void;
  onRenameSpeaker: (from: string, to: string) => void;
}) {
  const { t, tp, meta } = useI18n();
  const [password, setPassword] = useState('');
  const cases = lists?.cases ?? [];
  const groups = lists?.groups ?? [];
  const ready = row.status === 'ready';
  const isSurvey = row.table !== null;
  const choice = row.caseChoice;
  const caseValue = choice.mode === 'none' ? NONE : choice.mode === 'existing' ? choice.id : choice.custom ? OTHER : NEW;
  const docName = row.name.trim() || row.filename;
  const caseOptions = [
    { value: NONE, label: t('importer.detail.caseNone') },
    { value: NEW, label: t('importer.detail.caseNew', { name: docName }) },
    { value: OTHER, label: t('importer.detail.caseNewOther') },
    ...(cases.length ? [{ value: HEAD, label: `— ${t('importer.detail.caseExisting')} —`, disabled: true }] : []),
    ...cases.map((c) => ({ value: c.id, label: c.name })),
  ];
  const warnings = row.doc?.warnings ?? row.table?.table.warnings ?? [];
  const sortedWarnings = [...warnings].sort((a, b) => Number(isSerious(b)) - Number(isSerious(a)));

  return (
    <div className="imp-detail" data-testid="import-detail">
      <div className="imp-detail__top">
        <div className="imp-detail__source">
          {row.format ? <Badge>{row.format.toUpperCase()}</Badge> : null}
          <span className="imp-detail__file" title={row.filename}>
            {row.origin === 'paste' ? t('importer.list.pasted') : t('importer.detail.from', { file: row.filename })}
          </span>
        </div>
        <IconButton icon={Trash2} label={t('importer.actions.remove')} onClick={onRemove} data-testid="import-remove" />
      </div>

      {row.status === 'error' && row.failure ? (
        <Notice tone="danger" title={t('importer.list.failed')} data-testid="import-failure">
          {say(failureMessage(row.failure), t, tp)}
        </Notice>
      ) : null}

      {row.status === 'password' && row.failure ? (
        <Notice tone="warning" icon={KeyRound} title={say(failureMessage(row.failure), t, tp)} data-testid="import-pdf-password">
          <form
            className="imp-password"
            onSubmit={(e) => {
              e.preventDefault();
              if (password) onPassword(password);
            }}
          >
            <TextField type="password" value={password} onChange={setPassword} aria-label={t('importer.password.label')} placeholder={t('importer.password.label')} size="sm" autoComplete="off" data-autofocus data-testid="import-pdf-password-field" />
            <Button type="submit" size="sm" variant="secondary" disabled={!password} data-testid="import-pdf-password-open">
              {t('importer.password.open')}
            </Button>
          </form>
          <p className="imp-hint">{t('importer.password.hint')}</p>
        </Notice>
      ) : null}

      {ready ? (
        <>
          <div className="imp-detail__fields">
            <TextField
              label={isSurvey ? t('importer.survey.name') : t('importer.detail.name')}
              hint={isSurvey ? t('importer.survey.nameHint', { example: t('importer.surveyDoc', { table: row.name.trim() || row.filename, name: 'R01' }) }) : undefined}
              value={row.name}
              onChange={(name) => onPatch((r) => ({ ...r, name }))}
              maxLength={LIMITS.nameMax}
              error={!row.name.trim() ? t('importer.detail.nameRequired') : undefined}
              fieldClassName="imp-detail__name"
              data-testid="import-name"
            />
            {!isSurvey ? (
              <Select<DocKind>
                label={t('importer.detail.kind')}
                value={row.kind}
                onChange={onKind}
                disabled={kindOptions(row).length < 2}
                options={kindOptions(row).map((k) => ({ value: k, label: t(`importer.kinds.${k}`) }))}
                fieldClassName="imp-detail__kind"
                data-testid="import-kind"
              />
            ) : null}
          </div>

          {duplicate ? (
            <Notice tone="warning" data-testid="import-duplicate">
              <p>{duplicate.kind === 'project' ? t('importer.duplicate.project', { name: duplicate.name }) : t('importer.duplicate.batch', { name: duplicate.name })}</p>
              <Checkbox checked={row.include} onChange={(include) => onPatch((r) => ({ ...r, include }))} label={t('importer.duplicate.include')} data-testid="import-duplicate-include" />
            </Notice>
          ) : null}

          {sortedWarnings.length ? (
            <Notice tone="warning" data-testid="import-warnings">
              {sortedWarnings.length === 1 ? (
                <p>{say(warningMessage(sortedWarnings[0]!, meta.bcp47), t, tp)}</p>
              ) : (
                <ul className="imp-warnings">
                  {sortedWarnings.map((w) => (
                    <li key={w}>{say(warningMessage(w, meta.bcp47), t, tp)}</li>
                  ))}
                </ul>
              )}
            </Notice>
          ) : null}

          {!isSurvey || !(row.survey && row.survey.layout === 'one-per-respondent' && row.survey.createCases) ? (
            <div className="imp-detail__fields">
              <div className="imp-detail__case">
                <Select<string>
                  label={t('importer.detail.case')}
                  value={caseValue}
                  onChange={(v) => {
                    if (v === NONE) onPatch((r) => ({ ...r, caseChoice: { mode: 'none' } }));
                    else if (v === NEW) onPatch((r) => ({ ...r, caseChoice: { mode: 'new', name: '' } }));
                    else if (v === OTHER) onPatch((r) => ({ ...r, caseChoice: { mode: 'new', name: r.name.trim() || r.filename, custom: true } }));
                    else if (v !== HEAD) onPatch((r) => ({ ...r, caseChoice: { mode: 'existing', id: v } }));
                  }}
                  options={caseOptions}
                  data-testid="import-case"
                />
                {caseValue === OTHER && choice.mode === 'new' ? (
                  <TextField
                    aria-label={t('importer.detail.caseName')}
                    value={choice.name}
                    onChange={(name) => onPatch((r) => ({ ...r, caseChoice: { mode: 'new', name, custom: true } }))}
                    size="sm"
                    maxLength={LIMITS.nameMax}
                    data-testid="import-case-name"
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          <GroupPicker value={row.groups} groups={groups} onChange={(g) => onPatch((r) => ({ ...r, groups: g }))} />

          {row.kind === 'transcript' && row.doc ? <TranscriptOptions row={row} onPatch={onPatch} onAttach={onAttach} onRenameSpeaker={onRenameSpeaker} /> : null}

          {row.table && row.survey ? (
            <SurveyMapping table={row.table} mapping={row.survey} count={surveyCount} onChange={(survey) => onPatch((r) => ({ ...r, survey }))} onSheet={onSheet} />
          ) : null}

          {row.doc && !row.transcribe ? <DocPreview row={row} /> : null}
        </>
      ) : null}
    </div>
  );
}

function TranscriptOptions({
  row,
  onPatch,
  onAttach,
  onRenameSpeaker,
}: {
  row: ReviewRow;
  onPatch: (f: (r: ReviewRow) => ReviewRow) => void;
  onAttach: () => void;
  onRenameSpeaker: (from: string, to: string) => void;
}) {
  const { t, tp, meta } = useI18n();
  const speakers = useMemo(() => speakerSummary(row.doc?.speakers ?? []), [row.doc]);
  return (
    <section className="imp-card" aria-labelledby="imp-transcript-title" data-testid="import-transcript">
      <header className="imp-card__head">
        <h3 id="imp-transcript-title" className="imp-card__title">
          <AudioLines size={15} aria-hidden />
          {t('importer.transcript.title')}
        </h3>
      </header>
      {row.transcribe ? (
        <p className="imp-hint" data-testid="import-to-transcribe">
          {t('importer.recording.note')}
        </p>
      ) : null}
      <div className="imp-speakers" hidden={row.transcribe}>
        <span className="imp-label">{t('importer.transcript.speakers')}</span>
        {speakers.length ? (
          <ul className="imp-speakers__list" data-testid="import-speakers">
            {speakers.map((s) => (
              <SpeakerChip key={s.name} name={s.name} turns={tp('importer.transcript.turns', s.turns)} onRename={(to) => onRenameSpeaker(s.name, to)} />
            ))}
          </ul>
        ) : (
          <p className="imp-hint">{t('importer.transcript.noSpeakers')}</p>
        )}
      </div>
      {row.transcribe ? null : <Switch
        checked={row.autoCodeSpeakers}
        disabled={!speakers.length}
        onChange={(autoCodeSpeakers) => onPatch((r) => ({ ...r, autoCodeSpeakers }))}
        label={t('importer.transcript.autoCode')}
        description={t('importer.transcript.autoCodeHint', { category: t('importer.autocode.speakers') })}
        data-testid="import-autocode-speakers"
      />}
      <div className="imp-recording">
        <span className="imp-label">{t('importer.transcript.recording')}</span>
        {row.media ? (
          <div className="imp-recording__file" data-testid="import-recording">
            <FileAudio size={16} aria-hidden />
            <span className="imp-recording__name" title={row.media.filename}>
              {row.media.filename}
            </span>
            <span className="imp-recording__size">{formatBytes(row.media.bytes.length, meta.bcp47)}</span>
            <Button size="sm" variant="ghost" onClick={onAttach} data-testid="import-recording-replace">
              {t('importer.transcript.replace')}
            </Button>
            {row.transcribe ? null : (
              <IconButton icon={X} size="sm" label={t('importer.transcript.detach')} onClick={() => onPatch((r) => ({ ...r, media: null }))} data-testid="import-recording-remove" />
            )}
          </div>
        ) : (
          <Button size="sm" variant="secondary" icon={FileAudio} onClick={onAttach} data-testid="import-recording-attach">
            {t('importer.transcript.attach')}
          </Button>
        )}
        <p className="imp-hint">{t('importer.transcript.recordingHint')}</p>
      </div>
    </section>
  );
}

function SpeakerChip({ name, turns, onRename }: { name: string; turns: string; onRename: (to: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const anchor = useRef<HTMLButtonElement>(null);
  const clean = value.replace(/\s+/g, ' ').trim();
  return (
    <li>
      <button
        ref={anchor}
        type="button"
        className="imp-speaker"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('importer.transcript.renameOf', { name })} (${turns})`}
        onClick={() => {
          setValue(name);
          setOpen((o) => !o);
        }}
        data-testid="import-speaker"
      >
        <span className="imp-speaker__name">{name}</span>
        <span className="imp-speaker__turns">{turns}</span>
        <Pencil size={11} aria-hidden className="imp-speaker__edit" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} padded aria-label={t('importer.transcript.rename')} className="imp-speaker__pop">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (clean && clean !== name) onRename(clean);
            setOpen(false);
          }}
          className="imp-speaker__form"
        >
          <TextField label={t('importer.transcript.rename')} hint={t('importer.transcript.renameHint', { name })} value={value} onChange={setValue} size="sm" maxLength={LIMITS.codeNameMax} data-autofocus data-testid="import-speaker-name" />
          <Button type="submit" size="sm" variant="primary" disabled={!clean} data-testid="import-speaker-save">
            {t('importer.transcript.renameSave')}
          </Button>
        </form>
      </Popover>
    </li>
  );
}

function DocPreview({ row }: { row: ReviewRow }) {
  const { t } = useI18n();
  const preview = useMemo(() => (row.doc ? previewOf(row.doc) : null), [row.doc]);
  if (!preview) return null;
  const name = row.name || row.filename;
  return (
    <section className="imp-preview" aria-labelledby="imp-preview-title" data-testid="import-preview">
      <div className="imp-preview__head">
        <h3 id="imp-preview-title" className="imp-preview__title">
          {t('importer.preview.title')}
        </h3>
        {preview.truncated ? <span className="imp-preview__note">{t('importer.preview.firstChars')}</span> : null}
      </div>
      <div className="imp-preview__page" tabIndex={0} aria-label={t('importer.preview.label', { name })}>
        {preview.paragraphs.length ? (
          preview.paragraphs.map((p, i) =>
            p.speaker !== null || p.ms !== null ? (
              <p key={i} className="imp-preview__turn">
                {p.ms !== null ? <span className="imp-preview__time">{formatMs(p.ms)}</span> : null}
                {p.speaker !== null ? <span className="imp-preview__speaker">{p.speaker}</span> : null}
                <span>{p.text}</span>
              </p>
            ) : (
              <p key={i} className="imp-preview__p">
                {p.text || ' '}
              </p>
            ),
          )
        ) : (
          <p className="imp-preview__empty">{t('importer.preview.empty')}</p>
        )}
        {preview.truncated ? <p className="imp-preview__more">{t('importer.preview.more')}</p> : null}
      </div>
    </section>
  );
}
