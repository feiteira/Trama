import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCheck, ExternalLink } from 'lucide-react';
import type { Code, Coder, Coding } from '../../core/model/types';
import { removeCoding } from '../../services/codings';
import { useProject } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useUndo } from '../../shell/undo';
import { withAlpha } from '../../ui/color';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Select } from '../../ui/components/Field';
import { Spinner } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import {
  type DisagreementItem,
  EMPTY_REVIEW,
  fmtInt,
  fmtPercent,
  isResolved,
  passageWindow,
  pieces,
  type Resolution,
  resolutionRemoves,
  reviewAfter,
  type ReviewState,
} from './model';

const PAGE = 200;
const ALL = '__all__';

export interface DisagreementsProps {
  items: readonly DisagreementItem[];
  codingsById: ReadonlyMap<string, Coding>;
  codingsA: readonly Coding[];
  codingsB: readonly Coding[];
  coderA: Coder;
  coderB: Coder;
  codes: ReadonlyMap<string, Code>;
  docNames: ReadonlyMap<string, string>;
  /** Documents in display order (for the filter). */
  documentIds: readonly string[];
  threshold: number;
  filterDoc: string | null;
  onFilterDoc: (id: string | null) => void;
}

/** The disagreeing segments, and the passage of the one selected with both coders' codings. */
export function Disagreements(p: DisagreementsProps) {
  const { t, tp, meta } = useI18n();
  const [review, setReview] = useState<ReviewState>(EMPTY_REVIEW);
  const [hideResolved, setHideResolved] = useState(true);
  const [codeFilter, setCodeFilter] = useState<string>(ALL);
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const lastIndex = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const liveIds = useMemo(() => new Set(p.codingsById.keys()), [p.codingsById]);
  const resolved = useCallback((i: DisagreementItem) => isResolved(i, review, liveIds), [review, liveIds]);
  const open = useMemo(() => p.items.filter((i) => !resolved(i)).length, [p.items, resolved]);
  const visible = useMemo(
    () =>
      p.items.filter(
        (i) => (!p.filterDoc || i.documentId === p.filterDoc) && (codeFilter === ALL || i.codeId === codeFilter) && (!hideResolved || !resolved(i)),
      ),
    [p.items, p.filterDoc, codeFilter, hideResolved, resolved],
  );
  const codeOptions = useMemo(() => {
    const ids = new Set(p.items.map((i) => i.codeId));
    return [...ids].map((id) => ({ value: id, label: p.codes.get(id)?.name ?? '?' })).sort((a, b) => a.label.localeCompare(b.label, meta.bcp47));
  }, [p.items, p.codes, meta.bcp47]);

  // Keep a selection: the same item, else the one now at the place of the last one.
  const current = useMemo(() => {
    const i = visible.findIndex((x) => x.key === selected);
    if (i >= 0) return visible[i]!;
    return visible[Math.min(lastIndex.current, visible.length - 1)] ?? null;
  }, [visible, selected]);
  const currentIndex = current ? visible.indexOf(current) : -1;
  useEffect(() => {
    if (currentIndex >= 0) lastIndex.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    if (currentIndex >= limit) setLimit((l) => Math.max(l, currentIndex + 1));
  }, [currentIndex, limit]);
  useEffect(() => {
    if (!current) return;
    // Scroll the list only: scrollIntoView would also scroll the screen to this section.
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(current.key)}"]`);
    if (!list || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [current]);

  const select = (i: number) => {
    const it = visible[Math.max(0, Math.min(visible.length - 1, i))];
    if (it) setSelected(it.key);
  };
  const onListKey = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = {
      ArrowDown: currentIndex + 1,
      ArrowUp: currentIndex - 1,
      Home: 0,
      End: visible.length - 1,
      PageDown: currentIndex + 10,
      PageUp: currentIndex - 10,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    select(map[e.key]!);
  };

  const nameOf = (side: 'A' | 'B') => (side === 'A' ? p.coderA.name : p.coderB.name);
  const kindText = (i: DisagreementItem) =>
    i.kind === 'boundary' ? t('agreement.dis.boundary') : t('agreement.dis.onlyA', { name: nameOf(i.kind === 'onlyA' ? 'A' : 'B') });
  const snippet = (i: DisagreementItem) => {
    const side = i.a ?? i.b;
    const text = side ? (p.codingsById.get(side.codingId)?.text ?? '') : '';
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  };

  return (
    <section className="agr-section" aria-labelledby="agr-dis" id="agr-disagreements">
      <div className="agr-section__head">
        <div>
          <h2 className="agr-section__title" id="agr-dis">
            {t('agreement.dis.title')} <span className="agr-section__count t-tabular">{tp('agreement.dis.count', open)}</span>
          </h2>
          <p className="agr-section__sub">{t('agreement.dis.atThreshold', { threshold: fmtPercent(p.threshold * 100, meta.bcp47, 0) })}</p>
        </div>
        <div className="agr-dis__filters">
          <Select<string>
            aria-label={t('agreement.table.document')}
            value={p.filterDoc ?? ALL}
            onChange={(v) => p.onFilterDoc(v === ALL ? null : v)}
            options={[{ value: ALL, label: t('agreement.dis.allDocuments') }, ...p.documentIds.map((id) => ({ value: id, label: p.docNames.get(id) ?? '?' }))]}
            size="sm"
            data-testid="agreement-dis-doc"
          />
          <Select<string>
            aria-label={t('agreement.table.code')}
            value={codeFilter}
            onChange={setCodeFilter}
            options={[{ value: ALL, label: t('agreement.dis.allCodes') }, ...codeOptions]}
            size="sm"
            data-testid="agreement-dis-code"
          />
          <Checkbox checked={hideResolved} onChange={setHideResolved} label={t('agreement.dis.hideResolved')} data-testid="agreement-dis-hide-resolved" />
        </div>
      </div>

      <div className="agr-dis">
        <div
          className="agr-dis__list"
          ref={listRef}
          role="listbox"
          tabIndex={0}
          aria-label={t('agreement.dis.list')}
          aria-activedescendant={current ? `agr-dis-${current.key}` : undefined}
          onKeyDown={onListKey}
          data-testid="agreement-dis-list"
        >
          {visible.length === 0 ? (
            <div className="agr-dis__empty">
              <CheckCheck size={20} aria-hidden strokeWidth={1.5} />
              <p>{p.items.length === 0 ? t('agreement.dis.none') : t('agreement.dis.allResolved')}</p>
            </div>
          ) : null}
          {visible.slice(0, limit).map((i) => {
            const code = p.codes.get(i.codeId);
            const done = resolved(i);
            return (
              <div
                key={i.key}
                id={`agr-dis-${i.key}`}
                data-key={i.key}
                role="option"
                aria-selected={current?.key === i.key}
                className={cx('agr-dis__item', current?.key === i.key && 'agr-dis__item--on', done && 'agr-dis__item--done')}
                onClick={() => setSelected(i.key)}
                data-testid="agreement-dis-item"
              >
                <div className="agr-dis__marks" aria-hidden>
                  <span className="agr-dis__mark" style={i.a ? { background: p.coderA.color } : undefined} />
                  <span className="agr-dis__mark" style={i.b ? { background: p.coderB.color } : undefined} />
                </div>
                <div className="agr-dis__main">
                  <div className="agr-dis__line">
                    <span className="agr-chip" style={{ background: code?.color ?? '#7a7f87' }} aria-hidden />
                    <span className="agr-dis__code">{code?.name ?? '?'}</span>
                    <span className="agr-dis__doc">{p.docNames.get(i.documentId) ?? '?'}</span>
                  </div>
                  <div className="agr-dis__snippet">{snippet(i)}</div>
                  <div className="agr-dis__meta">
                    {done ? <Check size={12} aria-hidden /> : null}
                    {done ? t('agreement.dis.resolved') : kindText(i)}
                    {i.kind === 'boundary' ? (
                      <span className="t-tabular"> · {t('agreement.dis.overlap', { p: fmtPercent(i.overlap * 100, meta.bcp47, 0) })}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          {visible.length > limit ? (
            <div className="agr-dis__more">
              <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)} data-testid="agreement-dis-more">
                {tp('agreement.dis.more', Math.min(PAGE, visible.length - limit))}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="agr-dis__view">
          {current ? (
            <Passage
              key={current.key}
              item={current}
              {...p}
              resolved={resolved(current)}
              kindText={kindText(current)}
              onResolved={(choice) => setReview((r) => reviewAfter(r, current, choice))}
            />
          ) : (
            <p className="agr-dis__pick">{visible.length ? t('agreement.dis.pick') : null}</p>
          )}
        </div>
      </div>
    </section>
  );
}

// ── The passage ──────────────────────────────────────────────────────────────────────────────

interface Stripe {
  top: number;
  height: number;
  main: boolean;
}

function Passage({
  item,
  codingsA,
  codingsB,
  coderA,
  coderB,
  codes,
  docNames,
  resolved,
  kindText,
  onResolved,
}: DisagreementsProps & { item: DisagreementItem; resolved: boolean; kindText: string; onResolved: (c: Resolution) => void }) {
  const { t, meta } = useI18n();
  const project = useProject();
  const { go } = useRouter();
  const { record } = useUndo();
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const pieceRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [stripes, setStripes] = useState<{ a: Stripe[]; b: Stripe[] }>({ a: [], b: [] });

  useEffect(() => {
    let live = true;
    void project.store.get('doctext', item.documentId).then((d) => {
      if (live) setText(d?.text ?? '');
    });
    return () => {
      live = false;
    };
  }, [project, item.documentId]);

  const code = codes.get(item.codeId);
  const win = useMemo(() => (text === null ? null : passageWindow(text, item.start, item.end)), [text, item.start, item.end]);
  const spans = useMemo(() => {
    if (!win) return { a: [], b: [] };
    const near = (list: readonly Coding[], main: string | undefined) =>
      list
        .filter((c) => c.document_id === item.documentId && c.code_id === item.codeId && c.end > win.start && c.start < win.end)
        .map((c) => ({ start: Math.max(c.start, win.start), end: Math.min(c.end, win.end), main: c.id === main }))
        .sort((x, y) => x.start - y.start);
    return { a: near(codingsA, item.a?.codingId), b: near(codingsB, item.b?.codingId) };
  }, [win, codingsA, codingsB, item]);
  const parts = useMemo(() => (win ? pieces(win.start, win.end, spans.a, spans.b) : []), [win, spans]);

  // Stripes follow the lines the codings occupy, measured from the laid-out text.
  const measure = useCallback(() => {
    const box = textRef.current;
    if (!box || !parts.length) return;
    const top0 = box.getBoundingClientRect().top;
    const place = (list: { start: number; end: number; main: boolean }[]): Stripe[] =>
      list.flatMap((s) => {
        const first = parts.findIndex((x) => x.end > s.start);
        let last = -1;
        for (let k = parts.length - 1; k >= 0; k--)
          if (parts[k]!.start < s.end) {
            last = k;
            break;
          }
        const f = pieceRefs.current[first];
        const l = pieceRefs.current[last];
        if (first < 0 || last < 0 || !f || !l) return [];
        const fr = f.getClientRects()[0];
        const lrs = l.getClientRects();
        const lr = lrs[lrs.length - 1];
        if (!fr || !lr) return [];
        return [{ top: fr.top - top0, height: Math.max(4, lr.bottom - fr.top), main: s.main }];
      });
    setStripes({ a: place(spans.a), b: place(spans.b) });
  }, [parts, spans]);
  useLayoutEffect(() => {
    measure();
    const box = textRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    return () => ro.disconnect();
  }, [measure]);

  async function resolve(choice: Resolution) {
    if (busy) return;
    const removes = resolutionRemoves(item, choice);
    setBusy(true);
    try {
      if (removes.length) {
        const { undo } = await removeCoding(project, removes);
        record(undo);
        const loser = choice === 'acceptA' ? coderB : coderA;
        toast.show({ message: t('agreement.dis.removedToast', { name: loser.name, code: code?.name ?? '?' }), tone: 'success' });
      } else {
        toast.show(t('agreement.dis.keptToast'));
      }
      onResolved(choice);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const bg = (a: boolean, b: boolean): React.CSSProperties | undefined => {
    if (a && b) return { backgroundImage: `linear-gradient(to bottom, ${withAlpha(coderA.color, 0.22)} 50%, ${withAlpha(coderB.color, 0.22)} 50%)` };
    if (a) return { background: withAlpha(coderA.color, 0.2) };
    if (b) return { background: withAlpha(coderB.color, 0.2) };
    return undefined;
  };
  const hint = (who: 'A' | 'B') => {
    const removes = resolutionRemoves(item, who === 'A' ? 'acceptA' : 'acceptB');
    const other = who === 'A' ? coderB : coderA;
    return removes.length
      ? t('agreement.dis.acceptRemoves', { name: other.name })
      : t('agreement.dis.acceptKeeps', { name: (who === 'A' ? coderA : coderB).name });
  };
  const sideLine = (side: DisagreementItem['a'], coder: Coder) =>
    side ? (
      <span className="t-tabular">{t('agreement.dis.span', { start: fmtInt(side.start, meta.bcp47), end: fmtInt(side.end, meta.bcp47) })}</span>
    ) : (
      <span className="agr-passage__absent">{t('agreement.dis.notCoded', { name: coder.name, code: code?.name ?? '?' })}</span>
    );

  return (
    <article className="agr-passage" aria-label={`${code?.name ?? ''} · ${docNames.get(item.documentId) ?? ''}`} data-testid="agreement-passage">
      <header className="agr-passage__head">
        <div className="agr-passage__title">
          <span className="agr-chip" style={{ background: code?.color ?? '#7a7f87' }} aria-hidden />
          <span className="agr-passage__code">{code?.name ?? '?'}</span>
          <span className="agr-passage__kind">
            {kindText}
            {item.kind === 'boundary' ? ` · ${t('agreement.dis.overlap', { p: fmtPercent(item.overlap * 100, meta.bcp47, 0) })}` : ''}
          </span>
        </div>
        <div className="agr-passage__doc">{docNames.get(item.documentId) ?? '?'}</div>
        <dl className="agr-passage__sides">
          <div>
            <dt>
              <span className="agr-passage__swatch" style={{ background: coderA.color }} aria-hidden />A · {coderA.name}
            </dt>
            <dd>{sideLine(item.a, coderA)}</dd>
          </div>
          <div>
            <dt>
              <span className="agr-passage__swatch" style={{ background: coderB.color }} aria-hidden />B · {coderB.name}
            </dt>
            <dd>{sideLine(item.b, coderB)}</dd>
          </div>
        </dl>
      </header>

      <div className="agr-passage__body">
        {text === null || !win ? (
          <div className="agr-passage__loading">
            <Spinner label={t('agreement.dis.loading')} />
          </div>
        ) : (
          <div className="agr-passage__grid">
            <span className="agr-margin__head" style={{ color: coderA.color }} aria-hidden>
              A
            </span>
            <span className="agr-margin__head" style={{ color: coderB.color }} aria-hidden>
              B
            </span>
            <span aria-hidden />
            <div className="agr-margin" aria-label={t('agreement.dis.margin', { name: coderA.name })} role="img">
              {stripes.a.map((s, k) => (
                <span
                  key={k}
                  className={cx('agr-margin__stripe', !s.main && 'agr-margin__stripe--other')}
                  style={{ top: s.top, height: s.height, background: coderA.color }}
                />
              ))}
            </div>
            <div className="agr-margin" aria-label={t('agreement.dis.margin', { name: coderB.name })} role="img">
              {stripes.b.map((s, k) => (
                <span
                  key={k}
                  className={cx('agr-margin__stripe', !s.main && 'agr-margin__stripe--other')}
                  style={{ top: s.top, height: s.height, background: coderB.color }}
                />
              ))}
            </div>
            <div className="agr-passage__text reading" ref={textRef} data-testid="agreement-passage-text">
              {win.cutBefore ? <span className="agr-passage__cut">… </span> : null}
              {parts.map((x, k) => (
                <span
                  key={`${x.start}-${x.end}`}
                  ref={(el) => {
                    pieceRefs.current[k] = el;
                  }}
                  className={cx(x.a || x.b ? 'agr-passage__coded' : undefined)}
                  style={bg(x.a, x.b)}
                >
                  {text.slice(x.start, x.end)}
                </span>
              ))}
              {win.cutAfter ? <span className="agr-passage__cut"> …</span> : null}
            </div>
          </div>
        )}
      </div>

      <footer className="agr-passage__actions">
        <Button
          variant="ghost"
          icon={ExternalLink}
          className="agr-passage__open"
          title={t('agreement.dis.openInWorkbench')}
          onClick={() => go({ name: 'workbench', docId: item.documentId, codeId: item.codeId, select: { start: item.start, end: item.end } })}
          data-testid="agreement-open-workbench"
        >
          {t('agreement.dis.openInWorkbench')}
        </Button>
        <span className="agr-passage__spacer" />
        {resolved ? (
          <span className="agr-passage__done">
            <Check size={14} aria-hidden /> {t('agreement.dis.resolved')}
          </span>
        ) : (
          <div className="agr-passage__resolve" role="group" aria-label={t('agreement.dis.title')}>
            <Button variant="secondary" onClick={() => void resolve('acceptA')} disabled={busy} title={hint('A')} data-testid="agreement-accept-a">
              <span className="agr-passage__swatch" style={{ background: coderA.color }} aria-hidden />
              {t('agreement.dis.accept', { name: coderA.name })}
            </Button>
            <Button variant="secondary" onClick={() => void resolve('acceptB')} disabled={busy} title={hint('B')} data-testid="agreement-accept-b">
              <span className="agr-passage__swatch" style={{ background: coderB.color }} aria-hidden />
              {t('agreement.dis.accept', { name: coderB.name })}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void resolve('keepBoth')}
              disabled={busy}
              title={t('agreement.dis.keepBothHint')}
              data-testid="agreement-keep-both"
            >
              {t('agreement.dis.keepBoth')}
            </Button>
          </div>
        )}
      </footer>
    </article>
  );
}
