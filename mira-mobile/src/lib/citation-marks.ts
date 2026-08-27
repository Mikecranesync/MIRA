// Pure: split a run of answer text into plain-text and `[n]` citation-mark
// segments. Used by the markdown renderer's `text` node so a citation chip
// keeps working INSIDE a rendered list item / table cell / paragraph (RNDR-1)
// — the string is never pre-split before markdown parsing, because that would
// break block structure (a `[1]` inside a table cell would split the row).
//
// Only `[digits]` is a mark, and only when a citation with that id exists in
// the turn: an unrelated bracket like `[see manual]` or a numeric `[12]` with
// no matching source stays literal text — never a dead chip.

export type MarkSegment = { kind: "text"; text: string } | { kind: "cite"; id: string };

const MARK = /\[(\d{1,3})\]/g;

export function splitCitationMarks(text: string, knownIds: ReadonlySet<string>): MarkSegment[] {
  const out: MarkSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    const idx = m.index ?? 0;
    if (!knownIds.has(m[1])) continue;
    if (idx > last) out.push({ kind: "text", text: text.slice(last, idx) });
    out.push({ kind: "cite", id: m[1] });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
