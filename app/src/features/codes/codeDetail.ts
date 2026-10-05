// View-model helpers of a code's detail page: the words around a coded segment, and how the
// code is spread over documents and coders.

export interface SegmentContext {
  before: string;
  text: string;
  after: string;
  /** Text was cut before / after the context shown. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * The coded text with up to `radius` characters either side, staying inside its paragraph and
 * cut at a word so the preview reads cleanly.
 */
export function segmentContext(full: string, start: number, end: number, radius = 120, maxText = 600): SegmentContext {
  const s = Math.max(0, Math.min(start, full.length));
  const e = Math.max(s, Math.min(end, full.length));
  const paraStart = full.lastIndexOf('\n', s - 1) + 1;
  const nl = full.indexOf('\n', e);
  const paraEnd = nl < 0 ? full.length : nl;
  let from = Math.max(paraStart, s - radius);
  let to = Math.min(paraEnd, e + radius);
  if (from > paraStart) {
    const sp = full.indexOf(' ', from);
    if (sp >= 0 && sp < s) from = sp + 1;
  }
  if (to < paraEnd) {
    const sp = full.lastIndexOf(' ', to);
    if (sp > e) to = sp;
  }
  let text = full.slice(s, e);
  let clippedText = false;
  if (text.length > maxText) {
    text = text.slice(0, maxText).replace(/\s+\S*$/, '');
    clippedText = true;
  }
  return {
    before: full.slice(from, s),
    text,
    after: clippedText ? '' : full.slice(e, to),
    clippedStart: from > paraStart,
    clippedEnd: clippedText || to < paraEnd,
  };
}

export interface DocBar {
  id: string;
  name: string;
  count: number;
}

/** Coded segments per document, in the documents' list order (documents without any left out). */
export function perDocument(codings: readonly { document_id: string }[], docs: readonly { id: string; name: string }[]): DocBar[] {
  const counts = new Map<string, number>();
  for (const c of codings) counts.set(c.document_id, (counts.get(c.document_id) ?? 0) + 1);
  return docs.filter((d) => counts.has(d.id)).map((d) => ({ id: d.id, name: d.name, count: counts.get(d.id)! }));
}

/** Coders who applied the code, most codings first. */
export function perCoder(codings: readonly { coder_id: string }[], coders: readonly { id: string; name: string; color: string }[]): { id: string; name: string; color: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of codings) counts.set(c.coder_id, (counts.get(c.coder_id) ?? 0) + 1);
  return coders
    .filter((c) => counts.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, color: c.color, count: counts.get(c.id)! }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
