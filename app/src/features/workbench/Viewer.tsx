import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AArrowDown, AArrowUp, ChartNoAxesGantt, Ellipsis, FileAudio, FilePen, Focus, Keyboard, ListTree, Search, StickyNote, Trash2, Users,
} from 'lucide-react';
import type { Code, Coder, Coding } from '../../core/model/types';
import { buildTree } from '../../core/qda/tree';
import { TABLES } from '../../core/store/schema';
import { createCode } from '../../services/codes';
import { applyCode, autocode, inVivo, recode, removeCoding, resizeCoding, setComment } from '../../services/codings';
import { attachMedia, detachMedia, editDocumentText } from '../../services/documents';
import { closedUnder, DraftClaims, isDirty, SaveInFlight, startDraft, type EditDraft } from './editDraft';
import { createMemo, memosFor } from '../../services/memos';
import { combineUndo, q, ServiceError } from '../../services/undo';
import { claimAltArrows } from '../../shell/activity.web';
import { useAppState, useProject, useRegisterSaver } from '../../shell/AppState';
import { useKeyLabel } from '../../shell/keys';
import { useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useUndo } from '../../shell/undo';
import { useCommands } from '../../shell/useCommands';
import { useLive } from '../../shell/useLive';
import { Badge, Button, IconButton, Menu, type MenuEntry, Popover, Spinner, useConfirm, useToast } from '../../ui/components';
import { isTextEntry, modalOpen } from '../../ui/focus';
import type { Rect } from '../../ui/position';
import { type MessageKey, useI18n } from '../../ui/i18n';
import { scrollBehavior } from '../../ui/media';
import { CodingPopover } from './CodingPopover';
import { type Box, rangeFor, scrollToOffset, spanExtent, spanRects, visibleParagraphs } from './dom';
import { buildViews, DocTextBody, type ParaView, type ViewCache } from './DocText';
import { MemosDrawer, SegmentsDrawer } from './Drawers';
import { EditText } from './EditText';
import { FindBar } from './FindBar';
import { MediaBar, type MediaHandle } from './MediaBar';
import { codeOptions, favourites, pushRecent } from './model/codeSearch';
import { findAll, firstMatchFrom } from './model/find';
import { type CoderFilter, coderFilterKey, filterByCoder, markColor, markStyles, parseCoderFilter } from './model/highlight';
import { assignLanes, clusterWidths, type LaneItem } from './model/lanes';
import { cleanSelection, type NodeLike, rangeOffsets } from './model/offsets';
import { paragraphAtTime, paragraphIndexAt, splitParagraphs } from './model/paragraphs';
import { findsByParagraph, marksByParagraph } from './model/runs';
import { DEFAULT_FONT, FONT_SIZES, isBool, isNum, isStr, isStrArray, useDarkTheme, usePref } from './prefs';
import { SelectionPopover } from './SelectionPopover';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useHeaderWidth, WorkbenchHeader } from './header';
import { type StripeGeo, Stripes } from './Stripes';

// The document viewer: the text with its codings drawn in it and in the margin, and everything
// a researcher does while reading — select and code, revisit a coded segment, find, write
// memos, listen to the recording.

export interface ViewerHandle {
  /** Applies a code to the selected text (the codebook's click or drop). False when nothing is selected. */
  apply: (codeId: string) => boolean;
}

export interface ViewerProps {
  docId: string;
  activeCodeId: string | null;
  select?: { start: number; end: number };
  routeKey: number;
  onCanApply: (v: boolean) => void;
  /** Panel toggles, placed at the end of the toolbar. */
  panelActions: ReactNode;
}

type Span = { start: number; end: number };
type Drawer = 'segments' | 'memos' | null;

/** Above this many paragraphs, off-screen ones skip layout and stripes are measured lazily. */
const LARGE = 1500;
const MARGIN_ROOMY = 150;
const MARGIN_COMPACT = 72;
/** Width of a stripe lane with room for the code's name. */
const LANE = 20;

const sameSpan = (a: Span | null, b: Span | null) => a === b || (!!a && !!b && a.start === b.start && a.end === b.end);
const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

function excerpt(text: string, max = 60): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * A Popover anchor for a box in the page's coordinates: read afresh on every scroll and resize,
 * so the popover moves with the text. A new box gives a new function, which re-measures.
 */
function usePageAnchor(page: React.RefObject<HTMLElement | null>, box: Box | null): (() => Rect | null) | null {
  const key = box ? `${box.top},${box.left},${box.width},${box.height}` : '';
  return useMemo(() => {
    if (!box) return null;
    return () => {
      const el = page.current;
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top + box.top, left: b.left + box.left, width: box.width, height: box.height };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, key]);
}

const MEDIA_EXT = ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'flac', 'aac', 'webm', 'mp4', 'm4v', 'mov', 'mkv'];
const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac',
  webm: 'video/webm', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska',
};

export const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer({ docId, activeCodeId, select, routeKey, onCanApply, panelActions }, ref) {
  const { t, tp } = useI18n();
  const project = useProject();
  const { platform } = useAppState();
  const me = project.me;
  const { go } = useRouter();
  const { record, undo: undoTop } = useUndo();
  const toast = useToast();
  const confirm = useConfirm();
  const key = useKeyLabel();
  const dark = useDarkTheme();

  // ── Data ────────────────────────────────────────────────────────────────────────────────
  const { data: docData } = useLive(
    async (s) => {
      const [doc, dt] = await Promise.all([s.get('document', docId), s.get('doctext', docId)]);
      return { id: docId, doc: doc && !doc.deleted ? doc : null, dt: dt && !dt.deleted ? dt : null };
    },
    [docId],
    ['document', 'doctext'],
  );
  const { data: codingData } = useLive(
    async (s) => ({ id: docId, list: await s.list('coding', { where: 'document_id = ?', params: [docId], order: 'start, end_pos, id' }) }),
    [docId],
    ['coding'],
  );
  const { data: codes } = useLive((s) => s.list('code'), [], ['code']);
  const { data: coderList } = useLive((s) => s.list('coder'), [], ['coder']);
  const { data: meta } = useLive(async (s) => ({ cases: await s.list('case'), groups: await s.list('docgroup', { order: 'sort, id' }) }), [], ['case', 'docgroup']);
  const { data: memoCounts } = useLive(
    async (s) => {
      const rows = await s.db.query<{ k: string; n: number }>(
        `SELECT target_id AS k, count(*) AS n FROM ${TABLES.memo.table} WHERE deleted = 0 AND target_kind = 'coding' GROUP BY target_id`,
      );
      return new Map(rows.map((r) => [r.k, Number(r.n)]));
    },
    [],
    ['memo'],
  );

  const doc = docData?.id === docId ? docData.doc : null;
  const dt = docData?.id === docId ? docData.dt : null;
  const loaded = docData?.id === docId;
  const codings = useMemo(() => (codingData?.id === docId ? codingData.list : []), [codingData, docId]);
  const text = dt?.text ?? '';
  const textRef = useRef(text);
  textRef.current = text;

  const codeMap = useMemo(() => new Map((codes ?? []).map((c) => [c.id, c])), [codes]);
  const coders = useMemo(() => new Map((coderList ?? []).map((c) => [c.id, c])), [coderList]);
  const options = useMemo(() => codeOptions(codes ?? []), [codes]);

  // ── Preferences ─────────────────────────────────────────────────────────────────────────
  const [fontSize, setFontSize] = usePref('fontSize', DEFAULT_FONT, isNum);
  const [showStripes, setShowStripes] = usePref('stripes', true, isBool);
  const [activeOnly, setActiveOnly] = usePref('activeOnly', false, isBool);
  const [follow, setFollow] = usePref('follow', true, isBool);
  const [filterRaw, setFilterRaw] = usePref(`coders.${project.id}`, 'all', isStr);
  const [recent, setRecent] = usePref<string[]>(`recentCodes.${project.id}`, [], isStrArray);
  const filter: CoderFilter = useMemo(() => {
    const f = parseCoderFilter(filterRaw);
    return f.kind === 'coder' && coderList && !coders.has(f.id) ? { kind: 'all' } : f;
  }, [filterRaw, coders, coderList]);

  // ── Derived view ────────────────────────────────────────────────────────────────────────
  const transcript = doc?.kind === 'transcript' || (dt?.sync.length ?? 0) > 0;
  const paras = useMemo(
    () => splitParagraphs(text, { transcript, sync: dt?.sync ?? [] }),
    // The record's clock changes with its text or timestamps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, transcript, dt?.updated_at_hlc],
  );
  const parasRef = useRef(paras);
  parasRef.current = paras;
  const large = paras.length > LARGE;
  const timed = useMemo(() => paras.filter((p) => p.ms !== null).map((p) => p.index), [paras]);

  const shown = useMemo(() => filterByCoder(codings, filter, me.id).filter((c) => codeMap.has(c.code_id)), [codings, filter, me.id, codeMap]);
  const shownById = useMemo(() => new Map(shown.map((c) => [c.id, c])), [shown]);
  // The active code counts with every code below it (a category activates its children).
  const activeIds = useMemo(() => {
    if (!activeCodeId || !codes) return null;
    const tree = buildTree(codes);
    return new Set([activeCodeId, ...tree.descendants(activeCodeId).map((c) => c.id)]);
  }, [activeCodeId, codes]);
  const styles = useMemo(
    () => markStyles(shown, (id) => codeMap.get(id)?.color ?? '#7a7f87', { activeCodeIds: activeIds, activeOnly }),
    [shown, codeMap, activeIds, activeOnly],
  );
  const marksBy = useMemo(() => marksByParagraph(paras, shown), [paras, shown]);

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findDebounced, setFindDebounced] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [findFocus, setFindFocus] = useState(0);
  useEffect(() => {
    const h = setTimeout(() => setFindDebounced(findQuery), text.length > 200_000 ? 220 : 60);
    return () => clearTimeout(h);
  }, [findQuery, text.length]);
  const matches = useMemo(() => (findOpen && findDebounced.trim() ? findAll(text, findDebounced) : []), [findOpen, findDebounced, text]);
  const findsBy = useMemo(() => findsByParagraph(paras, matches.map((m, index) => ({ ...m, index }))), [paras, matches]);

  const cache = useRef<ViewCache>({ text: '', byIndex: new Map() });
  const prevViews = useRef<ParaView[]>([]);
  const views = useMemo(() => {
    const next = buildViews(text, paras, marksBy, findsBy, styles, dark, cache.current);
    const prev = prevViews.current;
    const same = prev.length === next.length && next.every((v, i) => v === prev[i]);
    if (same) return prev;
    prevViews.current = next;
    return next;
  }, [text, paras, marksBy, findsBy, styles, dark]);

  const [editing, setEditing] = useState<EditDraft | null>(null);

  // ── Layout ──────────────────────────────────────────────────────────────────────────────
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const marginRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
    // The body remounts when leaving edit mode.
  }, [loaded, !!editing]);
  const [drawer, setDrawer] = useState<Drawer>(null);
  // What opened the drawer, to give it the focus back on close: its toolbar toggle, or the text
  // (a memo on a passage or a coding, with the caret's offset there).
  const drawerFrom = useRef<{ kind: 'toggle' } | { kind: 'text'; at: number }>({ kind: 'toggle' });
  const segToggle = useRef<HTMLButtonElement>(null);
  const memoToggle = useRef<HTMLButtonElement>(null);
  const openDrawer = useCallback((d: Exclude<Drawer, null>, from: { kind: 'toggle' } | { kind: 'text'; at: number }) => {
    drawerFrom.current = from;
    setDrawer(d);
  }, []);
  const closeDrawer = useCallback(() => {
    const which = drawerRef.current;
    const active = document.activeElement;
    const adrift = !active || active === document.body || !!active.closest('.wb-drawer');
    setDrawer(null);
    // Closed from inside (its Close button, Esc): the focus would fall to the page.
    if (!adrift) return;
    const from = drawerFrom.current;
    requestAnimationFrame(() => {
      const toggle = which === 'memos' ? memoToggle.current : segToggle.current;
      const root = rootRef.current;
      if (from.kind === 'toggle' && toggle?.isConnected) return toggle.focus({ preventScroll: true });
      if (!root) return;
      // Back in the text where the caret was (typing in the drawer moved the page's selection).
      const r = from.kind === 'text' ? rangeFor(root, parasRef.current, from.at, from.at) : null;
      const sel = document.getSelection();
      if (r && sel) {
        sel.removeAllRanges();
        sel.addRange(r);
      }
      root.focus({ preventScroll: true });
    });
  }, []);
  const drawerRef = useRef<Drawer>(drawer);
  drawerRef.current = drawer;
  const drawerPushes = width >= 760;
  const textWidth = drawer && drawerPushes ? width - 320 : width;
  const roomy = textWidth >= 720;
  const marginW = showStripes ? (roomy ? MARGIN_ROOMY : MARGIN_COMPACT) : 24;

  // ── Stripes ─────────────────────────────────────────────────────────────────────────────
  const [stripes, setStripes] = useState<{ items: StripeGeo[] }>({ items: [] });
  const measure = useCallback(() => {
    const root = rootRef.current;
    const margin = marginRef.current;
    const scroller = scrollRef.current;
    if (!showStripes || !root || !margin || !scroller) {
      setStripes((s) => (s.items.length ? { ...s, items: [] } : s));
      return;
    }
    const baseTop = margin.getBoundingClientRect().top;
    const ps = parasRef.current;
    const txt = textRef.current;
    let subset = shown;
    let laneItems: LaneItem[];
    let gap = 0;
    const ext = new Map<string, { top: number; bottom: number }>();
    if (large) {
      // Lanes from paragraph spans (layout-free, stable while scrolling); boxes only on screen.
      laneItems = shown.map((c) => ({ id: c.id, lo: paragraphIndexAt(ps, c.start), hi: paragraphIndexAt(ps, Math.max(c.start, c.end - 1)) + 1 }));
      const vis = visibleParagraphs(scroller, root, scroller.clientHeight);
      const lo = ps[vis.first]?.start ?? 0;
      const hi = ps[vis.last]?.end ?? 0;
      subset = shown.filter((c) => c.end > lo && c.start < hi);
      for (const c of subset) {
        const e = spanExtent(root, ps, txt, c.start, c.end, baseTop);
        if (e) ext.set(c.id, e);
      }
    } else {
      for (const c of shown) {
        const e = spanExtent(root, ps, txt, c.start, c.end, baseTop);
        if (e) ext.set(c.id, e);
      }
      laneItems = [...ext].map(([id, e]) => ({ id, lo: e.top, hi: e.bottom }));
      gap = 3;
    }
    const assigned = assignLanes(laneItems, gap);
    const laneOf = assigned.lane;
    // Each cluster of overlapping stripes gets the room it needs: names where they fit,
    // narrower bars without names where many codings pile up.
    const room = marginW - 16;
    const clusters = clusterWidths(laneItems, assigned, gap);
    const widthFor = (k: number) => (k * LANE <= room ? LANE : Math.max(4, Math.min(9, Math.floor(room / Math.max(1, k)))));
    const items: StripeGeo[] = [];
    for (const c of subset) {
      const e = ext.get(c.id);
      if (!e) continue;
      const code = codeMap.get(c.code_id);
      items.push({
        id: c.id,
        name: code?.name ?? '',
        // Dimmed stripes fade as a whole (CSS); the bar itself always reaches 3:1.
        color: markColor(code?.color ?? '#7a7f87', 'normal', dark),
        top: Math.round(e.top * 10) / 10,
        height: Math.round((e.bottom - e.top) * 10) / 10,
        lane: laneOf.get(c.id) ?? 0,
        laneWidth: widthFor(clusters.get(c.id) ?? 1),
        state: styles.get(c.id)?.state ?? 'normal',
      });
    }
    setStripes({ items });
  }, [showStripes, shown, large, marginW, codeMap, styles, dark]);
  const measureRef = useRef(measure);
  measureRef.current = measure;

  useLayoutEffect(() => {
    measure();
  }, [measure, views, fontSize, width, drawer, !!editing]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measureRef.current());
    });
    ro.observe(root);
    void document.fonts?.ready.then(() => measureRef.current());
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [loaded, !!editing]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!large || !scroller) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measureRef.current());
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [large, loaded, !!editing]);

  // ── Selection ───────────────────────────────────────────────────────────────────────────
  const [pending, setPendingState] = useState<Span | null>(null);
  const pendingRef = useRef<Span | null>(null);
  const setPending = useCallback((s: Span | null) => {
    if (sameSpan(pendingRef.current, s)) return;
    pendingRef.current = s;
    setPendingState(s);
  }, []);
  const [native, setNative] = useState(false);
  const [selOpen, setSelOpen] = useState(false);
  const [selQuery, setSelQuery] = useState('');
  const [selBox, setSelBox] = useState<Box | null>(null);
  const [caret, setCaret] = useState<Box | null>(null);
  const [focused, setFocused] = useState(false);
  const [resizing, setResizing] = useState<string | null>(null);
  const resizingRef = useRef<string | null>(null);
  resizingRef.current = resizing;
  const dragging = useRef(false);
  const selAnchor = usePageAnchor(pageRef, selBox);
  const selInput = useRef<HTMLInputElement>(null);

  const pageBox = (r: DOMRect): Box | null => {
    const page = pageRef.current;
    if (!page) return null;
    const b = page.getBoundingClientRect();
    return { top: r.top - b.top, left: r.left - b.left, width: r.width, height: r.height };
  };

  const boxForSpan = useCallback((s: Span): Box | null => {
    const root = rootRef.current;
    const page = pageRef.current;
    if (!root || !page) return null;
    const rects = spanRects(root, parasRef.current, s.start, s.end, page);
    return rects[rects.length - 1] ?? null;
  }, []);

  useEffect(() => {
    if (editing) return;
    const onChange = () => {
      const root = rootRef.current;
      const sel = document.getSelection();
      if (!root || !sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) {
        setNative(false);
        setCaret(null);
        return;
      }
      if (r.collapsed) {
        setNative(false);
        const rects = r.getClientRects();
        const rect = rects[0] ?? r.getBoundingClientRect();
        const box = rect && rect.height > 0 ? pageBox(rect) : null;
        setCaret((cur) => (sameBox(cur, box) ? cur : box));
        if (!resizingRef.current) setPending(null);
        return;
      }
      setCaret(null);
      const off = rangeOffsets(root as unknown as NodeLike, r as unknown as Parameters<typeof rangeOffsets>[1]);
      const clean = off ? cleanSelection(textRef.current, off.start, off.end) : null;
      setNative(!!clean);
      setPending(clean);
      if (clean) {
        const rects = r.getClientRects();
        const last = rects[rects.length - 1];
        const box = last ? pageBox(last) : null;
        setSelBox((cur) => (sameBox(cur, box) ? cur : box));
      }
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, setPending]);

  useEffect(() => {
    if (!pending) {
      setSelOpen(false);
      setSelQuery('');
    } else if (!dragging.current && !resizing) setSelOpen(true);
  }, [pending, resizing]);

  useEffect(() => onCanApply(!!pending && !resizing), [pending, resizing, onCanApply]);

  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (pendingRef.current && !resizingRef.current) setSelOpen(true);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // A pending selection the browser no longer shows (focus went to a panel) is drawn by us.
  const [pendingRects, setPendingRects] = useState<Box[]>([]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const page = pageRef.current;
    if (!pending || native || !root || !page) {
      setPendingRects((r) => (r.length ? [] : r));
      return;
    }
    setPendingRects(spanRects(root, paras, pending.start, pending.end, page));
    if (!selBox) setSelBox(boxForSpan(pending));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, native, views, fontSize, width, drawer]);

  /**
   * Drops the pending selection. With `caretAt`, leaves a caret there instead (the end of the
   * passage just coded), so a keyboard reader goes on from where they were rather than from the
   * top of the screen.
   */
  const clearSelection = useCallback((opts: { caretAt?: number } = {}) => {
    const sel = document.getSelection();
    const root = rootRef.current;
    const at = opts.caretAt;
    const caret = root && at !== undefined ? rangeFor(root, parasRef.current, at, at) : null;
    if (sel && caret) {
      sel.removeAllRanges();
      sel.addRange(caret);
      // The new coding re-renders the passage, replacing the text nodes the caret sits in:
      // put it back once that has happened (the layout effect below).
      caretWanted.current = { at: at!, until: Date.now() + 3000 };
    } else if (sel && root && sel.rangeCount && root.contains(sel.getRangeAt(0).startContainer)) sel.removeAllRanges();
    setPending(null);
    setSelOpen(false);
    setNative(false);
  }, [setPending]);
  const caretWanted = useRef<{ at: number; until: number } | null>(null);
  useLayoutEffect(() => {
    const want = caretWanted.current;
    const root = rootRef.current;
    const sel = document.getSelection();
    if (!want || !root || !sel) return;
    caretWanted.current = null;
    // Not over a selection the reader has made since, nor long after (the coding never re-rendered).
    if (Date.now() > want.until || pendingRef.current || (sel.rangeCount && !sel.isCollapsed)) return;
    const at = want.at;
    const r = rangeFor(root, parasRef.current, at, at);
    if (!r) return;
    sel.removeAllRanges();
    sel.addRange(r);
  }, [views]);

  // A new document starts with nothing selected and nothing open.
  useEffect(() => {
    clearSelection();
    setResizing(null);
    setCodPop(null);
    setEditing(null);
    scrollRef.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  /** Selects a span in the DOM (adjusting a coding starts from its current extent). */
  const selectSpan = useCallback((s: Span) => {
    const root = rootRef.current;
    if (!root) return;
    const r = rangeFor(root, parasRef.current, s.start, s.end);
    const sel = document.getSelection();
    if (!r || !sel) return;
    root.focus({ preventScroll: true });
    sel.removeAllRanges();
    sel.addRange(r);
  }, []);

  // ── Flash (jump to a passage) ───────────────────────────────────────────────────────────
  const [flash, setFlash] = useState<{ span: Span; n: number } | null>(null);
  const [flashRects, setFlashRects] = useState<Box[]>([]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const page = pageRef.current;
    if (!flash || !root || !page) {
      setFlashRects([]);
      return;
    }
    setFlashRects(spanRects(root, paras, flash.span.start, flash.span.end, page));
    const h = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);

  const jumpTo = useCallback(
    (s: Span, opts: { flash?: boolean } = {}) => {
      const root = rootRef.current;
      const scroller = scrollRef.current;
      if (!root || !scroller) return;
      scrollToOffset(scroller, root, parasRef.current, s.start, textRef.current, { smooth: false });
      if (opts.flash !== false) setFlash((f) => ({ span: s, n: (f?.n ?? 0) + 1 }));
      // Text set in a font that was still loading reflows: settle again once it is in.
      void document.fonts?.ready.then(() =>
        requestAnimationFrame(() => {
          if (rootRef.current === root) scrollToOffset(scroller, root, parasRef.current, s.start, textRef.current, { smooth: false, onlyIfHidden: true });
        }),
      );
    },
    [],
  );

  // route.select: arrive at a passage from Coded segments, Search…
  const selectKey = select ? `${routeKey}:${select.start}:${select.end}` : null;
  const handledSelect = useRef<string | null>(null);
  useEffect(() => {
    if (!selectKey || !select || !loaded || !text || codingData?.id !== docId || handledSelect.current === selectKey) return;
    handledSelect.current = selectKey;
    const s = { start: Math.max(0, Math.min(text.length, select.start)), end: Math.max(0, Math.min(text.length, select.end)) };
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        jumpTo(s);
        // Arriving from another screen (a segment card, a search hit), the focus fell to the
        // page or to this screen's heading: put it in the text, with the caret at the passage,
        // so the keyboard and screen readers start there rather than about 30 Tabs away.
        const root = rootRef.current;
        const active = document.activeElement;
        const adrift = !active || active === document.body || !active.isConnected || active.tagName === 'H1';
        const r = root && adrift ? rangeFor(root, parasRef.current, s.start, s.start) : null;
        const sel = document.getSelection();
        if (!root || !r || !sel) return;
        sel.removeAllRanges();
        sel.addRange(r);
        root.focus({ preventScroll: true });
      }),
    );
  }, [selectKey, select, loaded, text, jumpTo, codingData, docId]);

  // ── Coding actions ──────────────────────────────────────────────────────────────────────
  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ServiceError && (e.code === 'not_codable' || e.code === 'empty_span' || e.code === 'too_large')) {
        toast.show({ message: t(`workbench.errors.${e.code}` as MessageKey), tone: 'danger' });
      } else toast.error(e);
    },
    [toast, t],
  );
  const undoAction = useMemo(() => ({ label: t('common.undo'), run: () => undoTop(), testId: 'toast-undo' }), [t, undoTop]);
  const busy = useRef(false);
  const once = useCallback(async (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
    } finally {
      busy.current = false;
    }
  }, []);

  const applyTo = useCallback(
    (span: Span, codeId: string) =>
      once(async () => {
        try {
          const r = await applyCode(project, { documentId: docId, start: span.start, end: span.end, codeId });
          record(r.undo);
          setRecent((cur) => pushRecent(cur, codeId));
          clearSelection({ caretAt: span.end });
          const name = codeMap.get(codeId)?.name ?? '';
          toast.show({ message: r.created ? t('workbench.toast.coded', { code: name }) : t('workbench.toast.extended', { code: name }), action: undoAction });
        } catch (e) {
          fail(e);
        }
      }),
    [once, project, docId, record, setRecent, clearSelection, codeMap, toast, t, undoAction, fail],
  );

  const createAndApply = useCallback(
    (name: string) => {
      const span = pendingRef.current;
      if (!span) return;
      void once(async () => {
        try {
          const made = await createCode(project, { name, parent_id: activeCodeId && codeMap.has(activeCodeId) ? activeCodeId : null });
          try {
            const r = await applyCode(project, { documentId: docId, start: span.start, end: span.end, codeId: made.code.id });
            record(combineUndo('code.create', q(made.code.name), [made.undo, r.undo]));
          } catch (e) {
            await made.undo.undo().catch(() => undefined);
            throw e;
          }
          setRecent((cur) => pushRecent(cur, made.code.id));
          clearSelection({ caretAt: span.end });
          toast.show({ message: t('workbench.toast.created', { code: made.code.name }), action: undoAction });
        } catch (e) {
          fail(e);
        }
      });
    },
    [once, project, activeCodeId, codeMap, docId, record, setRecent, clearSelection, toast, t, undoAction, fail],
  );

  const doInVivo = useCallback(() => {
    const span = pendingRef.current;
    if (!span) return;
    void once(async () => {
      try {
        const r = await inVivo(project, { documentId: docId, start: span.start, end: span.end, parent_id: null });
        record(r.undo);
        setRecent((cur) => pushRecent(cur, r.code.id));
        clearSelection({ caretAt: span.end });
        toast.show({ message: t('workbench.toast.inVivo', { code: r.code.name }), action: undoAction });
      } catch (e) {
        fail(e);
      }
    });
  }, [once, project, docId, record, setRecent, clearSelection, toast, t, undoAction, fail]);

  const [memoFocus, setMemoFocus] = useState<string | null>(null);
  const memoOnPassage = useCallback(() => {
    const span = pendingRef.current;
    if (!span) return;
    void once(async () => {
      try {
        const { memo, undo } = await createMemo(project, { title: `“${excerpt(textRef.current.slice(span.start, span.end), 50)}”`, target: { kind: 'document', id: docId } });
        record(undo);
        clearSelection({ caretAt: span.end });
        openDrawer('memos', { kind: 'text', at: span.end });
        setMemoFocus(memo.id);
      } catch (e) {
        fail(e);
      }
    });
  }, [once, project, docId, record, clearSelection, openDrawer, fail]);

  const applyFavourite = useCallback(
    (n: number) => {
      const span = pendingRef.current;
      const fav = favourites(options).find((o) => o.shortcut === n);
      if (!span || !fav) return false;
      void applyTo(span, fav.id);
      return true;
    },
    [options, applyTo],
  );

  useImperativeHandle(
    ref,
    () => ({
      apply: (codeId: string) => {
        const span = pendingRef.current;
        if (!span || resizingRef.current) return false;
        void applyTo(span, codeId);
        return true;
      },
    }),
    [applyTo],
  );

  // Coding popover (a click on a highlight or a stripe).
  const [codPop, setCodPop] = useState<{ ids: string[]; box: Box } | null>(null);
  const codAnchor = usePageAnchor(pageRef, codPop?.box ?? null);
  const popCodings = useMemo(() => (codPop ? codPop.ids.map((id) => shownById.get(id)).filter((c): c is Coding => !!c) : []), [codPop, shownById]);
  useEffect(() => {
    if (codPop && !popCodings.length) setCodPop(null);
  }, [codPop, popCodings.length]);

  const removeCodings = useCallback(
    (ids: string[]) =>
      void once(async () => {
        try {
          const r = await removeCoding(project, ids);
          record(r.undo);
          toast.show({ message: tp('workbench.toast.removed', r.removed), action: undoAction });
        } catch (e) {
          fail(e);
        }
      }),
    [once, project, record, toast, tp, undoAction, fail],
  );

  const doRecode = useCallback(
    (id: string, codeId: string) =>
      void once(async () => {
        try {
          const r = await recode(project, id, codeId);
          record(r.undo);
          setRecent((cur) => pushRecent(cur, codeId));
          toast.show({ message: t('workbench.toast.recoded', { code: codeMap.get(codeId)?.name ?? '' }), action: undoAction });
        } catch (e) {
          fail(e);
        }
      }),
    [once, project, record, setRecent, toast, t, codeMap, undoAction, fail],
  );

  const doComment = useCallback(
    (id: string, comment: string) =>
      void (async () => {
        try {
          const r = await setComment(project, id, comment);
          record(r.undo);
        } catch (e) {
          fail(e);
        }
      })(),
    [project, record, fail],
  );

  const memoForCoding = useCallback(
    (id: string) =>
      void once(async () => {
        try {
          const existing = await memosFor(project, { kind: 'coding', id });
          let focus = existing[0]?.id ?? null;
          if (!focus) {
            const { memo, undo } = await createMemo(project, { target: { kind: 'coding', id } });
            record(undo);
            focus = memo.id;
          }
          setCodPop(null);
          const c = shownById.get(id);
          openDrawer('memos', c ? { kind: 'text', at: c.start } : { kind: 'toggle' });
          setMemoFocus(focus);
        } catch (e) {
          fail(e);
        }
      }),
    [once, project, record, openDrawer, shownById, fail],
  );

  const startAdjust = useCallback(
    (id: string) => {
      const c = shownById.get(id);
      if (!c) return;
      setCodPop(null);
      setResizing(id);
      pendingRef.current = null;
      setPending({ start: c.start, end: c.end });
      requestAnimationFrame(() => selectSpan({ start: c.start, end: c.end }));
    },
    [shownById, setPending, selectSpan],
  );

  const commitAdjust = useCallback(() => {
    const id = resizingRef.current;
    const span = pendingRef.current;
    if (!id || !span) return;
    void once(async () => {
      try {
        const r = await resizeCoding(project, id, span.start, span.end);
        record(r.undo);
        setResizing(null);
        clearSelection({ caretAt: span.end });
        toast.show({ message: t('workbench.toast.resized'), action: undoAction });
      } catch (e) {
        fail(e);
      }
    });
  }, [once, project, record, clearSelection, toast, t, undoAction, fail]);

  const cancelAdjust = useCallback(() => {
    setResizing(null);
    clearSelection();
  }, [clearSelection]);

  const codeAll = useCallback(
    (codeId: string) =>
      void once(async () => {
        try {
          const r = await autocode(project, { codeId, hits: matches.map((m) => ({ documentId: docId, start: m.start, end: m.end })), expand: 'hit' });
          record(r.undo);
          setRecent((cur) => pushRecent(cur, codeId));
          toast.show({ message: tp('workbench.toast.codedAll', r.count, { code: codeMap.get(codeId)?.name ?? '' }), action: r.count ? undoAction : undefined });
        } catch (e) {
          fail(e);
        }
      }),
    [once, project, matches, docId, record, setRecent, toast, tp, codeMap, undoAction, fail],
  );

  // ── Find ────────────────────────────────────────────────────────────────────────────────
  const openFind = useCallback(() => {
    const span = pendingRef.current;
    if (span && span.end - span.start <= 60) {
      const s = textRef.current.slice(span.start, span.end).trim();
      if (s && !s.includes('\n')) setFindQuery(s);
    }
    setFindOpen(true);
    setFindFocus((n) => n + 1);
  }, []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!matches.length) return;
    const scroller = scrollRef.current;
    const from = scroller ? posAtTop(scroller) : 0;
    setFindIndex(firstMatchFrom(matches, from));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);
  const posAtTop = (scroller: HTMLElement): number => {
    const root = rootRef.current;
    if (!root) return 0;
    const vis = visibleParagraphs(scroller, root, 0);
    return parasRef.current[vis.first]?.start ?? 0;
  };
  const current = matches.length ? Math.min(findIndex, matches.length - 1) : -1;
  useEffect(() => {
    if (current < 0) return;
    const m = matches[current];
    const root = rootRef.current;
    const scroller = scrollRef.current;
    if (!m || !root || !scroller) return;
    scrollToOffset(scroller, root, parasRef.current, m.start, textRef.current, { onlyIfHidden: true });
  }, [current, matches]);
  const stepFind = (d: number) => matches.length && setFindIndex((i) => (i + d + matches.length) % matches.length);

  // ── Media ───────────────────────────────────────────────────────────────────────────────
  const media = useRef<MediaHandle>(null);
  const [currentPi, setCurrentPi] = useState(-1);
  const currentPiRef = useRef(-1);
  const followRef = useRef(follow);
  followRef.current = follow;
  const onTime = useCallback(
    (ms: number, playing: boolean) => {
      const i = paragraphAtTime(parasRef.current, timed, ms);
      if (i === currentPiRef.current) return;
      currentPiRef.current = i;
      setCurrentPi(i);
      const root = rootRef.current;
      const scroller = scrollRef.current;
      const p = parasRef.current[i];
      if (playing && followRef.current && p && root && scroller && !dragging.current && !pendingRef.current) {
        const el = root.children[i];
        if (el) {
          const r = el.getBoundingClientRect();
          const s = scroller.getBoundingClientRect();
          if (r.top < s.top + 24 || r.bottom > s.bottom - 64) {
            scroller.scrollTo({ top: scroller.scrollTop + (r.top - s.top) - scroller.clientHeight * 0.3, behavior: scrollBehavior() });
          }
        }
      }
    },
    [timed],
  );
  useEffect(() => {
    currentPiRef.current = -1;
    setCurrentPi(-1);
  }, [docId]);

  const attachRecording = useCallback(async () => {
    try {
      const picked = await platform.dialogs.pickFiles(t('workbench.media.pickTitle'), [{ name: t('workbench.media.filter'), extensions: MEDIA_EXT }], false);
      const path = picked[0];
      if (!path) return;
      const bytes = await platform.files.read(path);
      const filename = path.split(/[\\/]/).pop() ?? path;
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      await attachMedia(project, docId, { bytes, filename, mime: MIME[ext] ?? 'application/octet-stream' }, 'media');
      toast.show({ message: t('workbench.media.attached', { name: filename }), tone: 'success' });
    } catch (e) {
      fail(e);
    }
  }, [platform, project, docId, toast, t, fail]);

  const removeRecording = useCallback(async () => {
    const ok = await confirm({
      title: t('workbench.media.removeTitle'),
      body: t('workbench.media.removeBody'),
      confirmLabel: t('workbench.media.removeConfirm'),
      danger: true,
    });
    if (!ok) return;
    try {
      await detachMedia(project, docId, 'media');
    } catch (e) {
      fail(e);
    }
  }, [confirm, project, docId, t, fail]);

  // ── Editing the text ────────────────────────────────────────────────────────────────────
  const inFlight = useRef(new SaveInFlight());
  const saveEdit = useCallback(async () => {
    if (!editing || editing.busy) return;
    if (editing.text === editing.base) {
      setEditing(null);
      return;
    }
    setEditing({ ...editing, busy: true });
    try {
      const r = await inFlight.current.track(editing, editDocumentText(project, editing.docId, editing.text));
      record(r.undo);
      setEditing(null);
      toast.show({
        message: r.removedCodings ? tp('workbench.edit.savedRemoved', r.removedCodings) : t('workbench.edit.saved'),
        tone: r.removedCodings ? 'neutral' : 'success',
        action: undoAction,
      });
    } catch (e) {
      setEditing((cur) => (cur ? { ...cur, busy: false } : cur));
      // A saver starting before the next render must see the edit as unsaved again.
      if (editingRef.current?.docId === editing.docId) editingRef.current = { ...editingRef.current, busy: false };
      // Closed under the save (locked, window closing): the lock's saver has taken the draft.
      if (closedUnder(e, project.isOpen)) return;
      fail(e);
    }
  }, [editing, project, record, toast, tp, t, undoAction, fail]);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const claims = useRef(new DraftClaims());
  // Locking or closing the project keeps an edit in progress rather than dropping it: first the
  // save already running (Save pressed just before Ctrl+L) finishes, then whatever is unsaved.
  useRegisterSaver(async () => {
    const failed = await inFlight.current.settle();
    const d = claims.current.claim(failed ?? editingRef.current);
    if (d) await editDocumentText(project, d.docId, d.text).then((r) => record(r.undo));
  });
  // So does leaving it: opening another document, going to another screen. The researcher
  // asked to keep nothing less than a save would, so the edit is saved (one undo step) and a
  // toast says so, rather than thrown away without a word.
  const keepOnLeave = useRef<() => void>(() => {});
  keepOnLeave.current = () => {
    const d = claims.current.claim(editingRef.current);
    if (!d) return;
    editDocumentText(project, d.docId, d.text).then(
      (r) => {
        record(r.undo);
        toast.show({
          message: r.removedCodings ? tp('workbench.edit.keptRemoved', r.removedCodings, { name: d.name }) : t('workbench.edit.kept', { name: d.name }),
          tone: r.removedCodings ? 'neutral' : 'success',
          action: undoAction,
        });
      },
      (e: unknown) => {
        if (!closedUnder(e, project.isOpen)) fail(e);
      },
    );
  };
  useEffect(() => () => keepOnLeave.current(), [docId]);
  // Cancel and Esc throw the changes away, so they ask first when there are any.
  const cancelEdit = useCallback(async () => {
    const d = editingRef.current;
    if (!d || d.busy) return;
    if (isDirty(d)) {
      const ok = await confirm({
        title: t('workbench.edit.discardTitle'),
        body: t('workbench.edit.discardBody'),
        confirmLabel: t('workbench.edit.discard'),
        danger: true,
      });
      if (!ok || editingRef.current?.docId !== d.docId) return;
    }
    setEditing(null);
  }, [confirm, t]);

  // ── Keyboard ────────────────────────────────────────────────────────────────────────────
  const [keysOpen, setKeysOpen] = useState(false);
  const onRootKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const sel = document.getSelection();
    const root = rootRef.current;
    if (!sel || !root) return;
    const nav: Record<string, [string, string]> = {
      ArrowLeft: ['backward', e.ctrlKey || e.altKey || e.metaKey ? 'word' : 'character'],
      ArrowRight: ['forward', e.ctrlKey || e.altKey || e.metaKey ? 'word' : 'character'],
      ArrowUp: ['backward', 'line'],
      ArrowDown: ['forward', 'line'],
      Home: ['backward', e.ctrlKey || e.metaKey ? 'documentboundary' : 'lineboundary'],
      End: ['forward', e.ctrlKey || e.metaKey ? 'documentboundary' : 'lineboundary'],
    };
    const move = nav[e.key];
    if (move) {
      // Alt+arrows belong to the recording (Alt+Shift always, plain Alt while it plays) or are the app's Back.
      if (e.altKey && (e.shiftKey || !(e.ctrlKey || e.metaKey))) return;
      e.preventDefault();
      const inside = sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).startContainer);
      if (!inside) {
        const scroller = scrollRef.current;
        const first = scroller ? visibleParagraphs(scroller, root, -40).first : 0;
        const p = paras[Math.min(first, paras.length - 1)];
        if (p) {
          const r = rangeFor(root, paras, p.start, p.start);
          if (r) {
            sel.removeAllRanges();
            sel.addRange(r);
          }
        }
        return;
      }
      if (!e.shiftKey && !sel.isCollapsed && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (e.key === 'ArrowLeft') sel.collapseToStart();
        else sel.collapseToEnd();
        return;
      }
      // The caret must not leave the text (ArrowLeft at its very start would move it into the
      // page around it, where the next Enter does nothing): put it back if it did.
      const before = { anchor: sel.anchorNode, anchorOffset: sel.anchorOffset, focus: sel.focusNode, focusOffset: sel.focusOffset };
      sel.modify(e.shiftKey ? 'extend' : 'move', move[0], move[1]);
      if (!sel.focusNode || !root.contains(sel.focusNode) || !sel.anchorNode || !root.contains(sel.anchorNode)) {
        if (before.anchor && before.focus) sel.setBaseAndExtent(before.anchor, before.anchorOffset, before.focus, before.focusOffset);
        return;
      }
      const node = sel.focusNode;
      const el = node instanceof Element ? node : node?.parentElement;
      el?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (resizingRef.current) return commitAdjust();
      if (pendingRef.current) {
        setSelOpen(true);
        requestAnimationFrame(() => selInput.current?.focus());
        return;
      }
      openCodingsAtCaret();
      return;
    }
    if (e.key === 'Escape') {
      if (resizingRef.current) {
        e.preventDefault();
        cancelAdjust();
      } else if (pendingRef.current) {
        e.preventDefault();
        // Esc drops the selection but keeps the place: a caret where the selection's focus end was.
        if (sel.focusNode && root.contains(sel.focusNode)) sel.collapse(sel.focusNode, sel.focusOffset);
        else clearSelection({ caretAt: pendingRef.current.end });
      }
      return;
    }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      openCodingsAtCaret();
      return;
    }
    // Typing a letter over a selection starts searching for a code.
    if (pendingRef.current && !resizingRef.current && e.key.length === 1 && /\p{L}/u.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setSelQuery((q0) => q0 + e.key);
      setSelOpen(true);
      requestAnimationFrame(() => selInput.current?.focus());
    }
  };

  const openCodingsAtCaret = () => {
    const sel = document.getSelection();
    const root = rootRef.current;
    if (!sel || !root || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const off = rangeOffsets(root as unknown as NodeLike, r as unknown as Parameters<typeof rangeOffsets>[1]);
    if (!off) return;
    const at = shown.filter((c) => c.start <= off.start && c.end > off.start);
    if (!at.length) return;
    const rects = r.getClientRects();
    const rect = rects[0] ?? r.getBoundingClientRect();
    const box = pageBox(rect);
    if (box) setCodPop({ ids: at.map((c) => c.id), box: { ...box, height: Math.max(box.height, 18) } });
  };

  const latest = useRef({ openFind, doInVivo, applyFavourite, commitAdjust });
  latest.current = { openFind, doInVivo, applyFavourite, commitAdjust };
  useEffect(() => {
    if (editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || modalOpen()) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const typing = isTextEntry(e.target);
      if (mod && !e.altKey && !e.shiftKey && k === 'f') {
        e.preventDefault();
        latest.current.openFind();
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && k === 'i' && pendingRef.current && !resizingRef.current) {
        e.preventDefault();
        latest.current.doInVivo();
        return;
      }
      if (mod && !e.altKey && (e.code === 'Space' || e.key === ' ') && !typing && media.current) {
        e.preventDefault();
        media.current.toggle();
        return;
      }
      // Alt+←/→ skip while the recording plays or has the focus (the shell's Back gives way, see
      // claimAltArrows below); Alt+Shift+←/→ skip at any time.
      if (e.altKey && !mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typing && media.current && (e.shiftKey || media.current.active())) {
        e.preventDefault();
        media.current.skip(e.key === 'ArrowLeft' ? -5000 : 5000);
        return;
      }
      if (e.altKey && !mod && e.key === 'Enter' && !typing && media.current) {
        const sel = document.getSelection();
        const root = rootRef.current;
        if (sel && root && sel.rangeCount && root.contains(sel.getRangeAt(0).startContainer)) {
          const off = rangeOffsets(root as unknown as NodeLike, sel.getRangeAt(0) as unknown as Parameters<typeof rangeOffsets>[1]);
          const pi = off ? paragraphIndexAt(parasRef.current, off.start) : -1;
          // The caret's turn, or the last timed one before it.
          let ms: number | null = null;
          for (const ti of timedRef.current) {
            if (ti > pi) break;
            ms = parasRef.current[ti]?.ms ?? ms;
          }
          if (ms !== null) {
            e.preventDefault();
            media.current.seek(ms);
          }
        }
        return;
      }
      if (typing) return;
      if (e.key === '?' && !mod) {
        e.preventDefault();
        setKeysOpen(true);
        return;
      }
      if (!mod && !e.altKey && /^[1-9]$/.test(e.key) && pendingRef.current && !resizingRef.current) {
        if (latest.current.applyFavourite(Number(e.key))) e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && resizingRef.current && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        latest.current.commitAdjust();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);
  const timedRef = useRef(timed);
  timedRef.current = timed;
  useEffect(() => claimAltArrows(() => !!media.current?.active() && !modalOpen()), []);

  // ── Pointer ─────────────────────────────────────────────────────────────────────────────
  const onRootMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-chrome]')) return;
    dragging.current = true;
    setCodPop(null);
  };

  const onRootClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const seek = target.closest<HTMLElement>('[data-seek]');
    if (seek) {
      e.preventDefault();
      if (media.current) media.current.seek(Number(seek.dataset.seek));
      else toast.show(t('workbench.media.none'));
      return;
    }
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (resizingRef.current) return;
    const run = target.closest<HTMLElement>('.wb-r--coded');
    if (!run || !run.dataset.c) return;
    let rect: DOMRect | undefined;
    for (const r of run.getClientRects()) {
      if (e.clientY >= r.top - 1 && e.clientY <= r.bottom + 1) {
        rect = r;
        break;
      }
    }
    rect ??= run.getBoundingClientRect();
    const box = pageBox(new DOMRect(e.clientX - 2, rect.top, 4, rect.height));
    if (box) setCodPop({ ids: run.dataset.c.split(' '), box });
  };

  const [hovered, setHovered] = useState<string | null>(null);
  const openStripe = useCallback((id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const page = pageRef.current;
    if (!page) return;
    const b = page.getBoundingClientRect();
    setCodPop({ ids: [id], box: { top: r.top - b.top, left: r.left - b.left, width: r.width, height: Math.min(r.height, 28) } });
  }, []);
  const stripeLabel = useCallback((name: string) => t('workbench.stripes.label', { code: name }), [t]);

  // ── Commands ────────────────────────────────────────────────────────────────────────────
  useCommands(
    () => [
      { id: 'workbench.stripes', label: showStripes ? t('workbench.commands.hideStripes') : t('workbench.commands.showStripes'), group: t('workbench.commands.group'), icon: ChartNoAxesGantt, run: () => setShowStripes((v) => !v) },
      { id: 'workbench.find', label: t('workbench.commands.find'), group: t('workbench.commands.group'), icon: Search, shortcut: key('F'), run: () => openFind() },
      { id: 'workbench.keys', label: t('workbench.commands.keys'), group: t('workbench.commands.group'), icon: Keyboard, shortcut: '?', run: () => setKeysOpen(true) },
    ],
    [t, key, showStripes],
  );

  // ── Dynamic style: hover, current find match, the paragraph being played ─────────────────
  const dynamicCss = useMemo(() => {
    const out: string[] = [];
    const hc = hovered ? shownById.get(hovered) : undefined;
    const color = hc ? codeMap.get(hc.code_id)?.color : undefined;
    if (hovered && color) out.push(`.wb-text .wb-r[data-c~="${hovered}"]{outline:1.5px solid ${color};outline-offset:0;border-radius:2px}`);
    if (current >= 0) out.push(`.wb-text .wb-r[data-f="${current}"]{background:var(--wb-find-current)!important;color:var(--wb-find-current-ink)}`);
    if (currentPi >= 0) out.push(`.wb-text>[data-pi="${currentPi}"]{background:var(--wb-playing);box-shadow:-10px 0 0 var(--wb-playing),10px 0 0 var(--wb-playing)}.wb-text>[data-pi="${currentPi}"] .wb-ts__btn{color:var(--ink);background:var(--paper-active)}`);
    return out.join('\n');
  }, [hovered, shownById, codeMap, current, currentPi]);

  // Every hook runs before the early return below: the document can disappear while it is
  // open (deleted from the panel, or undone), and React needs the same hooks on every render.
  const headerW = useHeaderWidth();

  // ── Render ──────────────────────────────────────────────────────────────────────────────
  if (loaded && (!doc || !dt)) {
    return (
      <>
        <WorkbenchHeader>
          <ScreenHeader title={t('workbench.title')} actions={panelActions} />
        </WorkbenchHeader>
        <div className="wb-missing">{t('workbench.missing')}</div>
      </>
    );
  }

  const caseName = doc?.case_id ? meta?.cases.find((c) => c.id === doc.case_id)?.name : undefined;
  const groupNames = doc ? doc.group_ids.map((g) => meta?.groups.find((x) => x.id === g)).filter((g): g is NonNullable<typeof g> => !!g) : [];
  const resizingCoding = resizing ? shownById.get(resizing) : undefined;
  const otherCoders = (coderList ?? []).filter((c) => c.id !== me.id);
  const filterLabel =
    filter.kind === 'all' ? t('workbench.coders.all') : filter.kind === 'me' ? t('workbench.coders.me') : coders.get(filter.id)?.name ?? t('workbench.coders.all');

  const subtitle = doc ? (
    <span className="wb-sub">
      <span className="wb-sub__kind">{t(`workbench.kind.${doc.kind}`)}</span>
      {caseName ? (
        <Badge tone="neutral" className="wb-sub__chip" title={`${t('workbench.header.case')}: ${caseName}`}>
          <span className="wb-sub__chip-text">{caseName}</span>
        </Badge>
      ) : null}
      {groupNames.map((g) => (
        <Badge key={g.id} color={g.color} className="wb-sub__chip" title={`${t('workbench.header.group')}: ${g.name}`}>
          <span className="wb-sub__chip-text">{g.name}</span>
        </Badge>
      ))}
    </span>
  ) : null;

  // The toolbar folds into the More menu as the header narrows (1000 px windows).
  const foldFont = headerW > 0 && headerW < 1180;
  const foldView = headerW > 0 && headerW < 900;
  const smaller = () => setFontSize((f) => FONT_SIZES.slice().reverse().find((s) => s < f) ?? f);
  const larger = () => setFontSize((f) => FONT_SIZES.find((s) => s > f) ?? f);
  const coderRows: { f: CoderFilter; label: string }[] = [
    { f: { kind: 'all' }, label: t('workbench.coders.all') },
    { f: { kind: 'me' }, label: t('workbench.coders.meNamed', { name: me.name }) },
    ...otherCoders.map((c) => ({ f: { kind: 'coder', id: c.id } as CoderFilter, label: c.name })),
  ];
  const folded: MenuEntry[] = [
    ...(foldFont
      ? ([
          { id: 'smaller', label: t('workbench.header.smaller'), icon: AArrowDown, hint: `${fontSize}px`, disabled: fontSize <= FONT_SIZES[0], onSelect: smaller, testId: 'menu-font-smaller' },
          { id: 'larger', label: t('workbench.header.larger'), icon: AArrowUp, disabled: fontSize >= FONT_SIZES[FONT_SIZES.length - 1]!, onSelect: larger, testId: 'menu-font-larger' },
          { kind: 'separator' },
        ] as MenuEntry[])
      : []),
    ...(foldView
      ? ([
          { id: 'stripes', label: t('workbench.header.showStripes'), checked: showStripes, onSelect: () => setShowStripes((v) => !v), testId: 'menu-stripes' },
          { id: 'active', label: t('workbench.menu.activeOnly'), checked: activeOnly, onSelect: () => setActiveOnly((v) => !v), testId: 'menu-active-only' },
          { kind: 'heading', label: t('workbench.coders.title') },
          ...coderRows.map((r) => ({
            id: `coder-${coderFilterKey(r.f)}`,
            label: r.label,
            checked: coderFilterKey(r.f) === coderFilterKey(filter),
            onSelect: () => setFilterRaw(coderFilterKey(r.f)),
          })),
          { kind: 'separator' },
        ] as MenuEntry[])
      : []),
  ];
  const moreItems: MenuEntry[] = [
    ...folded,
    { id: 'edit', label: t('workbench.edit.start'), icon: FilePen, onSelect: () => setEditing(startDraft(docId, doc?.name ?? '', text)), testId: 'menu-edit-text' },
    { kind: 'separator' },
    {
      id: 'media',
      label: doc?.media ? t('workbench.media.replace') : t('workbench.media.attach'),
      icon: FileAudio,
      onSelect: () => void attachRecording(),
      testId: 'menu-attach-media',
    },
    ...(doc?.media ? [{ id: 'media-remove', label: t('workbench.media.remove'), icon: Trash2, onSelect: () => void removeRecording(), testId: 'menu-remove-media' } as MenuEntry] : []),
    { kind: 'separator' },
    { id: 'keys', label: t('workbench.keys.title'), icon: Keyboard, hint: '?', onSelect: () => setKeysOpen(true), testId: 'menu-keys' },
  ];

  const actions = editing ? (
    <>
      <Button variant="ghost" onClick={() => void cancelEdit()} disabled={editing.busy} data-testid="edit-cancel">
        {t('common.cancel')}
      </Button>
      <Button variant="primary" onClick={() => void saveEdit()} busy={editing.busy} data-testid="edit-save">
        {t('workbench.edit.save')}
      </Button>
      {panelActions}
    </>
  ) : (
    <>
      {foldFont ? null : (
        <>
          <div className="wb-tools" role="group" aria-label={t('workbench.header.textTools')}>
            <IconButton icon={AArrowDown} label={t('workbench.header.smaller')} disabled={fontSize <= FONT_SIZES[0]} onClick={smaller} data-testid="font-smaller" />
            <IconButton icon={AArrowUp} label={t('workbench.header.larger')} disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]!} onClick={larger} data-testid="font-larger" />
          </div>
          <span className="wb-tools__sep" aria-hidden />
        </>
      )}
      {foldView ? null : (
        <>
      <div className="wb-tools" role="group" aria-label={t('workbench.header.codingTools')}>
        <IconButton icon={ChartNoAxesGantt} label={showStripes ? t('workbench.header.hideStripes') : t('workbench.header.showStripes')} pressed={showStripes} onClick={() => setShowStripes((v) => !v)} data-testid="toggle-stripes" />
        <IconButton
          icon={Focus}
          label={activeCodeId ? t('workbench.header.activeOnly', { code: codeMap.get(activeCodeId)?.name ?? '' }) : t('workbench.header.activeOnlyNone')}
          pressed={activeOnly}
          onClick={() => setActiveOnly((v) => !v)}
          data-testid="toggle-active-only"
        />
        <CoderFilterButton filter={filter} label={filterLabel} me={me} others={otherCoders} onChange={(f) => setFilterRaw(coderFilterKey(f))} />
      </div>
      <span className="wb-tools__sep" aria-hidden />
        </>
      )}
      <div className="wb-tools" role="group" aria-label={t('workbench.header.viewTools')}>
        <IconButton icon={Search} label={t('workbench.find.label')} shortcut={key('F')} pressed={findOpen} onClick={() => (findOpen ? closeFind() : openFind())} data-testid="toggle-find" />
        <IconButton ref={segToggle} icon={ListTree} label={t('workbench.segments.title')} pressed={drawer === 'segments'} onClick={() => (drawer === 'segments' ? setDrawer(null) : openDrawer('segments', { kind: 'toggle' }))} data-testid="toggle-segments" />
        <IconButton ref={memoToggle} icon={StickyNote} label={t('workbench.memos.title')} pressed={drawer === 'memos'} onClick={() => (drawer === 'memos' ? setDrawer(null) : openDrawer('memos', { kind: 'toggle' }))} data-testid="toggle-memos" />
        <MoreMenu items={moreItems} label={t('common.more')} />
      </div>
      {panelActions}
    </>
  );

  const gutter = transcript && roomy && timed.length > 0;
  const pageStyle = {
    ['--wb-font' as string]: `${fontSize}px`,
    ['--wb-margin' as string]: `${marginW}px`,
    ['--wb-gutter' as string]: gutter ? '64px' : '0px',
  };

  return (
    <>
      <WorkbenchHeader>
        <ScreenHeader title={doc?.name ?? ''} subtitle={subtitle} actions={actions} />
      </WorkbenchHeader>
      <div className="wb-viewer" data-testid="viewer">
        {editing ? (
          <EditText
            value={editing.text}
            onChange={(v) => setEditing((cur) => (cur ? { ...cur, text: v } : cur))}
            codings={codings.length}
            fontSize={fontSize}
            onSave={() => void saveEdit()}
            onCancel={() => void cancelEdit()}
          />
        ) : (
          <>
            {findOpen ? (
              <FindBar
                query={findQuery}
                onQuery={setFindQuery}
                count={matches.length}
                index={Math.max(0, current)}
                onStep={stepFind}
                onClose={closeFind}
                options={options}
                onCodeAll={codeAll}
                focusKey={findFocus}
                shortcut={key('F')}
              />
            ) : null}
            {resizingCoding ? (
              <div className="wb-adjust" role="status" data-testid="adjust-bar">
                <span className="wb-dot" style={{ background: codeMap.get(resizingCoding.code_id)?.color }} aria-hidden />
                <span className="wb-adjust__text">{t('workbench.adjust.text', { code: codeMap.get(resizingCoding.code_id)?.name ?? '' })}</span>
                <Button size="sm" variant="ghost" onClick={cancelAdjust} data-testid="adjust-cancel">
                  {t('common.cancel')}
                </Button>
                <Button size="sm" variant="primary" onClick={commitAdjust} disabled={!pending} data-testid="adjust-apply">
                  {t('workbench.adjust.apply')}
                </Button>
              </div>
            ) : null}
            <div ref={bodyRef} className={drawer ? (drawerPushes ? 'wb-body wb-body--drawer' : 'wb-body wb-body--overlay') : 'wb-body'}>
              <div ref={scrollRef} className="wb-scroll" data-testid="viewer-scroll">
                {!loaded ? (
                  <div className="wb-loading">
                    <Spinner size={20} label={t('common.loading')} />
                  </div>
                ) : (
                  <div ref={pageRef} className={`wb-page${gutter ? ' wb-page--gutter' : ''}${large ? ' wb-page--large' : ''}${textWidth < 600 ? ' wb-page--tight' : ''}`} style={pageStyle}>
                    <style>{dynamicCss}</style>
                    <div
                      ref={rootRef}
                      className={`wb-text${transcript ? ' wb-text--transcript' : ''}`}
                      data-wb-root=""
                      tabIndex={0}
                      role="document"
                      aria-label={t('workbench.text.label', { name: doc?.name ?? '' })}
                      aria-describedby="wb-text-help"
                      onKeyDown={onRootKeyDown}
                      onMouseDown={onRootMouseDown}
                      onClick={onRootClick}
                      onFocus={(e) => {
                        setFocused(true);
                        // Arriving with Tab: put a caret at the top of what is on screen, ready for Shift+arrows.
                        const root = e.currentTarget;
                        const sel = document.getSelection();
                        if (e.target !== root || !root.matches(':focus-visible') || !sel) return;
                        if (sel.rangeCount && root.contains(sel.getRangeAt(0).startContainer)) return;
                        const scroller = scrollRef.current;
                        const p = paras[scroller ? Math.min(visibleParagraphs(scroller, root, -40).first, paras.length - 1) : 0];
                        const r = p ? rangeFor(root, paras, p.start, p.start) : null;
                        if (r) {
                          sel.removeAllRanges();
                          sel.addRange(r);
                        }
                      }}
                      onBlur={() => setFocused(false)}
                      data-testid="doc-text"
                    >
                      <DocTextBody views={views} seekLabel={timed.length ? t('workbench.media.playFrom') : null} />
                    </div>
                    <span id="wb-text-help" className="visually-hidden">
                      {t('workbench.text.help')}
                    </span>
                    <div ref={marginRef} className="wb-margin" aria-hidden={!showStripes}>
                      {showStripes ? <Stripes items={stripes.items} label={stripeLabel} onOpen={openStripe} onHover={setHovered} /> : null}
                    </div>
                    {pendingRects.map((r, i) => (
                      <span key={i} className="wb-sel" style={{ top: r.top, left: r.left, width: r.width, height: r.height }} />
                    ))}
                    {flash
                      ? flashRects.map((r, i) => <span key={`${flash.n}-${i}`} className="wb-flash" style={{ top: r.top - 1, left: r.left - 2, width: r.width + 4, height: r.height + 2 }} />)
                      : null}
                    {focused && caret && !pending ? <span className="wb-caret" style={{ top: caret.top, left: caret.left - 0.75, height: caret.height }} /> : null}
                  </div>
                )}
              </div>
              {drawer === 'segments' ? (
                <SegmentsDrawer
                  codings={shown}
                  codes={codeMap}
                  coders={coders}
                  meId={me.id}
                  onJump={(c) => jumpTo({ start: c.start, end: c.end })}
                  onRemove={(id) => removeCodings([id])}
                  onClose={closeDrawer}
                />
              ) : drawer === 'memos' ? (
                <MemosDrawer docId={docId} codings={codings} codes={codeMap} focusId={memoFocus} onJump={(c) => jumpTo({ start: c.start, end: c.end })} onClose={closeDrawer} />
              ) : null}
            </div>
            {doc?.media ? (
              <MediaBar
                ref={media}
                media={doc.media}
                follow={follow}
                onFollow={setFollow}
                onTime={onTime}
                keys={{ toggle: key('Space'), back: 'Alt+←', forward: 'Alt+→' }}
              />
            ) : null}
          </>
        )}
      </div>

      <Popover
        open={selOpen && !!pending && !editing && !resizing}
        onClose={() => setSelOpen(false)}
        anchor={selAnchor}
        side="bottom"
        align="start"
        autoFocus={false}
        aria-label={t('workbench.select.title')}
        className="wb-pop"
      >
        {pending ? (
          <SelectionPopover
            ref={selInput}
            options={options}
            recent={recent}
            excerpt={excerpt(text.slice(pending.start, pending.end), 70)}
            chars={pending.end - pending.start}
            query={selQuery}
            onQuery={setSelQuery}
            onApply={(id) => void applyTo(pending, id)}
            onCreate={createAndApply}
            createHint={activeCodeId && codeMap.get(activeCodeId) ? t('workbench.picker.under', { name: codeMap.get(activeCodeId)!.name }) : t('workbench.picker.atRoot')}
            onInVivo={doInVivo}
            onMemo={memoOnPassage}
            inVivoKey={key('I')}
          />
        ) : null}
      </Popover>

      <Popover open={!!codPop && popCodings.length > 0} onClose={() => setCodPop(null)} anchor={codAnchor} side="bottom" align="start" aria-label={t('workbench.coding.title')} className="wb-pop wb-pop--coding">
        <CodingPopover
          codings={popCodings}
          codes={codeMap}
          coders={coders}
          meId={me.id}
          options={options}
          memoCounts={memoCounts ?? new Map()}
          onRemove={(id) => removeCodings([id])}
          onRecode={doRecode}
          onOpenCode={(codeId) => go({ name: 'codes', codeId })}
          onMemo={memoForCoding}
          onAdjust={startAdjust}
          onComment={doComment}
        />
      </Popover>

      <ShortcutsDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
    </>
  );
});

function MoreMenu({ items, label }: { items: MenuEntry[]; label: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={btn} icon={Ellipsis} label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="viewer-more" />
      <Menu open={open} onClose={() => setOpen(false)} anchor={btn} items={items} align="end" label={label} />
    </>
  );
}

function CoderFilterButton({ filter, label, me, others, onChange }: { filter: CoderFilter; label: string; me: Coder; others: Coder[]; onChange: (f: CoderFilter) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const rows: { f: CoderFilter; label: string; color?: string; testId: string }[] = [
    { f: { kind: 'all' }, label: t('workbench.coders.all'), testId: 'coders-all' },
    { f: { kind: 'me' }, label: t('workbench.coders.meNamed', { name: me.name }), color: me.color, testId: 'coders-me' },
    ...others.map((c) => ({ f: { kind: 'coder', id: c.id } as CoderFilter, label: c.name, color: c.color, testId: `coders-${c.id}` })),
  ];
  const isOn = (f: CoderFilter) => coderFilterKey(f) === coderFilterKey(filter);
  return (
    <>
      <IconButton
        ref={btn}
        icon={Users}
        label={t('workbench.coders.button', { which: label })}
        pressed={filter.kind !== 'all'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="coder-filter"
      />
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} align="end" aria-label={t('workbench.coders.title')} className="wb-pop wb-pop--coders">
        <div className="wb-coders" role="radiogroup" aria-label={t('workbench.coders.title')}>
          <div className="wb-pop__title">{t('workbench.coders.title')}</div>
          {rows.map((r) => (
            <button
              key={r.testId}
              type="button"
              role="radio"
              aria-checked={isOn(r.f)}
              className={isOn(r.f) ? 'wb-coders__row is-on' : 'wb-coders__row'}
              onClick={() => {
                onChange(r.f);
                setOpen(false);
              }}
              data-testid={r.testId}
            >
              <span className="wb-coders__radio" aria-hidden />
              {r.color ? <span className="wb-coder__dot" style={{ background: r.color }} aria-hidden /> : <Users size={13} aria-hidden strokeWidth={1.75} />}
              <span className="wb-coders__name">{r.label}</span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
