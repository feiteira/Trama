import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { FileDown, FileText, Filter, Folders, Highlighter, History, type LucideIcon, NotebookPen, Package, Redo2, Tags, Undo2, Users, VenetianMask, X } from 'lucide-react';
import type { LogEntry } from '../../core/model/types';
import { csvBytes } from '../../core/export/office/csv';
import { listLog, logAsRows } from '../../services/log';
import { listCoders, type CoderRow } from '../../services/queries';
import { usePlatform, useProject } from '../../shell/AppState';
import { ScreenHeader } from '../../shell/ScreenHeader';
import type { ScreenProps } from '../../shell/router';
import { useCommands } from '../../shell/useCommands';
import { useLive } from '../../shell/useLive';
import { cx } from '../../ui/cx';
import { type MessageKey, useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { EmptyState, Spinner } from '../../ui/components/Feedback';
import { SearchField, Select } from '../../ui/components/Field';
import { Popover } from '../../ui/components/Popover';
import { useToast } from '../../ui/components/Toast';
import { csvDelimiter, saveExport, stamp } from './exportFile';
import {
  ACTION_GROUPS, type ActionGroup, actionsOf, beforeBound, buildSentence, EMPTY_FILTER, filterActive, groupByDay, groupOf, type LogFilter, matchesText,
  onOrAfter, quotesFor, type Quotes, type Sentence, sentenceText, splitTemplate,
} from './sentence';
import './log.css';

const PAGE = 150;

const GROUP_ICON: Record<ActionGroup, LucideIcon> = {
  project: Package,
  documents: FileText,
  codes: Tags,
  coding: Highlighter,
  memos: NotebookPen,
  cases: Users,
  groups: Folders,
  pseudonyms: VenetianMask,
};

function GroupIcon({ group, size = 14 }: { group: ActionGroup; size?: number }) {
  const Icon = GROUP_ICON[group];
  return <Icon size={size} aria-hidden strokeWidth={1.75} className="audit__icon" />;
}

interface Row {
  entry: LogEntry;
  sentence: Sentence;
  template: string;
  text: string;
}

/** The audit trail: every recorded change, newest first, readable and filterable. */
export default function LogScreen(_props: ScreenProps<'log'>) {
  const { t, tp, locale, meta, date, time } = useI18n();
  const project = useProject();
  const platform = usePlatform();
  const toast = useToast();
  const [filter, setFilter] = useState<LogFilter>(EMPTY_FILTER);
  const [limit, setLimit] = useState(PAGE);
  const [exporting, setExporting] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // A new filter starts again from the newest page.
  const groupsKey = filter.groups.join(',');
  useEffect(() => {
    setLimit(PAGE);
    scroller.current?.scrollTo({ top: 0 });
  }, [groupsKey, filter.coderId, filter.to, filter.from]);

  const query = useMemo(
    () => ({ action: filter.groups.length ? actionsOf(filter.groups) : undefined, coderId: filter.coderId ?? undefined, before: beforeBound(filter.to) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupsKey, filter.coderId, filter.to],
  );
  const { data: raw } = useLive(() => listLog(project, { ...query, limit }), [query, limit], ['log']);
  const { data: coders } = useLive(() => listCoders(project), [], ['coder']);
  const coderById = useMemo(() => new Map((coders ?? []).map((c) => [c.coder.id, c])), [coders]);

  const fmtN = useCallback((n: number) => n.toLocaleString(meta.bcp47), [meta.bcp47]);
  const quotes = useMemo(() => quotesFor(locale), [locale]);
  const toRow = useCallback(
    (entry: LogEntry): Row => {
      const sentence = buildSentence(entry, t('log.none'), quotes);
      const template = t(sentence.key as MessageKey);
      return { entry, sentence, template, text: sentenceText(template, sentence, fmtN, quotes) };
    },
    [t, fmtN, quotes],
  );

  const rows = useMemo(() => (raw ?? []).map(toRow), [raw, toRow]);
  const shown = useMemo(
    () => rows.filter((r) => onOrAfter(r.entry.at, filter.from) && matchesText(`${r.text}\n${r.entry.summary}`, filter.text)),
    [rows, filter.from, filter.text],
  );
  const oldest = raw?.[raw.length - 1];
  // More to load: the page came back full, and (with a start date) it has not reached it yet.
  const hasMore = !!raw && raw.length >= limit && !(filter.from && oldest && !onOrAfter(oldest.at, filter.from));
  const days = useMemo(() => groupByDay(shown.map((r) => ({ at: r.entry.at, row: r }))), [shown]);
  const loading = raw === undefined;

  // Infinite scroll: a sentinel under the list asks for the next page as it comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setLimit((l) => (raw && raw.length >= l ? l + PAGE : l)), {
      root: scroller.current,
      rootMargin: '400px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, raw]);

  async function exportCsv() {
    setExporting(true);
    try {
      const all = await listLog(project, { ...query, limit: 10_000_000 });
      const kept = all
        .map(toRow)
        .filter((r) => onOrAfter(r.entry.at, filter.from) && matchesText(`${r.text}\n${r.entry.summary}`, filter.text))
        .sort((a, b) => (a.entry.at < b.entry.at ? -1 : a.entry.at > b.entry.at ? 1 : a.entry.updated_at_hlc < b.entry.updated_at_hlc ? -1 : 1));
      const names = new Map((coders ?? []).map((c) => [c.coder.id, c.coder.name]));
      const body = logAsRows(
        kept.map((r) => r.entry),
        names,
        { header: false },
      );
      const header = [t('log.columns.at'), t('log.columns.coder'), t('log.columns.action'), t('log.columns.summary'), t('log.columns.target_kind'), t('log.columns.target_id'), t('log.columns.sentence')];
      const table = [header, ...body.map((cells, i) => [...cells, kept[i]!.sentence.undo ? `${t(kept[i]!.sentence.undo === 'undo' ? 'log.undone' : 'log.redone')}: ${kept[i]!.text}` : kept[i]!.text])];
      const file = await saveExport(platform, {
        title: t('log.exportTitle'),
        defaultName: `${t('app.nav.log')} ${stamp()}.csv`,
        filter: { name: 'CSV', extensions: ['csv'] },
        bytes: () => csvBytes(table, { delimiter: csvDelimiter(locale) }),
      });
      if (file) {
        await project.log('export', `"${file}"`);
        toast.show({ message: t('log.exported', { file }), tone: 'success' });
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setExporting(false);
    }
  }

  useCommands(() => [{ id: 'log.export', label: t('log.exportTitle'), group: t('app.nav.log'), icon: FileDown, run: () => void exportCsv() }], [t, query, filter.text, filter.from, coders]);

  const today = DateTime.now().toISODate();
  const yesterday = DateTime.now().minus({ days: 1 }).toISODate();
  const dayLabel = (day: string) => (day === today ? t('log.today') : day === yesterday ? t('log.yesterday') : date(DateTime.fromISO(day), 'long'));
  const active = filterActive(filter);

  return (
    <>
      <ScreenHeader
        title={t('app.nav.log')}
        subtitle={raw ? (active ? tp('log.shown', shown.length) + (hasMore ? '+' : '') : tp('log.entries', shown.length) + (hasMore ? '+' : '')) : undefined}
        actions={
          <Button icon={FileDown} onClick={() => void exportCsv()} busy={exporting} disabled={!raw?.length} data-testid="log-export">
            {t('log.exportCsv')}
          </Button>
        }
      />
      <div className="audit" ref={scroller} data-testid="screen-log">
        <div className="audit__column">
          <p className="audit__intro">
            <History size={15} aria-hidden strokeWidth={1.75} />
            <span>{t('log.intro')}</span>
          </p>
          <Filters filter={filter} onChange={setFilter} coders={coders ?? []} />

          {loading ? (
            <div className="audit__loading">
              <Spinner size={18} label={t('common.loading')} />
            </div>
          ) : shown.length === 0 && !hasMore ? (
            active ? (
              <EmptyState icon={Filter} title={t('log.noMatch.title')} className="audit__empty" data-testid="log-nomatch" actions={<Button onClick={() => setFilter(EMPTY_FILTER)}>{t('log.clearFilters')}</Button>}>
                {t('log.noMatch.body')}
              </EmptyState>
            ) : (
              <EmptyState icon={History} title={t('log.empty.title')} className="audit__empty" data-testid="log-empty">
                {t('log.empty.body')}
              </EmptyState>
            )
          ) : (
            <div className="audit__days" data-testid="log-list">
              {days.map((d) => (
                <section key={d.day} className="audit__day" aria-labelledby={`day-${d.day}`}>
                  <h2 className="audit__day-title" id={`day-${d.day}`}>
                    <span>{dayLabel(d.day)}</span>
                    <span className="audit__day-count">{d.items.length}</span>
                  </h2>
                  <ol className="audit__entries">
                    {d.items.map(({ row }) => (
                      <EntryRow key={row.entry.id} row={row} coder={row.entry.coder_id ? coderById.get(row.entry.coder_id) : undefined} time={time(DateTime.fromISO(row.entry.at))} fmtN={fmtN} quotes={quotes} />
                    ))}
                  </ol>
                </section>
              ))}
              <div ref={sentinel} className="audit__foot">
                {hasMore ? (
                  <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)} data-testid="log-more">
                    {t('log.loadMore')}
                  </Button>
                ) : (
                  <span className="audit__end">{t('log.end')}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const EntryRow = memo(function EntryRow({ row, coder, time, fmtN, quotes }: { row: Row; coder: CoderRow | undefined; time: string; fmtN: (n: number) => string; quotes: Quotes }) {
  const { t } = useI18n();
  const { sentence, entry } = row;
  const names = (xs: string[]) =>
    xs.map((x, i) => (
      <React.Fragment key={i}>
        {i ? ', ' : null}
        <span className="audit__name">
          {quotes[0]}
          {x}
          {quotes[1]}
        </span>
      </React.Fragment>
    ));
  const parts = splitTemplate(row.template);
  return (
    <li className={cx('audit__entry', sentence.undo && 'audit__entry--undo')} data-testid="log-entry" data-action={entry.action}>
      <time className="audit__time" dateTime={entry.at}>
        {time}
      </time>
      <span className="audit__mark">
        <GroupIcon group={groupOf(entry.action)} />
      </span>
      <div className="audit__text">
        {sentence.undo ? (
          <span className="audit__undo">
            {sentence.undo === 'undo' ? <Undo2 size={12} aria-hidden /> : <Redo2 size={12} aria-hidden />}
            {t(sentence.undo === 'undo' ? 'log.undone' : 'log.redone')}
          </span>
        ) : null}
        <span className="audit__sentence">
          {parts.map((p, i) =>
            'text' in p ? (
              <React.Fragment key={i}>{p.text}</React.Fragment>
            ) : p.slot === 'n' ? (
              <React.Fragment key={i}>{sentence.vars.n === null ? '' : fmtN(sentence.vars.n)}</React.Fragment>
            ) : (
              <React.Fragment key={i}>{names(sentence.vars[p.slot])}</React.Fragment>
            ),
          )}
        </span>
        {sentence.detail ? <span className="audit__detail">{sentence.detail}</span> : null}
      </div>
      <span className="audit__coder" title={coder?.coder.name}>
        {coder ? (
          <>
            <span className="audit__dot" style={{ background: coder.coder.color }} aria-hidden />
            <span className="audit__coder-name">{coder.coder.name}</span>
          </>
        ) : (
          <span className="audit__coder-name t-muted">{entry.coder_id ? t('log.unknownCoder') : t('log.system')}</span>
        )}
      </span>
    </li>
  );
});

function Filters({ filter, onChange, coders }: { filter: LogFilter; onChange: (f: LogFilter) => void; coders: CoderRow[] }) {
  const { t, tp } = useI18n();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const set = (patch: Partial<LogFilter>) => onChange({ ...filter, ...patch });
  const toggle = (g: ActionGroup, on: boolean) => set({ groups: on ? [...filter.groups, g] : filter.groups.filter((x) => x !== g) });
  const groupLabel = filter.groups.length === 0 ? t('log.allActions') : filter.groups.length === 1 ? t(`log.groups.${filter.groups[0]!}`) : tp('log.actionsChosen', filter.groups.length);
  return (
    <div className="audit__filters" role="search" aria-label={t('log.filters')}>
      <SearchField value={filter.text} onChange={(text) => set({ text })} placeholder={t('log.search')} aria-label={t('log.search')} size="sm" fieldClassName="audit__search" data-testid="log-search" />
      <Button
        ref={anchor}
        size="sm"
        variant="secondary"
        icon={Filter}
        className={cx('audit__groups', filter.groups.length > 0 && 'audit__groups--on')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="log-groups"
      >
        {groupLabel}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} padded aria-label={t('log.allActions')} className="audit__group-pop" data-testid="log-groups-pop">
        <div className="audit__group-list">
          {ACTION_GROUPS.map((g) => (
            <Checkbox key={g} checked={filter.groups.includes(g)} onChange={(on) => toggle(g, on)} label={
                <span className="audit__group-label">
                  <GroupIcon group={g} />
                  {t(`log.groups.${g}`)}
                </span>
              } data-testid={`log-group-${g}`} />
          ))}
        </div>
      </Popover>
      {coders.length > 1 ? (
        <Select<string>
          aria-label={t('log.coder')}
          size="sm"
          value={filter.coderId ?? ''}
          onChange={(v) => set({ coderId: v || null })}
          options={[{ value: '', label: t('log.allCoders') }, ...coders.map((c) => ({ value: c.coder.id, label: c.coder.name }))]}
          data-testid="log-coder"
        />
      ) : null}
      <div className="audit__date" role="group" aria-label={`${t('log.from')} – ${t('log.to')}`}>
        <span aria-hidden>{t('log.from')}</span>
        <input type="date" aria-label={t('log.from')} value={filter.from ?? ''} max={filter.to ?? undefined} onChange={(e) => set({ from: e.target.value || null })} data-testid="log-from" />
        <span aria-hidden>{t('log.to').toLocaleLowerCase()}</span>
        <input type="date" aria-label={t('log.to')} value={filter.to ?? ''} min={filter.from ?? undefined} onChange={(e) => set({ to: e.target.value || null })} data-testid="log-to" />
      </div>
      {filterActive(filter) ? (
        <Button size="sm" variant="ghost" icon={X} onClick={() => onChange(EMPTY_FILTER)} data-testid="log-clear">
          {t('log.clearFilters')}
        </Button>
      ) : null}
    </div>
  );
}
