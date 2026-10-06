// REFI-QDA codebook exchange (.qdc): a single XML file with the code tree.
import type { Code, Draft } from '../../model/types';
import type { QdpxWarning } from './qdpx-import';
import { HEX_COLOR, LIMITS, PALETTE } from '../../model/types';
import { uuid } from '../../ids';
import {
  cleanName,
  CODEBOOK_NS,
  decodeRefiText,
  CODEBOOK_SCHEMA_LOCATION,
  GuidMap,
  normColor,
  normGuid,
  RefiError,
  splitCodeDescription,
  XSI_NS,
} from './common';
import { codeDescription } from './qdpx-export';
import { attr, child, children, localName, parseXml, textOf, XmlWriter } from './xml';

export interface QdcExportOptions {
  /** The producer, e.g. "Trama 0.1.0" (CodeBook@origin). */
  origin: string;
}

/**
 * The codebook as .qdc XML. Deleted codes are left out (and so are their sub-codes, which a
 * delete removes with them); the hierarchy follows parent_id and sibling order.
 */
export function exportQdc(codes: readonly Code[], opts: QdcExportOptions): string {
  const live = codes.filter((c) => !c.deleted);
  const ids = new Set(live.map((c) => c.id));
  const byParent = new Map<string | null, Code[]>();
  for (const c of [...live].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))) {
    const parent = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null;
    const list = byParent.get(parent);
    if (list) list.push(c);
    else byParent.set(parent, [c]);
  }
  const guids = new GuidMap();
  const written = new Set<string>();
  const x = new XmlWriter();
  const writeCode = (c: Code) => {
    written.add(c.id);
    x.open('Code', { guid: guids.get(c.id), name: c.name, isCodable: c.codable, color: HEX_COLOR.test(c.color) ? c.color.toUpperCase() : undefined });
    const desc = codeDescription(c);
    if (desc) x.leaf('Description', {}, desc);
    for (const k of byParent.get(c.id) ?? []) if (!written.has(k.id)) writeCode(k);
    x.close();
  };
  x.declaration();
  x.open('CodeBook', { xmlns: CODEBOOK_NS, 'xmlns:xsi': XSI_NS, 'xsi:schemaLocation': CODEBOOK_SCHEMA_LOCATION, origin: opts.origin });
  x.open('Codes');
  for (const c of byParent.get(null) ?? []) writeCode(c);
  for (const c of live) if (!written.has(c.id)) writeCode(c); // parent cycles (corrupt data)
  // The schema needs at least one Code: an empty codebook still opens elsewhere.
  if (!live.length) x.leaf('Code', { guid: guids.fresh(), name: 'Codes', isCodable: false });
  x.close().close();
  return x.toString();
}

export interface QdcImport {
  /** Code drafts with ids; parent_id points to another draft in the list. Parents come first. */
  codes: (Draft<'code'> & { id: string })[];
  origin: string | null;
  /** What could not be imported, in plain English (the messages of `issues`). */
  warnings: string[];
  /** The same as data, coded like a project import's warnings. */
  issues: QdpxWarning[];
}

/** Reads a .qdc (text or bytes). Throws RefiError when it is not a REFI-QDA codebook. */
export function importQdc(input: string | Uint8Array): QdcImport {
  const xml = typeof input === 'string' ? input : decodeRefiText(input).text;
  let root;
  try {
    root = parseXml(xml);
  } catch (e) {
    throw new RefiError(`This codebook is not valid XML (${e instanceof Error ? e.message : String(e)}).`);
  }
  // A codebook, or a whole project's codebook when someone renames a .qde.
  let codesEl = localName(root) === 'CodeBook' ? child(root, 'Codes') : undefined;
  if (localName(root) === 'Project') {
    const cb = child(root, 'CodeBook');
    codesEl = cb && child(cb, 'Codes');
  }
  if (localName(root) !== 'CodeBook' && localName(root) !== 'Project') throw new RefiError('This file is not a REFI-QDA codebook.');
  const origin = (attr(root, 'origin') ?? '').trim() || null;
  const trama = origin !== null && /^trama\b/i.test(origin);
  const codes: QdcImport['codes'] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  let colorIndex = 0;
  const read = (parentEl: NonNullable<typeof codesEl>, parent: string | null) => {
    let order = 0;
    for (const c of children(parentEl, 'Code')) {
      const g = normGuid(attr(c, 'guid'));
      if (g && seen.has(g)) {
        read(c, parent);
        continue;
      }
      if (g) seen.add(g);
      const isCodable = (attr(c, 'isCodable') ?? 'true').trim().toLowerCase();
      const desc = textOf(child(c, 'Description')).trim();
      const sections = trama ? splitCodeDescription(desc) : { description: desc, inclusion: '', exclusion: '', example: '' };
      const id = uuid();
      codes.push({
        id,
        name: cleanName(attr(c, 'name'), LIMITS.codeNameMax, `Code ${codes.length + 1}`),
        parent_id: parent,
        color: normColor(attr(c, 'color')) ?? PALETTE[colorIndex++ % PALETTE.length]!,
        ...sections,
        order: ++order,
        codable: !(isCodable === 'false' || isCodable === '0'),
        shortcut: null,
      });
      read(c, id);
    }
  };
  if (codesEl) read(codesEl, null);
  const sets = child(root, 'Sets');
  const nSets = sets ? children(sets, 'Set').length : 0;
  // Code sets: in a .qdc their members use guid="…" (in a .qde, targetGUID). Trama has no code
  // sets yet, so they are only reported.
  const issues: QdpxWarning[] = nSets ? [{ code: 'codeSet', count: nSets, message: `${nSets} set(s) of codes were not imported (Trama has no code sets).` }] : [];
  for (const w of issues) warnings.push(w.message);
  return { codes, origin, warnings, issues };
}
