// A small XML writer (escaping, no DOM) and the few read helpers the REFI-QDA importers need.
// Shared by the office writers, which produce XML too. Parsing goes through @xmldom/xmldom,
// which runs the same in Node (tests) and in the webview.
import { DOMParser, type Element, type Node } from '@xmldom/xmldom';

// XML 1.0 allows tab, LF, CR, U+0020–U+D7FF, U+E000–U+FFFD and the astral planes. Anything
// else (C0 controls, lone surrogates, U+FFFE/U+FFFF) makes the whole file unreadable, so it
// is dropped rather than escaped: there is no escape for it in XML 1.0.
const INVALID_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;

export function stripInvalidXmlChars(s: string): string {
  return s.replace(INVALID_XML, '');
}

/** Element text: `&`, `<`, `>` escaped; CR kept as a reference so a parser does not drop it. */
export function xmlText(s: string): string {
  return stripInvalidXmlChars(s).replace(/[&<>\r]/g, (c) => TEXT_ESCAPES[c]!);
}

/**
 * Attribute value (for double quotes). Tab, LF and CR are written as references because a
 * parser turns literal ones into spaces (attribute-value normalisation).
 */
export function xmlAttr(s: string): string {
  return stripInvalidXmlChars(s).replace(/[&<>"'\t\n\r]/g, (c) => ATTR_ESCAPES[c]!);
}

const TEXT_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\r': '&#13;' };
const ATTR_ESCAPES: Record<string, string> = {
  ...TEXT_ESCAPES,
  '"': '&quot;',
  "'": '&apos;',
  '\t': '&#9;',
  '\n': '&#10;',
};

export type XmlAttrs = Record<string, string | number | boolean | null | undefined>;

interface Open {
  name: string;
  /** The start tag still lacks its closing `>` (so an empty element can self-close). */
  pending: boolean;
  hasChildren: boolean;
}

/**
 * Streams elements into a string. Attributes whose value is null/undefined are left out, so
 * optional attributes can be passed unconditionally. Element names are trusted (they are
 * literals in our code); every value and text is escaped.
 */
export class XmlWriter {
  private parts: string[] = [];
  private stack: Open[] = [];

  constructor(private readonly indent: string = '  ') {}

  declaration(standalone = false): this {
    this.parts.push(`<?xml version="1.0" encoding="UTF-8"${standalone ? ' standalone="yes"' : ''}?>`);
    if (!this.indent) this.parts.push('\n');
    return this;
  }

  open(name: string, attrs: XmlAttrs = {}): this {
    this.beforeChild();
    this.parts.push(`<${name}${formatAttrs(attrs)}`);
    this.stack.push({ name, pending: true, hasChildren: false });
    return this;
  }

  /** Text inside the current element. Keep text-bearing elements free of child elements. */
  text(s: string): this {
    const top = this.stack[this.stack.length - 1];
    if (!top) throw new Error('XmlWriter: text outside an element');
    if (top.pending) {
      this.parts.push('>');
      top.pending = false;
    }
    this.parts.push(xmlText(s));
    return this;
  }

  close(): this {
    const top = this.stack.pop();
    if (!top) throw new Error('XmlWriter: nothing to close');
    if (top.pending) {
      this.parts.push('/>');
    } else {
      if (top.hasChildren) this.newline(this.stack.length);
      this.parts.push(`</${top.name}>`);
    }
    return this;
  }

  /** An element with optional text and no children. Empty text gives `<name/>`. */
  leaf(name: string, attrs: XmlAttrs = {}, text?: string | null): this {
    this.open(name, attrs);
    if (text) this.text(text);
    return this.close();
  }

  /** Inserts markup produced elsewhere (already escaped) as a child of the current element. */
  raw(markup: string): this {
    this.beforeChild();
    this.parts.push(markup);
    return this;
  }

  toString(): string {
    if (this.stack.length) throw new Error(`XmlWriter: <${this.stack[this.stack.length - 1]!.name}> not closed`);
    return this.parts.join('') + (this.indent ? '\n' : '');
  }

  private beforeChild(): void {
    const top = this.stack[this.stack.length - 1];
    if (top) {
      if (top.pending) {
        this.parts.push('>');
        top.pending = false;
      }
      top.hasChildren = true;
    }
    this.newline(this.stack.length);
  }

  private newline(depth: number): void {
    if (this.indent && this.parts.length) this.parts.push('\n' + this.indent.repeat(depth));
  }
}

function formatAttrs(attrs: XmlAttrs): string {
  let s = '';
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    s += ` ${k}="${xmlAttr(String(v))}"`;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Reading

export class XmlParseError extends Error {}

/**
 * Parses XML text and returns the root element. Throws XmlParseError on malformed input.
 * Line endings are normalised the XML 1.0 way only (CRLF and CR → LF): xmldom's default
 * follows XML 1.1 and would also rewrite U+0085, U+2028 and U+2029 inside text.
 */
export function parseXml(source: string): Element {
  const errors: string[] = [];
  const parser = new DOMParser({
    locator: true,
    normalizeLineEndings: (s: string) => s.replace(/\r\n?/g, '\n'),
    onError: (level, msg) => {
      if (level === 'fatalError') throw new XmlParseError(msg);
      if (level === 'error') errors.push(msg);
    },
  });
  let doc;
  try {
    doc = parser.parseFromString(source.replace(/^﻿/, ''), 'text/xml');
  } catch (e) {
    throw e instanceof XmlParseError ? e : new XmlParseError(e instanceof Error ? e.message : String(e));
  }
  const root = doc.documentElement;
  if (!root) throw new XmlParseError(errors[0] ?? 'no root element');
  return root;
}

const isElement = (n: Node): n is Element => n.nodeType === 1;

/** Name without namespace prefix: REFI files exist with 1.0, pre-1.0 and prefixed namespaces. */
export function localName(el: Element): string {
  return el.localName ?? el.nodeName.replace(/^.*:/, '');
}

/** Child elements, optionally only those with the given local name(s). */
export function children(el: Element, ...names: string[]): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (isElement(n) && (names.length === 0 || names.includes(localName(n)))) out.push(n);
  }
  return out;
}

export function child(el: Element, name: string): Element | undefined {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (isElement(n) && localName(n) === name) return n;
  }
  return undefined;
}

/** All descendants with the given local name, in document order. */
export function descendants(el: Element, name: string): Element[] {
  const out: Element[] = [];
  const walk = (e: Element) => {
    for (let n = e.firstChild; n; n = n.nextSibling) {
      if (!isElement(n)) continue;
      if (localName(n) === name) out.push(n);
      walk(n);
    }
  };
  walk(el);
  return out;
}

/** Text content (text and CDATA, descendants included). */
export function textOf(el: Element | undefined): string {
  return el?.textContent ?? '';
}

/** An attribute's value, or null when absent. */
export function attr(el: Element, name: string): string | null {
  return el.hasAttribute(name) ? el.getAttribute(name) : null;
}
