// The welcome screen's coded specimen is written in the catalogs as text with marks, so it
// translates as whole sentences: "Honestly, [a]loneliness[/a]." A mark is one lower-case
// letter naming a code. Marks do not nest; anything malformed stays as plain text.

export interface Piece {
  text: string;
  /** The code letter, or null for plain text. */
  code: string | null;
}

const MARK = /\[([a-z])\]([\s\S]*?)\[\/\1\]/g;

export function parseMarks(s: string): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const m of s.matchAll(MARK)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: s.slice(at, i), code: null });
    if (m[2]) out.push({ text: m[2], code: m[1]! });
    at = i + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at), code: null });
  return out;
}

/** The codes a marked text uses, in order of first use. */
export function codesIn(s: string): string[] {
  return [...new Set(parseMarks(s).flatMap((p) => (p.code ? [p.code] : [])))];
}
