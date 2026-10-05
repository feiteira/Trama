import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookA, BookOpen, Keyboard, SearchX, WifiOff } from 'lucide-react';
import type { ScreenProps } from '../../shell/router';
import { useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useKeyLabel } from '../../shell/keys';
import { useCommands } from '../../shell/useCommands';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Notice } from '../../ui/components/Feedback';
import { SearchField } from '../../ui/components/Field';
import { manualChapters, manualImage } from './manual';
import {
  type Chapter, currentSection, type Excerpt, MIN_QUERY, type Place, queryWords, resolveLink, resolveTopic, searchChapters, type SearchHit, type Section,
  SHORTCUTS_SLUG, topicOf,
} from './manualModel';
import { Markdown } from './Markdown';
import { ShortcutsView, shortcutSections } from './ShortcutsView';
import './help.css';

const idOf = (anchor: string) => `help-${anchor}`;
const INDEX: Place = { slug: 'index', anchor: null };

/** Help: the manual, offline, in the interface language, with search and the shortcuts. */
export default function HelpScreen({ route }: ScreenProps<'help'>) {
  const { t, tp, locale } = useI18n();
  const { go, replace } = useRouter();
  const key = useKeyLabel();
  const mac = key('K').includes('⌘');
  const chapters = useMemo(() => manualChapters(locale), [locale]);
  const resolved = useMemo(() => resolveTopic(route.topic, chapters), [route.topic, chapters]);
  const place = resolved ?? INDEX;
  const missing = !!route.topic && !resolved;
  const isShortcuts = place.slug === SHORTCUTS_SLUG;
  const chapter = isShortcuts ? null : (chapters.find((c) => c.slug === place.slug) ?? chapters[0] ?? null);
  const sectionsHere: Section[] = useMemo(
    () => (isShortcuts ? shortcutSections(t) : (chapter?.sections ?? []).filter((s) => s.level === 2)),
    [isShortcuts, chapter, t],
  );

  const [query, setQuery] = useState('');
  const words = useMemo(() => queryWords(query), [query]);
  const searching = words.join('').length > 0;
  const hits = useMemo(() => (searching ? searchChapters(chapters, query) : []), [chapters, query, searching]);

  const reader = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  // Bumped on every navigation, so choosing the place already shown still scrolls to it.
  const [jump, setJump] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);

  const open = useCallback(
    (p: Place, how: 'go' | 'replace' = 'go') => {
      const next = { name: 'help' as const, topic: topicOf(p) };
      if (how === 'replace') replace(next);
      else go(next);
      setJump((n) => n + 1);
    },
    [go, replace],
  );

  const followLink = useCallback(
    (href: string) => {
      const p = resolveLink(href, place.slug, chapters);
      if (p) open(p, p.slug === place.slug ? 'replace' : 'go');
    },
    [chapters, open, place.slug],
  );
  const linkTarget = useCallback((href: string) => {
    const p = resolveLink(href, place.slug, chapters);
    return p ? topicOf(p) : null;
  }, [chapters, place.slug]);

  // Scroll to the anchor (or the top) whenever the place changes or is chosen again.
  useLayoutEffect(() => {
    const box = reader.current;
    if (!box) return;
    const el = place.anchor ? document.getElementById(idOf(place.anchor)) : null;
    if (el && box.contains(el)) {
      const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 20;
      box.scrollTo({ top: Math.max(0, top) });
      el.focus({ preventScroll: true });
      // A brief mark on the heading that was jumped to.
      el.classList.remove('is-target');
      void el.offsetWidth;
      el.classList.add('is-target');
      setCurrent(place.anchor);
    } else {
      box.scrollTo({ top: 0 });
      setCurrent(null);
    }
  }, [place.slug, place.anchor, jump]);

  // Keep the open chapter visible in the contents (a link from another screen may open one far down).
  useEffect(() => {
    document.querySelector('.toc__chapter.is-here')?.scrollIntoView({ block: 'nearest' });
  }, [place.slug]);

  // Which section is being read: highlighted in the contents.
  useEffect(() => {
    const box = reader.current;
    if (!box) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const base = box.getBoundingClientRect().top;
      const tops = sectionsHere
        .map((s) => ({ anchor: s.anchor, el: document.getElementById(idOf(s.anchor)) }))
        .filter((x): x is { anchor: string; el: HTMLElement } => !!x.el)
        .map((x) => ({ anchor: x.anchor, top: x.el.getBoundingClientRect().top - base }));
      const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
      setCurrent(atEnd && box.scrollTop > 0 ? (tops[tops.length - 1]?.anchor ?? null) : currentSection(tops, box.clientHeight * 0.3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      box.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sectionsHere]);

  // Ctrl/⌘+F or "/" searches the manual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useCommands(
    () => [
      { id: 'help.search', label: t('help.commands.search'), group: t('help.commands.group'), icon: BookOpen, shortcut: key('F'), run: () => search.current?.focus() },
      { id: 'help.shortcuts', label: t('help.commands.shortcuts'), group: t('help.commands.group'), icon: Keyboard, run: () => open({ slug: SHORTCUTS_SLUG, anchor: null }) },
      ...chapters.map((c) => ({ id: `help.ch.${c.slug}`, label: t('help.commands.chapter', { title: c.title }), group: t('help.commands.group'), icon: BookOpen, run: () => open({ slug: c.slug, anchor: null }) })),
    ],
    [t, key, chapters, open],
  );

  const focusResult = (i: number) => {
    const items = results.current?.querySelectorAll<HTMLButtonElement>('button');
    if (!items?.length) return;
    items[Math.max(0, Math.min(items.length - 1, i))]?.focus();
  };

  const idx = chapter ? chapters.indexOf(chapter) : -1;
  const prev = isShortcuts ? chapters[chapters.length - 1] : idx > 0 ? chapters[idx - 1] : undefined;
  const next = isShortcuts ? undefined : idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : undefined;
  const title = isShortcuts ? t('help.keys.title') : (chapter?.title ?? t('help.title'));

  return (
    <>
      <ScreenHeader title={t('help.title')} subtitle={t('help.subtitle')} undo={false} />
      <div className="help" data-testid="screen-help">
        <aside className="help__side">
          <div className="help__search">
            <SearchField
              ref={search}
              value={query}
              onChange={setQuery}
              placeholder={t('help.search')}
              aria-label={t('help.searchHint', { key: key('F') })}
              title={t('help.searchHint', { key: key('F') })}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && hits.length) {
                  e.preventDefault();
                  focusResult(0);
                } else if (e.key === 'Enter' && hits[0]) {
                  e.preventDefault();
                  open({ slug: hits[0].slug, anchor: hits[0].anchor });
                }
              }}
              data-testid="help-search"
            />
          </div>
          {searching ? (
            <div className="help__results" role="region" aria-label={t('help.resultsLabel')} aria-live="polite">
              {query.trim().length < MIN_QUERY && hits.length === 0 ? (
                <p className="help__status">{t('help.typeMore')}</p>
              ) : hits.length === 0 ? (
                <div className="help__none" data-testid="help-no-results">
                  <SearchX size={18} strokeWidth={1.5} aria-hidden />
                  <p>{t('help.noResults', { q: query.trim() })}</p>
                  <p className="t-muted t-small">{t('help.noResultsHint')}</p>
                </div>
              ) : (
                <>
                  <p className="help__status">{tp('help.results', hits.length)}</p>
                  <ul
                    className="help__hits"
                    ref={results}
                    onKeyDown={(e) => {
                      const items = Array.from(results.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
                      const i = items.indexOf(document.activeElement as HTMLButtonElement);
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        focusResult(i + 1);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (i <= 0) search.current?.focus();
                        else focusResult(i - 1);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        search.current?.focus();
                      }
                    }}
                  >
                    {hits.map((h, i) => (
                      <li key={`${h.slug}#${h.anchor ?? ''}#${i}`}>
                        <HitButton hit={h} active={h.slug === place.slug && h.anchor === place.anchor} onOpen={() => open({ slug: h.slug, anchor: h.anchor })} inChapter={t('help.inChapter', { chapter: h.chapter })} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <Contents
              chapters={chapters}
              place={place}
              current={current}
              sections={sectionsHere}
              onOpen={open}
              label={t('help.contentsLabel')}
              heading={t('help.contents')}
              shortcutsLabel={t('help.keys.title')}
              sectionsOf={(title) => t('help.sectionsOf', { title })}
            />
          )}
          <p className="help__offline">
            <WifiOff size={13} strokeWidth={1.75} aria-hidden />
            {t('help.offline')}
          </p>
        </aside>

        <div className="help__reader" ref={reader} tabIndex={0} role="region" aria-label={title} data-testid="help-reader">
          <article className="manual" lang={locale} data-testid={`help-chapter-${place.slug}`}>
            {missing ? (
              <Notice tone="warning" className="manual__missing" data-testid="help-topic-missing">
                {t('help.topicMissing')}
              </Notice>
            ) : null}
            {isShortcuts ? (
              <ShortcutsView mac={mac} idOf={idOf} />
            ) : chapter ? (
              <>
                {chapter.number !== null ? <p className="manual__eyebrow">{t('help.chapterN', { n: chapter.number })}</p> : null}
                <Markdown
                  blocks={chapter.blocks}
                  linkTarget={linkTarget}
                  onLink={followLink}
                  image={manualImage}
                  mac={mac}
                  externalHint={t('help.externalLink')}
                  idOf={idOf}
                />
              </>
            ) : null}
            {prev || next ? (
              <nav className="manual__pager" aria-label={t('help.pager')}>
                {prev ? (
                  <a
                    className="manual__pager-link"
                    href={`#help/${prev.slug}`}
                    onClick={(e) => {
                      e.preventDefault();
                      open({ slug: prev.slug, anchor: null });
                    }}
                    data-testid="help-prev"
                  >
                    <span className="manual__pager-dir">
                      <ArrowLeft size={14} aria-hidden strokeWidth={1.75} />
                      {t('help.previous')}
                    </span>
                    <span className="manual__pager-title">{prev.title}</span>
                  </a>
                ) : (
                  <span />
                )}
                {next ? (
                  <a
                    className="manual__pager-link manual__pager-link--next"
                    href={`#help/${next.slug}`}
                    onClick={(e) => {
                      e.preventDefault();
                      open({ slug: next.slug, anchor: null });
                    }}
                    data-testid="help-next"
                  >
                    <span className="manual__pager-dir">
                      {t('help.next')}
                      <ArrowRight size={14} aria-hidden strokeWidth={1.75} />
                    </span>
                    <span className="manual__pager-title">{next.title}</span>
                  </a>
                ) : null}
              </nav>
            ) : null}
          </article>
        </div>
      </div>
    </>
  );
}

interface ContentsProps {
  chapters: Chapter[];
  place: Place;
  current: string | null;
  sections: Section[];
  onOpen: (p: Place, how?: 'go' | 'replace') => void;
  label: string;
  heading: string;
  shortcutsLabel: string;
  sectionsOf: (title: string) => string;
}

function Contents({ chapters, place, current, sections, onOpen, label, heading, shortcutsLabel, sectionsOf }: ContentsProps) {
  const sectionList = (title: string) =>
    sections.length ? (
      <ul className="toc__sections" aria-label={sectionsOf(title)}>
        {sections.map((s) => (
          <li key={s.anchor}>
            <a
              className={cx('toc__section', current === s.anchor && 'is-current')}
              href={`#help/${place.slug}#${s.anchor}`}
              aria-current={current === s.anchor ? 'location' : undefined}
              onClick={(e) => {
                e.preventDefault();
                onOpen({ slug: place.slug, anchor: s.anchor }, 'replace');
              }}
              data-testid={`help-section-${s.anchor}`}
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <nav className="toc" aria-label={label}>
      <h2 className="toc__heading">{heading}</h2>
      <ol className="toc__chapters">
        {chapters.map((c) => {
          const here = c.slug === place.slug;
          return (
            <li key={c.slug}>
              <a
                className={cx('toc__chapter', here && 'is-here')}
                href={`#help/${c.slug}`}
                aria-current={here ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen({ slug: c.slug, anchor: null });
                }}
                data-testid={`help-toc-${c.slug}`}
              >
                <span className="toc__num" aria-hidden>
                  {c.number ?? (c.slug === 'index' ? <BookOpen size={13} strokeWidth={1.75} /> : <BookA size={13} strokeWidth={1.75} />)}
                </span>
                <span className="toc__title">{c.title}</span>
              </a>
              {here ? sectionList(c.title) : null}
            </li>
          );
        })}
        <li className="toc__extra">
          <a
            className={cx('toc__chapter', place.slug === SHORTCUTS_SLUG && 'is-here')}
            href={`#help/${SHORTCUTS_SLUG}`}
            aria-current={place.slug === SHORTCUTS_SLUG ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onOpen({ slug: SHORTCUTS_SLUG, anchor: null });
            }}
            data-testid="help-toc-shortcuts"
          >
            <span className="toc__num" aria-hidden>
              <Keyboard size={13} strokeWidth={1.75} />
            </span>
            <span className="toc__title">{shortcutsLabel}</span>
          </a>
          {place.slug === SHORTCUTS_SLUG ? sectionList(shortcutsLabel) : null}
        </li>
      </ol>
    </nav>
  );
}

function HitButton({ hit, active, onOpen, inChapter }: { hit: SearchHit; active: boolean; onOpen: () => void; inChapter: string }) {
  return (
    <button type="button" className={cx('hit', active && 'is-here')} onClick={onOpen} data-testid="help-hit">
      <span className="hit__heading">{hit.heading}</span>
      {hit.heading !== hit.chapter ? <span className="hit__chapter">{inChapter}</span> : null}
      {hit.excerpt.text ? (
        <span className="hit__excerpt">
          <Marked excerpt={hit.excerpt} />
        </span>
      ) : null}
    </button>
  );
}

function Marked({ excerpt }: { excerpt: Excerpt }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  excerpt.marks.forEach(([s, e], i) => {
    if (s > at) parts.push(excerpt.text.slice(at, s));
    parts.push(<mark key={i}>{excerpt.text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < excerpt.text.length) parts.push(excerpt.text.slice(at));
  return (
    <>
      {excerpt.cutStart ? '… ' : null}
      {parts}
      {excerpt.cutEnd ? ' …' : null}
    </>
  );
}
