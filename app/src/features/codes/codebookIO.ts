// The codebook in and out of files other than REFI-QDA (.qdc is core/export/refi): a table
// (CSV / XLSX), Markdown and a Word report, and a codebook table read back and merged into the
// project's codebook by name. Pure: the screen supplies translated labels and does the writes.

import type { Code } from '../../core/model/types';
import { HEX_COLOR, LIMITS } from '../../core/model/types';
import type { QdcImport } from '../../core/export/refi';
import { chip, type Block, type ReportDocument } from '../../core/export/office';
import { fold } from '../../core/text/normalize';

/** One code as exported: the record, where it sits, and how much it is used. */
export interface CodebookEntry {
  code: Pick<Code, 'id' | 'name' | 'color' | 'codable' | 'shortcut' | 'description' | 'inclusion' | 'exclusion' | 'example'>;
  depth: number;
  /** Names from the top level down to the code itself. */
  path: string[];
  own: number;
  total: number;
  documents: number;
}

export const PATH_SEPARATOR = ' > ';

export const COLUMNS = ['name', 'path', 'parent', 'colour', 'codable', 'shortcut', 'definition', 'inclusion', 'exclusion', 'example', 'segments', 'documents'] as const;
export type Column = (typeof COLUMNS)[number];

/**
 * Header words recognised on import (folded), in the three interface languages and in the
 * words other programs use. Exported headers come from the interface catalogs and are listed
 * here too, so a table Trama wrote in any language reads back.
 */
const ALIASES: Record<Exclude<Column, 'segments' | 'documents'>, string[]> = {
  name: ['name', 'code', 'code name', 'nome', 'codigo', 'nome do codigo', 'nombre', 'nombre del codigo', 'label', 'title'],
  path: ['path', 'code path', 'hierarchy', 'caminho', 'hierarquia', 'ruta', 'jerarquia', 'full name'],
  parent: ['parent', 'parent code', 'parent path', 'pai', 'codigo pai', 'codigo superior', 'padre', 'codigo padre', 'codigo superior'],
  colour: ['colour', 'color', 'cor', 'colour code', 'hex'],
  codable: ['codable', 'codificavel', 'codificable', 'applicable', 'iscodable'],
  shortcut: ['shortcut', 'key', 'atalho', 'tecla', 'atajo'],
  definition: ['definition', 'description', 'memo', 'definicao', 'descricao', 'definicion', 'descripcion'],
  inclusion: ['inclusion', 'inclusion criteria', 'when to use', 'inclusao', 'criterios de inclusao', 'quando usar', 'criterios de inclusion', 'cuando usar', 'cuando aplicar', 'quando aplicar'],
  exclusion: ['exclusion', 'exclusion criteria', 'when not to use', 'exclusao', 'criterios de exclusao', 'quando nao usar', 'criterios de exclusion', 'cuando no usar', 'cuando no aplicar', 'quando nao aplicar'],
  example: ['example', 'examples', 'typical example', 'exemplo', 'exemplos', 'ejemplo', 'ejemplos'],
};

const TRUE_WORDS = new Set(['yes', 'y', 'true', '1', 'x', 'sim', 's', 'si', 'verdadeiro', 'verdadero']);
const FALSE_WORDS = new Set(['no', 'n', 'false', '0', 'nao', 'falso']);

// ---------------------------------------------------------------------------------------------
// Export

export interface TableLabels {
  headers: Record<Column, string>;
  yes: string;
  no: string;
}

/** The codebook as rows (header first) for CSV and XLSX. */
export function codebookTable(entries: readonly CodebookEntry[], labels: TableLabels): (string | number)[][] {
  const rows: (string | number)[][] = [COLUMNS.map((c) => labels.headers[c])];
  for (const e of entries) {
    rows.push([
      e.code.name,
      e.path.join(PATH_SEPARATOR),
      e.path.slice(0, -1).join(PATH_SEPARATOR),
      e.code.color,
      e.code.codable ? labels.yes : labels.no,
      e.code.shortcut ?? '',
      e.code.description,
      e.code.inclusion,
      e.code.exclusion,
      e.code.example,
      e.own,
      e.documents,
    ]);
  }
  return rows;
}

export interface ReportLabels {
  title: string;
  subtitle?: string;
  generator?: string;
  lang?: string;
  definition: string;
  inclusion: string;
  exclusion: string;
  example: string;
  /** "Category (groups codes)" */
  category: string;
  /** "12 coded segments in 4 documents" */
  usage: (e: CodebookEntry) => string;
  /** "Shortcut 3" */
  shortcut: (n: number) => string;
  /** Shown for an empty codebook. */
  empty: string;
}

/** The codebook as a Word/HTML report: one heading per code (nested to three levels). */
export function codebookReport(entries: readonly CodebookEntry[], labels: ReportLabels): ReportDocument {
  const blocks: Block[] = [];
  if (!entries.length) blocks.push({ type: 'paragraph', text: labels.empty });
  for (const e of entries) {
    const level = Math.min(3, e.depth + 1) as 1 | 2 | 3;
    const prefix = e.depth >= 3 ? `${e.path.slice(2, -1).join(' › ')} › ` : '';
    blocks.push({ type: 'heading', level, text: [chip(e.code.color), ' ', `${prefix}${e.code.name}`] });
    const meta = [e.code.codable ? labels.usage(e) : labels.category];
    if (e.code.shortcut) meta.push(labels.shortcut(e.code.shortcut));
    blocks.push({ type: 'paragraph', style: 'small', text: [{ text: meta.join(' · '), small: true, color: '#555a66' }] });
    if (e.code.description.trim()) blocks.push({ type: 'paragraph', text: e.code.description.trim() });
    for (const [key, label] of [
      ['inclusion', labels.inclusion],
      ['exclusion', labels.exclusion],
    ] as const) {
      const v = e.code[key].trim();
      if (v) blocks.push({ type: 'paragraph', text: [{ text: `${label}: `, bold: true }, v] });
    }
    if (e.code.example.trim()) {
      blocks.push({ type: 'paragraph', text: [{ text: `${labels.example}:`, bold: true }] });
      blocks.push({ type: 'paragraph', style: 'quote', text: e.code.example.trim() });
    }
  }
  return { title: labels.title, subtitle: labels.subtitle, generator: labels.generator, lang: labels.lang, blocks };
}

/** The codebook as Markdown: nested headings, definitions and criteria as paragraphs. */
export function codebookMarkdown(entries: readonly CodebookEntry[], labels: ReportLabels): string {
  const esc = (s: string) => s.replace(/([\\`*_[\]#<>|])/g, '\\$1');
  const out: string[] = [`# ${esc(labels.title)}`];
  if (labels.subtitle) out.push('', `*${esc(labels.subtitle)}*`);
  if (!entries.length) out.push('', labels.empty);
  for (const e of entries) {
    const level = Math.min(6, e.depth + 2);
    out.push('', `${'#'.repeat(level)} ${esc(e.code.name)}`);
    const meta = [e.code.codable ? labels.usage(e) : labels.category, e.code.color];
    if (e.code.shortcut) meta.push(labels.shortcut(e.code.shortcut));
    out.push('', `*${meta.map(esc).join(' · ')}*`);
    if (e.code.description.trim()) out.push('', e.code.description.trim());
    if (e.code.inclusion.trim()) out.push('', `**${esc(labels.inclusion)}:** ${e.code.inclusion.trim()}`);
    if (e.code.exclusion.trim()) out.push('', `**${esc(labels.exclusion)}:** ${e.code.exclusion.trim()}`);
    if (e.code.example.trim()) out.push('', `**${esc(labels.example)}:**`, '', ...e.code.example.trim().split('\n').map((l) => `> ${l}`));
  }
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------
// Import

/** A code read from a file. Text fields are null when the file had nothing for them. */
export interface ImportedCode {
  path: string[];
  color: string | null;
  codable: boolean | null;
  description: string | null;
  inclusion: string | null;
  exclusion: string | null;
  example: string | null;
}

export type TableProblem = 'noNameColumn' | 'empty';

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

export function splitPath(s: string): string[] {
  return s
    .split(/\s*(?:>|›|»)\s*/)
    .map((p) => tidy(p).slice(0, LIMITS.codeNameMax))
    .filter(Boolean);
}

function columnIndex(headers: readonly string[]): Partial<Record<Column, number>> {
  const out: Partial<Record<Column, number>> = {};
  headers.forEach((h, i) => {
    const k = fold(h).replace(/[:*()]/g, '').trim();
    for (const [col, words] of Object.entries(ALIASES) as [Column, string[]][]) {
      if (out[col] === undefined && words.includes(k)) {
        out[col] = i;
        return;
      }
    }
  });
  return out;
}

function normColour(s: string): string | null {
  const v = s.trim().toLowerCase();
  if (HEX_COLOR.test(v)) return v;
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null;
}

/**
 * Reads a codebook table: a name column (or a path column "A > B") is required; parent path,
 * colour, codable and the definition fields are optional. Rows without a name are skipped.
 */
export function parseCodebookTable(headers: readonly string[], rows: readonly (readonly string[])[]): { codes: ImportedCode[]; skipped: number; problem: TableProblem | null } {
  const col = columnIndex(headers);
  if (col.name === undefined && col.path === undefined) return { codes: [], skipped: rows.length, problem: 'noNameColumn' };
  const cell = (r: readonly string[], c: Column) => {
    const i = col[c];
    return i === undefined ? '' : (r[i] ?? '').trim();
  };
  const text = (r: readonly string[], c: Column) => {
    const v = cell(r, c);
    return v ? v.replace(/\r\n?/g, '\n') : null;
  };
  const codes: ImportedCode[] = [];
  let skipped = 0;
  for (const r of rows) {
    let path = col.path !== undefined ? splitPath(cell(r, 'path')) : [];
    const name = tidy(cell(r, 'name')).slice(0, LIMITS.codeNameMax);
    if (!path.length) {
      if (!name) {
        skipped++;
        continue;
      }
      path = [...splitPath(cell(r, 'parent')), name];
    }
    const codable = fold(cell(r, 'codable'));
    codes.push({
      path,
      color: normColour(cell(r, 'colour')),
      codable: TRUE_WORDS.has(codable) ? true : FALSE_WORDS.has(codable) ? false : null,
      description: text(r, 'definition'),
      inclusion: text(r, 'inclusion'),
      exclusion: text(r, 'exclusion'),
      example: text(r, 'example'),
    });
  }
  return { codes, skipped, problem: codes.length ? null : 'empty' };
}

/** Codes of a .qdc file as paths. */
export function importedFromQdc(qdc: QdcImport): ImportedCode[] {
  const byId = new Map(qdc.codes.map((c) => [c.id, c]));
  const pathOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let c = byId.get(id); c && !seen.has(c.id); c = c.parent_id ? byId.get(c.parent_id) : undefined) {
      seen.add(c.id);
      out.unshift(c.name);
    }
    return out;
  };
  return qdc.codes.map((c) => ({
    path: pathOf(c.id),
    color: c.color,
    codable: c.codable,
    description: c.description || null,
    inclusion: c.inclusion || null,
    exclusion: c.exclusion || null,
    example: c.example || null,
  }));
}

// ---------------------------------------------------------------------------------------------
// Merge plan

export type MergeField = 'color' | 'codable' | 'description' | 'inclusion' | 'exclusion' | 'example';
export type MergeFields = Partial<Pick<Code, MergeField>>;

export interface PlanItem {
  path: string[];
  status: 'new' | 'update' | 'same';
  /** The existing code it matched (update / same). */
  existingId: string | null;
  /** Created only because a code below it needs a parent. */
  implicit: boolean;
  /** For a new code: everything known; for an update: what changes. */
  fields: MergeFields;
}

export interface MergePlan {
  items: PlanItem[];
  created: number;
  updated: number;
  unchanged: number;
}

export interface ExistingCode {
  id: string;
  path: string[];
  code: Pick<Code, MergeField>;
}

const keyOf = (path: readonly string[]) => path.map((p) => fold(p)).join('\u0000');

/**
 * Matches imported codes to the codebook — by path, else by name when the name is unique on
 * both sides — and says what merging would do. Existing codes keep their place. Without
 * `overwrite` only empty definition fields are filled; with it, every value in the file wins.
 * New codes come parents first; missing parents are created.
 */
export function planCodebookMerge(existing: readonly ExistingCode[], imported: readonly ImportedCode[], opts: { overwrite: boolean }): MergePlan {
  const byPath = new Map(existing.map((e) => [keyOf(e.path), e]));
  const nameCount = new Map<string, number>();
  for (const e of existing) nameCount.set(fold(e.path[e.path.length - 1] ?? ''), (nameCount.get(fold(e.path[e.path.length - 1] ?? '')) ?? 0) + 1);
  const importedNames = new Map<string, number>();
  for (const c of imported) importedNames.set(fold(c.path[c.path.length - 1] ?? ''), (importedNames.get(fold(c.path[c.path.length - 1] ?? '')) ?? 0) + 1);
  const byName = new Map(existing.filter((e) => nameCount.get(fold(e.path[e.path.length - 1] ?? '')) === 1).map((e) => [fold(e.path[e.path.length - 1] ?? ''), e]));

  const items: PlanItem[] = [];
  const planned = new Map<string, PlanItem>();
  // Imported paths re-rooted onto the existing code they matched by name, so their children follow.
  const rename = new Map<string, string[]>();

  const resolvePath = (path: string[]): string[] => {
    for (let n = path.length - 1; n >= 1; n--) {
      const head = rename.get(keyOf(path.slice(0, n)));
      if (head) return [...head, ...path.slice(n)];
    }
    return path;
  };

  const sorted = imported.map((c, i) => ({ c, i })).sort((a, b) => a.c.path.length - b.c.path.length || a.i - b.i);
  for (const { c } of sorted) {
    if (!c.path.length) continue;
    let path = resolvePath(c.path);
    let match = byPath.get(keyOf(path));
    if (match) path = match.path;
    const name = fold(path[path.length - 1]!);
    if (!match && importedNames.get(name) === 1) {
      const m = byName.get(name);
      if (m) {
        match = m;
        rename.set(keyOf(c.path), m.path);
        path = m.path;
      }
    }
    const key = keyOf(path);
    if (planned.has(key) && !planned.get(key)!.implicit) continue; // the same code twice in the file
    // Parents that neither exist nor were planned are created first.
    for (let n = 1; !match && n < path.length; n++) {
      const pk = keyOf(path.slice(0, n));
      if (!byPath.has(pk) && !planned.has(pk)) {
        const it: PlanItem = { path: path.slice(0, n), status: 'new', existingId: null, implicit: true, fields: {} };
        planned.set(pk, it);
        items.push(it);
      }
    }
    if (match) {
      const fields: MergeFields = {};
      if (opts.overwrite) {
        if (c.color && c.color !== match.code.color) fields.color = c.color;
        if (c.codable !== null && c.codable !== match.code.codable) fields.codable = c.codable;
      }
      for (const f of ['description', 'inclusion', 'exclusion', 'example'] as const) {
        const v = c[f];
        if (!v || !v.trim()) continue;
        if (match.code[f].trim() === v.trim()) continue;
        if (opts.overwrite || !match.code[f].trim()) fields[f] = v.trim();
      }
      const it: PlanItem = { path, status: Object.keys(fields).length ? 'update' : 'same', existingId: match.id, implicit: false, fields };
      planned.set(key, it);
      items.push(it);
    } else {
      const fields: MergeFields = {};
      if (c.color) fields.color = c.color;
      if (c.codable !== null) fields.codable = c.codable;
      for (const f of ['description', 'inclusion', 'exclusion', 'example'] as const) if (c[f]?.trim()) fields[f] = c[f]!.trim();
      const prev = planned.get(key);
      if (prev) {
        // An implicit parent the file also lists later: it is a real code after all.
        prev.implicit = false;
        prev.fields = fields;
      } else {
        const it: PlanItem = { path, status: 'new', existingId: null, implicit: false, fields };
        planned.set(key, it);
        items.push(it);
      }
    }
  }
  items.sort((a, b) => a.path.length - b.path.length);
  return {
    items,
    created: items.filter((i) => i.status === 'new').length,
    updated: items.filter((i) => i.status === 'update').length,
    unchanged: items.filter((i) => i.status === 'same').length,
  };
}

/** The key a plan uses for a path (to map planned paths to ids while creating). */
export const pathKey = keyOf;

/** A file name without characters file systems refuse. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'codebook';
}
