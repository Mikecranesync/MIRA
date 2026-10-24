// Pure: split a run of answer text into plain-text and `[n]` citation-mark
// segments. Used by the markdown renderer's `text` node so a citation chip
// keeps working INSIDE a rendered list item / table cell / paragraph (RNDR-1)
// — the string is never pre-split before markdown parsing, because that would
// break block structure (a `[1]` inside a table cell would split the row).
//
// Only `[digits]` is a mark, and only when a citation with that id exists in
// the turn: an unrelated bracket like `[see manual]` stays literal text. A
// numeric `[12]` with no matching source is stripped — never a bare marker
// and never a dead chip.

export type MarkSegment = { kind: "text"; text: string } | { kind: "cite"; id: string };

// Same digit rule as the Hub renderer and server stripper (`\[(\d+)\]`): a
// 4+-digit unknown marker must be stripped here too, not left as bare text.
const MARK = /\[(\d+)\]/g;

function pushText(out: MarkSegment[], text: string) {
  if (!text) return;
  const prev = out[out.length - 1];
  if (prev?.kind === "text") prev.text += text;
  else out.push({ kind: "text", text });
}

export function splitCitationMarks(text: string, knownIds: ReadonlySet<string>): MarkSegment[] {
  const out: MarkSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    const idx = m.index ?? 0;
    const known = knownIds.has(m[1]);
    if (!known) {
      // Strip the unmatched marker and the spaces/tabs before it so it never
      // renders as a bare [n] — same `[ \t]*\[n\]` rule as the Hub renderer
      // and the server stripper (citation-markers.ts).
      let from = idx;
      while (from > last && /[ \t]/.test(text[from - 1] ?? "")) from -= 1;
      if (from > last) pushText(out, text.slice(last, from));
      last = idx + m[0].length;
      continue;
    }
    if (idx > last) pushText(out, text.slice(last, idx));
    out.push({ kind: "cite", id: m[1] });
    last = idx + m[0].length;
  }
  if (last < text.length) pushText(out, text.slice(last));
  return out;
}
