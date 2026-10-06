import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Attribute, Case, Code, Coding, DocGroup, Document } from '../../../core/model/types';
import { SETTING_KEYS } from '../../../core/model/types';
import { buildTree, type CodeTree } from '../../../core/qda/tree';
import { useLive } from '../../../shell/useLive';
import { type CodeLine, codeLines, segmentCounts } from '../lib/codeLines';
import { ALL_CODERS, type CoderCount, coderCounts, effectiveScope, scopeCodings } from '../lib/coders';
import type { Theme } from '../lib/heat';

// What every analysis tool reads: the project's records, loaded once for the screen and
// refreshed when they change. Document texts are heavy (a transcript can be a megabyte) and
// only some tools need them, so they load on demand (useTexts).

export interface AnalysisData {
  /** Live documents in list order. */
  documents: Document[];
  docById: Map<string, Document>;
  codes: Code[];
  codeById: Map<string, Code>;
  tree: CodeTree<Code>;
  /** The codebook in display order. */
  lines: CodeLine[];
  /**
   * Live codings whose document and code are live, of the coder in scope; for all coders,
   * a segment coded alike by several coders is here once (lib/coders.ts).
   */
  codings: Coding[];
  /** The same codings before identical segments were merged (co-occurrence within coders). */
  rawCodings: Coding[];
  /** Whose codings: a coder id, or ALL_CODERS. */
  coderScope: string;
  /** Coders who have codings, most first. */
  coders: CoderCount[];
  /** Several coders' codings are counted together. */
  pooled: boolean;
  codingById: Map<string, Coding>;
  /** Own segments per code. */
  segments: Map<string, number>;
  groups: DocGroup[];
  cases: Case[];
  attributes: Attribute[];
  /** The material's language (project setting), for stop words. */
  language: string | null;
  extraStopwords: string[];
  descendants: (id: string) => Code[];
}

const Ctx = createContext<AnalysisData | null>(null);

export function useAnalysisData(): AnalysisData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAnalysisData outside AnalysisDataProvider');
  return v;
}

/** `coderChoice`: the coder chosen on screen ('' lets the screen pick, see effectiveScope). */
export function useLoadAnalysisData(coderChoice: string, meId: string): { data: AnalysisData | undefined; error: unknown } {
  const { data, error } = useLive(
    async (store) => {
      const [documents, codes, codings, groups, cases, attributes, lang, extra, coders] = await Promise.all([
        store.list('document', { order: 'sort, id' }),
        store.list('code'),
        store.list('coding'),
        store.list('docgroup', { order: 'sort, id' }),
        store.list('case'),
        store.list('attribute', { order: 'sort, id' }),
        store.get('setting', SETTING_KEYS.textLanguage),
        store.get('setting', SETTING_KEYS.extraStopwords),
        store.list('coder'),
      ]);
      return { documents, codes, codings, groups, cases, attributes, lang, extra, coders };
    },
    [],
    ['document', 'code', 'coding', 'docgroup', 'case', 'attribute', 'setting', 'coder'],
  );
  const value = useMemo<AnalysisData | undefined>(() => {
    if (!data) return undefined;
    const tree = buildTree(data.codes);
    const docById = new Map(data.documents.map((d) => [d.id, d]));
    const codeById = new Map(data.codes.map((c) => [c.id, c]));
    const live = data.codings.filter((c) => docById.has(c.document_id) && codeById.has(c.code_id));
    const coders = coderCounts(live, new Map(data.coders.map((c) => [c.id, c.name])));
    const coderScope = effectiveScope(coderChoice, coders, meId);
    const { counted: codings, raw: rawCodings } = scopeCodings(live, coderScope, meId);
    const lang = data.lang && !data.lang.deleted && typeof data.lang.value === 'string' ? data.lang.value : null;
    const extraRaw = data.extra && !data.extra.deleted ? data.extra.value : null;
    const extra = Array.isArray(extraRaw) ? extraRaw.filter((w): w is string => typeof w === 'string') : typeof extraRaw === 'string' ? extraRaw.split(/[\s,;]+/).filter(Boolean) : [];
    const sortedAttrs = [...data.attributes].sort((a, b) => a.order - b.order);
    return {
      documents: data.documents,
      docById,
      codes: data.codes,
      codeById,
      tree,
      lines: codeLines(tree.flatten()),
      codings,
      rawCodings,
      coderScope,
      coders,
      pooled: coderScope === ALL_CODERS && coders.length > 1,
      codingById: new Map(rawCodings.map((c) => [c.id, c])),
      segments: segmentCounts(codings),
      groups: data.groups,
      cases: data.cases,
      attributes: sortedAttrs,
      language: lang,
      extraStopwords: extra,
      descendants: (id: string) => tree.descendants(id),
    };
  }, [data, coderChoice, meId]);
  return { data: value, error };
}

export function AnalysisDataProvider({ value, children }: { value: AnalysisData; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Every live document's text, loaded when `enabled` first becomes true; null until then. */
export function useTexts(enabled: boolean): Map<string, string> | null {
  const { data } = useLive(
    async (store) => {
      if (!enabled) return null;
      const texts = await store.list('doctext');
      return new Map(texts.map((t) => [t.id, t.text]));
    },
    [enabled],
    ['doctext'],
  );
  return data ?? null;
}

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The theme in effect (the researcher's choice, else the system's), following changes. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const update = () => setTheme(currentTheme());
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
    mq?.addEventListener('change', update);
    return () => {
      mo.disconnect();
      mq?.removeEventListener('change', update);
    };
  }, []);
  return theme;
}

/**
 * A value computed after the browser has painted, so a heavy query never blocks the click that
 * asked for it. Returns the last result while the next one is computing (`busy`).
 */
export function useDeferredCompute<T>(compute: () => T, deps: unknown[]): { value: T | undefined; busy: boolean; error: unknown } {
  const [state, setState] = useState<{ value: T | undefined; busy: boolean; error: unknown }>({ value: undefined, busy: true, error: null });
  useEffect(() => {
    let live = true;
    setState((s) => (s.busy ? s : { ...s, busy: true }));
    const id = setTimeout(() => {
      if (!live) return;
      try {
        const value = compute();
        if (live) setState({ value, busy: false, error: null });
      } catch (error) {
        if (live) setState({ value: undefined, busy: false, error });
      }
    }, 0);
    return () => {
      live = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
