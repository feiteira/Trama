import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, EyeOff, Scale, Table as TableIcon, WholeWord } from 'lucide-react';
import { SETTING_KEYS } from '../../../core/model/types';
import { kwic, searchTexts } from '../../../core/qda/search';
import { STOPWORD_LANGUAGES } from '../../../core/qda/stopwords';
import type { Span } from '../../../core/qda/util';
import { codedTexts, compareFrequencies, type TextInput, type WordCount, wordFrequencies } from '../../../core/qda/wordfreq';
import { useProject } from '../../../shell/AppState';
import { useRouter } from '../../../shell/router';
import { Button, IconButton } from '../../../ui/components/Button';
import { Checkbox, RadioGroup } from '../../../ui/components/Choice';
import { Notice, Spinner } from '../../../ui/components/Feedback';
import { Select, TextArea, TextField } from '../../../ui/components/Field';
import { useToast } from '../../../ui/components/Toast';
import { useI18n } from '../../../ui/i18n';
import { TipRow } from '../charts/ChartTip';
import { WordCloud } from '../charts/WordCloud';
import { formatFixed, formatP, formatPercent, formatValue } from '../lib/format';
import { SERIES } from '../lib/heat';
import { groupKwic, hitsWithin, countPerDocument } from '../lib/kwic';
import { compareCorpora, keynessRows } from '../lib/words';
import { useAnalysisData, useDeferredCompute, useTexts, useTheme } from '../parts/data';
import { useExporter } from '../parts/exporting';
import { KwicList } from '../parts/KwicList';
import { ExportMenu, PanelSection, ResultsHead, ResultsMessage, Sheet, ToolLayout } from '../parts/ui';
import { useToolSettings } from '../parts/useToolSettings';

type Scope = 'all' | 'group' | 'code';
type View = 'cloud' | 'table' | 'compare';
const TABLE_MAX = 500;
const CLOUD_MAX = 80;

const DEFAULTS = {
  scope: 'all' as Scope,
  groupId: '',
  codeId: '',
  subcodes: true,
  language: '' as string,
  minLength: 3,
  numbers: false,
  view: 'cloud' as View,
  groupA: '',
  groupB: '',
};

export function WordsTool() {
  const { t, tp, locale } = useI18n();
  const project = useProject();
  const { go } = useRouter();
  const toast = useToast();
  const data = useAnalysisData();
  const { documents, groups, lines, codings, segments } = data;
  const theme = useTheme();
  const exporter = useExporter();
  const [s, set] = useToolSettings('words', DEFAULTS, { scope: ['all', 'group', 'code'], view: ['cloud', 'table', 'compare'] });
  const texts = useTexts(true);
  const [word, setWord] = useState<string | null>(null);
  const [minText, setMinText] = useState(String(s.minLength));
  const [stopText, setStopText] = useState(data.extraStopwords.join('\n'));
  const savedStops = useRef(data.extraStopwords.join('\n'));
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const next = data.extraStopwords.join('\n');
    // Saved elsewhere (or by "Leave out"): follow, unless the researcher is editing the list.
    setStopText((cur) => (cur === savedStops.current ? next : cur));
    savedStops.current = next;
  }, [data.extraStopwords]);

  const language = s.language === '' ? data.language : s.language === 'none' ? null : s.language;
  const opts = useMemo(() => ({ language, extraStopwords: data.extraStopwords, minLength: s.minLength, includeNumbers: s.numbers }), [language, data.extraStopwords, s.minLength, s.numbers]);

  const docsOf = (scope: Scope, groupId: string) => (scope === 'group' ? documents.filter((d) => d.group_ids.includes(groupId)) : documents);
  const codeIds = useMemo(() => (s.codeId ? [s.codeId, ...(s.subcodes ? data.descendants(s.codeId).map((c) => c.id) : [])] : []), [s.codeId, s.subcodes, data]);
  const scopeReady = s.scope === 'all' || (s.scope === 'group' && !!s.groupId) || (s.scope === 'code' && !!s.codeId);

  const inputs = useMemo((): TextInput[] | null => {
    if (!texts || !scopeReady) return null;
    if (s.scope === 'code') return codedTexts(codings, codeIds, { texts });
    return docsOf(s.scope, s.groupId).map((d) => ({ id: d.id, text: texts.get(d.id) ?? '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texts, scopeReady, s.scope, s.groupId, codings, codeIds, documents]);

  const freq = useDeferredCompute(() => (inputs ? wordFrequencies(inputs, opts) : null), [inputs, opts]);
  const f = freq.value;

  const compare = useDeferredCompute(() => {
    if (s.view !== 'compare' || !texts || !s.groupA) return null;
    const { a, b, shared } = compareCorpora(documents, s.groupA, s.groupB);
    const res = compareFrequencies(
      a.map((d) => ({ id: d.id, text: texts.get(d.id) ?? '' })),
      b.map((d) => ({ id: d.id, text: texts.get(d.id) ?? '' })),
      { ...opts, limit: 200, minCount: 3 },
    );
    return { ...res, docsA: a.length, docsB: b.length, shared };
  }, [s.view, texts, s.groupA, s.groupB, documents, opts]);

  // KWIC for the word clicked: whole word, in the scope's documents (inside the code's segments).
  const kwicGroups = useMemo(() => {
    if (!word || !texts) return null;
    const docs = s.scope === 'group' && s.view !== 'compare' ? docsOf('group', s.groupId) : documents;
    const r = searchTexts(
      docs.map((d) => ({ id: d.id, text: texts.get(d.id) ?? '' })),
      { query: word, mode: 'phrase', wholeWord: true, caseSensitive: false, accentSensitive: true },
      { limit: s.scope === 'code' ? Number.MAX_SAFE_INTEGER : 2000, context: 90 },
    );
    let hits = r.hits;
    let per = r.perDocument;
    if (s.scope === 'code' && s.view !== 'compare') {
      const ids = new Set(codeIds);
      const spans = new Map<string, Span[]>();
      for (const c of codings) {
        if (!ids.has(c.code_id)) continue;
        const l = spans.get(c.document_id);
        if (l) l.push({ start: c.start, end: c.end });
        else spans.set(c.document_id, [{ start: c.start, end: c.end }]);
      }
      hits = hitsWithin(hits, spans).slice(0, 2000);
      per = countPerDocument(hitsWithin(r.hits, spans));
    }
    return { groups: groupKwic(kwic(hits, 70), docs, per), total: [...per.values()].reduce((a, b) => a + b, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, texts, s.scope, s.groupId, s.view, codeIds, codings, documents]);

  const saveStops = async (list: string[]) => {
    const clean = [...new Set(list.map((w) => w.trim().toLowerCase()).filter(Boolean))];
    try {
      await project.store.put('setting', { id: SETTING_KEYS.extraStopwords, value: clean });
      savedStops.current = clean.join('\n');
      setStopText(clean.join('\n'));
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  };
  const leaveOut = async (w: string) => {
    if (await saveStops([...data.extraStopwords, w])) {
      toast.show({
        message: t('analysis.words.leftOut', { word: w }),
        action: { label: t('common.undo'), run: () => saveStops(data.extraStopwords.filter((x) => x !== w)) },
      });
      if (word === w) setWord(null);
    }
  };

  const doTable = (format: 'csv' | 'xlsx') => {
    if (s.view === 'compare') {
      const c = compare.value;
      if (!c) return;
      const ga = groups.find((g) => g.id === s.groupA)?.name ?? 'A';
      const gb = s.groupB ? groups.find((g) => g.id === s.groupB)?.name ?? 'B' : t('analysis.words.restOfDocs');
      const rows = keynessRows(c.rows, [t('analysis.words.col.word'), ga, gb, `${ga} /10k`, `${gb} /10k`, 'LL (G²)', 'p', 'log2 ratio', t('analysis.words.col.more')], ga, gb);
      void exporter.table(t('analysis.words.compareExportName'), format, rows, t('analysis.words.compare'));
      return;
    }
    if (!f) return;
    const rows: (string | number)[][] = [[t('analysis.words.col.word'), t('analysis.words.col.count'), t('analysis.words.col.documents'), t('analysis.words.col.percent')]];
    for (const w of f.words) rows.push([w.word, w.count, w.documents, Math.round(w.percent * 100) / 100]);
    void exporter.table(t('analysis.words.exportName'), format, rows, t('analysis.tools.words'));
  };

  const langOptions = [
    { value: '', label: data.language ? t('analysis.words.projectLanguage', { lang: langName(data.language) }) : t('analysis.words.projectLanguageNone') },
    ...STOPWORD_LANGUAGES.map((l) => ({ value: l, label: langName(l) })),
    { value: 'none', label: t('analysis.words.noStopwords') },
  ];
  function langName(code: string): string {
    const k = code.toLowerCase().split(/[-_]/)[0] as (typeof STOPWORD_LANGUAGES)[number];
    return (STOPWORD_LANGUAGES as readonly string[]).includes(k) ? t(`analysis.words.languages.${k}`) : code;
  }

  const groupOpts = [{ value: '', label: t('analysis.pickGroup') }, ...groups.map((g) => ({ value: g.id, label: g.name }))];
  const codeOpts = [{ value: '', label: t('analysis.search.pickCode') }, ...lines.map((l) => ({ value: l.id, label: `${' '.repeat(l.depth)}${l.name}${segments.get(l.id) ? ` (${segments.get(l.id)})` : ''}` }))];

  const panel = (
    <div className="an-form">
      <PanelSection title={t('analysis.words.scope')}>
        <Select<Scope>
          value={s.scope}
          onChange={(scope) => set({ scope })}
          aria-label={t('analysis.words.scope')}
          size="sm"
          options={[
            { value: 'all', label: t('analysis.words.scopes.all') },
            { value: 'group', label: t('analysis.words.scopes.group'), disabled: !groups.length },
            { value: 'code', label: t('analysis.words.scopes.code') },
          ]}
          data-testid="words-scope"
        />
        {s.scope === 'group' ? <Select<string> value={s.groupId} onChange={(groupId) => set({ groupId })} options={groupOpts} size="sm" aria-label={t('analysis.words.scopes.group')} data-testid="words-group" /> : null}
        {s.scope === 'code' ? (
          <>
            <Select<string> value={s.codeId} onChange={(codeId) => set({ codeId })} options={codeOpts} size="sm" aria-label={t('analysis.words.scopes.code')} data-testid="words-code" />
            <Checkbox label={t('analysis.includeSubcodes')} checked={s.subcodes} onChange={(subcodes) => set({ subcodes })} />
          </>
        ) : null}
      </PanelSection>
      <PanelSection title={t('analysis.words.counting')}>
        <Select<string> label={t('analysis.words.language')} value={s.language} onChange={(language) => set({ language })} options={langOptions} size="sm" data-testid="words-language" />
        {s.language === '' && !data.language ? (
          <p className="an-hint" data-testid="words-language-unset">
            {t('analysis.words.languageUnset')}{' '}
            <button type="button" className="an-linkbtn" onClick={() => go({ name: 'settings' })} data-testid="words-set-language">
              {t('analysis.words.setLanguage')}
            </button>
          </p>
        ) : null}
        <TextField
          label={t('analysis.words.minLength')}
          type="number"
          min={1}
          max={30}
          size="sm"
          value={minText}
          onChange={(v) => {
            setMinText(v);
            const n = Math.round(Number(v));
            if (v.trim() !== '' && n >= 1 && n <= 30) set({ minLength: n });
          }}
          data-testid="words-minlength"
        />
        <Checkbox label={t('analysis.words.numbers')} checked={s.numbers} onChange={(numbers) => set({ numbers })} />
      </PanelSection>
      <PanelSection title={t('analysis.words.stopwords')}>
        <TextArea
          value={stopText}
          onChange={setStopText}
          rows={4}
          aria-label={t('analysis.words.stopwords')}
          hint={t('analysis.words.stopwordsHint')}
          spellCheck={false}
          data-testid="words-stopwords"
        />
        <div className="an-inline-actions">
          <Button size="sm" variant="secondary" disabled={stopText === savedStops.current} onClick={() => void saveStops(stopText.split(/[\n,;]+/))} data-testid="words-stopwords-save">
            {t('common.save')}
          </Button>
        </div>
      </PanelSection>
      {s.view === 'compare' ? (
        <PanelSection title={t('analysis.words.compare')}>
          <Select<string> label={t('analysis.words.groupA')} value={s.groupA} onChange={(groupA) => set({ groupA })} options={groupOpts} size="sm" data-testid="words-group-a" />
          <Select<string>
            label={t('analysis.words.groupB')}
            value={s.groupB}
            onChange={(groupB) => set({ groupB })}
            options={[{ value: '', label: t('analysis.words.restOfDocs') }, ...groups.filter((g) => g.id !== s.groupA).map((g) => ({ value: g.id, label: g.name }))]}
            size="sm"
            data-testid="words-group-b"
          />
        </PanelSection>
      ) : null}
    </div>
  );

  const tip = (w: WordCount) => (
    <>
      <div className="an-tip__title">{w.word}</div>
      <TipRow value={formatValue(w.count, locale)} label={t('analysis.words.occurrences')} />
      <TipRow value={formatValue(w.documents, locale)} label={t('analysis.words.inDocs')} />
      <div className="an-tip__hint">{t('analysis.words.clickForContext')}</div>
    </>
  );

  let body: React.ReactNode;
  if (s.view === 'compare') {
    body = <CompareView groups={groups} groupA={s.groupA} groupB={s.groupB} value={compare.value} busy={compare.busy} theme={theme} onWord={setWord} />;
  } else if (!scopeReady) {
    body = <ResultsMessage icon={WholeWord} title={t('analysis.words.pickScope')} />;
  } else if (freq.error) {
    body = (
      <div className="an-pad">
        <Notice tone="danger">{String(freq.error)}</Notice>
      </div>
    );
  } else if (!f) {
    body = (
      <div className="an__center">
        <Spinner size={20} label={t('analysis.computing')} />
      </div>
    );
  } else if (!f.words.length && !documents.length) {
    body = (
      <ResultsMessage icon={WholeWord} title={t('analysis.words.noDocs')} testId="words-empty">
        <p>{t('analysis.words.noDocsBody')}</p>
        <Button size="sm" variant="secondary" onClick={() => go({ name: 'import' })} data-testid="words-import">
          {t('analysis.words.importDocs')}
        </Button>
      </ResultsMessage>
    );
  } else if (!f.words.length && f.totalTokens === 0) {
    // Nothing to count at all, as opposed to every word being left out by the settings.
    body = (
      <ResultsMessage icon={WholeWord} title={t('analysis.words.noText')} testId="words-empty">
        {s.scope === 'code' ? t('analysis.words.noTextCode') : t('analysis.words.noTextBody')}
      </ResultsMessage>
    );
  } else if (!f.words.length) {
    body = <ResultsMessage icon={WholeWord} title={t('analysis.words.none')}>{t('analysis.words.noneBody')}</ResultsMessage>;
  } else if (s.view === 'cloud') {
    body = (
      <div className="an-chartwrap">
        <WordCloud ref={svg} words={f.words.slice(0, CLOUD_MAX)} theme={theme} label={t('analysis.words.cloudLabel', { n: Math.min(CLOUD_MAX, f.words.length) })} onWord={setWord} tip={tip} />
        <p className="an-caption">{t('analysis.words.cloudCaption', { n: Math.min(CLOUD_MAX, f.words.length) })}</p>
      </div>
    );
  } else {
    body = (
      <div className="an-wtable-wrap">
        <table className="an-wtable" data-testid="words-table">
          <caption className="visually-hidden">{t('analysis.tools.words')}</caption>
          <thead>
            <tr>
              <th scope="col" className="an-wtable__rank">#</th>
              <th scope="col">{t('analysis.words.col.word')}</th>
              <th scope="col" className="an-num">{t('analysis.words.col.count')}</th>
              <th scope="col" className="an-num">{t('analysis.words.col.documents')}</th>
              <th scope="col" className="an-num">{t('analysis.words.col.percent')}</th>
              <th scope="col" className="an-wtable__bar" aria-hidden />
              <th scope="col"><span className="visually-hidden">{t('analysis.words.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {f.words.slice(0, TABLE_MAX).map((w, i) => (
              <tr key={w.word}>
                <td className="an-wtable__rank">{i + 1}</td>
                <td>
                  <button type="button" className="an-wordlink" onClick={() => setWord(w.word)} data-testid="words-word">
                    {w.word}
                  </button>
                </td>
                <td className="an-num">{formatValue(w.count, locale)}</td>
                <td className="an-num">{formatValue(w.documents, locale)}</td>
                <td className="an-num">{formatPercent(w.percent, locale, 2)}</td>
                <td className="an-wtable__bar" aria-hidden>
                  <span style={{ width: `${(w.count / f.words[0]!.count) * 100}%`, background: SERIES[theme].a }} />
                </td>
                <td className="an-wtable__act">
                  <IconButton icon={EyeOff} size="sm" label={t('analysis.words.leaveOut', { word: w.word })} onClick={() => void leaveOut(w.word)} data-testid="words-leave-out" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {f.words.length > TABLE_MAX ? <p className="an-caption">{t('analysis.words.tableLimit', { n: TABLE_MAX, total: formatValue(f.words.length, locale) })}</p> : null}
      </div>
    );
  }

  const busy = s.view === 'compare' ? compare.busy : freq.busy;
  return (
    <ToolLayout
      label={t('analysis.tools.words')}
      panel={panel}
      testId="tool-words"
      sheet={
        word ? (
          <Sheet
            open
            onClose={() => setWord(null)}
            title={`“${word}”`}
            subtitle={kwicGroups ? tp('analysis.search.hits', kwicGroups.total) : undefined}
            testId="words-sheet"
          >
            <div className="an-sheet__tools">
              <Button size="sm" variant="ghost" icon={EyeOff} onClick={() => void leaveOut(word)}>
                {t('analysis.words.leaveOutShort')}
              </Button>
            </div>
            {kwicGroups ? <KwicList groups={kwicGroups.groups} label={t('analysis.words.contextOf', { word })} dense testId="words-kwic" /> : <Spinner size={18} />}
          </Sheet>
        ) : null
      }
    >
      <ResultsHead
        title={s.view === 'compare' ? t('analysis.words.compareTitle') : f ? tp('analysis.words.distinct', f.distinctWords) : t('analysis.results')}
        meta={
          <>
            {s.view !== 'compare' && f ? t('analysis.words.tokens', { counted: formatValue(f.countedTokens, locale), total: formatValue(f.totalTokens, locale) }) : null}
            {busy ? <span className="an-inline-spin"><Spinner size={12} /></span> : null}
          </>
        }
      >
        <RadioGroup<View>
          label={t('analysis.view')}
          hideLabel
          variant="segmented"
          value={s.view}
          onChange={(view) => set({ view })}
          options={[
            { value: 'cloud', label: <span className="an-seg-opt"><Cloud size={13} aria-hidden />{t('analysis.words.cloud')}</span> },
            { value: 'table', label: <span className="an-seg-opt"><TableIcon size={13} aria-hidden />{t('analysis.words.table')}</span> },
            { value: 'compare', label: <span className="an-seg-opt"><Scale size={13} aria-hidden />{t('analysis.words.compareShort')}</span>, disabled: groups.length === 0 },
          ]}
          data-testid="words-view"
        />
        <ExportMenu
          tables={doTable}
          images={s.view === 'cloud' ? (fmt) => void exporter.image(t('analysis.words.exportName'), fmt, svg.current, theme) : undefined}
          disabled={s.view === 'compare' ? !compare.value : !f?.words.length}
          testId="words-export"
        />
      </ResultsHead>
      <div className={`an-results__body an-results__body--scroll${busy && (f || compare.value) ? ' an-results__body--stale' : ''}`}>{body}</div>
    </ToolLayout>
  );
}

/** Keyness: the words most distinctive of group A against group B (log-likelihood). */
function CompareView({
  groups,
  groupA,
  groupB,
  value,
  busy,
  theme,
  onWord,
}: {
  groups: readonly { id: string; name: string }[];
  groupA: string;
  groupB: string;
  value: (ReturnType<typeof compareFrequencies> & { docsA: number; docsB: number; shared: number }) | null | undefined;
  busy: boolean;
  theme: 'light' | 'dark';
  onWord: (w: string) => void;
}) {
  const { t, tp, locale } = useI18n();
  if (!groupA) return <ResultsMessage icon={Scale} title={t('analysis.words.comparePick')}>{t('analysis.words.comparePickBody')}</ResultsMessage>;
  if (!value)
    return busy ? (
      <div className="an__center">
        <Spinner size={20} label={t('analysis.computing')} />
      </div>
    ) : null;
  const nameA = groups.find((g) => g.id === groupA)?.name ?? 'A';
  const nameB = groupB ? groups.find((g) => g.id === groupB)?.name ?? 'B' : t('analysis.words.restOfDocs');
  const rows = value.rows.filter((r) => r.p < 0.05).slice(0, 60);
  const maxLr = Math.max(1, ...rows.map((r) => (Number.isFinite(r.logRatio) ? Math.abs(r.logRatio) : 0)));
  const col = SERIES[theme];
  if (!rows.length) return <ResultsMessage icon={Scale} title={t('analysis.words.compareNone')}>{t('analysis.words.compareNoneBody')}</ResultsMessage>;
  return (
    <div className="an-wtable-wrap">
      <div className="an-legend an-legend--top" aria-hidden>
        <span className="an-legend__item">
          <span className="an-legend__swatch" style={{ background: col.a }} />
          {t('analysis.words.moreIn', { group: nameA })}
        </span>
        <span className="an-legend__item">
          <span className="an-legend__swatch" style={{ background: col.b }} />
          {t('analysis.words.moreIn', { group: nameB })}
        </span>
      </div>
      <table className="an-wtable" data-testid="words-compare">
        <thead>
          <tr>
            <th scope="col">{t('analysis.words.col.word')}</th>
            <th scope="col" className="an-num">{nameA}</th>
            <th scope="col" className="an-num">{nameB}</th>
            <th scope="col" className="an-wtable__div">{t('analysis.words.col.leaning')}</th>
            <th scope="col" className="an-num">G²</th>
            <th scope="col" className="an-num">p</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const lr = Number.isFinite(r.logRatio) ? r.logRatio : r.overused === 'A' ? maxLr : -maxLr;
            const w = (Math.abs(lr) / maxLr) * 50;
            return (
              <tr key={r.word}>
                <td>
                  <button type="button" className="an-wordlink" onClick={() => onWord(r.word)}>
                    {r.word}
                  </button>
                </td>
                <td className="an-num">{formatValue(r.countA, locale)}</td>
                <td className="an-num">{formatValue(r.countB, locale)}</td>
                <td className="an-wtable__div" aria-label={r.overused === 'A' ? t('analysis.words.moreIn', { group: nameA }) : t('analysis.words.moreIn', { group: nameB })}>
                  <span className="an-div">
                    <span className="an-div__mid" />
                    <span className="an-div__bar" style={lr >= 0 ? { left: '50%', width: `${w}%`, background: col.a } : { right: '50%', width: `${w}%`, background: col.b }} />
                  </span>
                </td>
                <td className="an-num">{formatFixed(r.logLikelihood, locale, 1)}</td>
                <td className="an-num">{formatP(r.p, locale)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="an-caption">
        {t('analysis.words.compareCaption', { a: nameA, b: nameB, docsA: value.docsA, docsB: value.docsB })}
        {value.shared ? ` ${tp('analysis.words.compareShared', value.shared)}` : ''}
      </p>
    </div>
  );
}
