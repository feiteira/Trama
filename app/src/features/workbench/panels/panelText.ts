// Small text helpers for the Workbench panels.

/** A definition squeezed onto a couple of lines: whitespace collapsed, cut at a word. */
export function definitionSummary(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}
