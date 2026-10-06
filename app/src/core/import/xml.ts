import { DOMParser, type Document, type Element, type Node } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import { ImportError } from './types';

// Shared helpers for the zip-of-XML formats (ODT, XLSX): bounded unzipping and a parser that
// fails with DAMAGED instead of logging to the console.

/** More than this, uncompressed, in one entry is a zip bomb or not something we can hold. */
export const MAX_ENTRY = 512 * 1024 * 1024;
/** Most all the inflated entries of one file may add up to. */
export const MAX_TOTAL = 1024 * 1024 * 1024;

// fflate inflates each entry into a buffer of exactly its declared size, so checking declared
// sizes before inflating refuses a zip bomb before the memory is allocated.

/** Inflates the entries `want` accepts. Throws ImportError DAMAGED for a broken archive. */
export function readZip(bytes: Uint8Array, want: (name: string) => boolean): Record<string, Uint8Array> {
  checkZipSizes(bytes, want);
  try {
    return unzipSync(bytes, { filter: (f) => want(f.name) });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('DAMAGED', 'zip', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Throws ImportError TOO_LARGE when the entries `want` accepts would inflate past the limits
 * (DAMAGED when the archive cannot be listed). Nothing is inflated.
 */
export function checkZipSizes(bytes: Uint8Array, want: (name: string) => boolean): void {
  let total = 0;
  try {
    unzipSync(bytes, {
      filter: (f) => {
        if (!want(f.name)) return false;
        total += f.originalSize;
        if (f.originalSize > MAX_ENTRY || total > MAX_TOTAL) throw new ImportError('TOO_LARGE', f.name);
        return false;
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('DAMAGED', 'zip', e instanceof Error ? e.message : String(e));
  }
}

export function zipText(files: Record<string, Uint8Array>, name: string): string | null {
  const b = files[name];
  if (!b) return null;
  // XML files may start with a UTF-8 BOM.
  return strFromU8(b).replace(/^\u{feff}/u, '');
}

export function parseXml(xml: string, what: string): Document {
  try {
    return new DOMParser({
      locator: false,
      onError: (level, msg) => {
        if (level === 'fatalError') throw new Error(msg);
      },
    }).parseFromString(xml, 'text/xml');
  } catch (e) {
    throw new ImportError('DAMAGED', what, e instanceof Error ? e.message : String(e));
  }
}

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const CDATA_SECTION_NODE = 4;

export function isElement(n: Node | null | undefined): n is Element {
  return !!n && n.nodeType === ELEMENT_NODE;
}

/** Child elements (in order), optionally only those with this namespace and local name. */
export function childElements(parent: Node, ns?: string, local?: string): Element[] {
  const out: Element[] = [];
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (isElement(c) && (ns === undefined || (c.namespaceURI === ns && c.localName === local))) out.push(c);
  }
  return out;
}

export function firstChild(parent: Node, ns: string, local: string): Element | null {
  for (let c = parent.firstChild; c; c = c.nextSibling) if (isElement(c) && c.namespaceURI === ns && c.localName === local) return c;
  return null;
}

/** Every descendant element with this namespace and local name, in document order. */
export function descendants(root: Node, ns: string, local: string): Element[] {
  const out: Element[] = [];
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (!isElement(c)) continue;
      if (c.namespaceURI === ns && c.localName === local) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** Concatenated text of all descendant text nodes. */
export function textContent(n: Node): string {
  let s = '';
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === TEXT_NODE || c.nodeType === CDATA_SECTION_NODE) s += c.nodeValue ?? '';
    else if (isElement(c)) s += textContent(c);
  }
  return s;
}
