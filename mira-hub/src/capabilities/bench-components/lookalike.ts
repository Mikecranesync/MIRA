/**
 * What a typed catalog number is close to, among the numbers this bench's
 * documents declare — so the confirmation card can show the exact difference
 * and let the technician choose. It never chooses: a look-alike is a candidate
 * to show, and the technician's own Confirm is the only thing that makes an
 * identity (selection.ts, validate.ts).
 *
 * Material differences are letters and digits. A space or a dash is spelling
 * ("GS11N 20P2" is "GS11N-20P2"); "O" and "0", or a dropped suffix letter, are
 * not — those are exactly what the card has to point at, never fold away.
 */

/** Characters a label read (by eye or by OCR) commonly swaps. Used only to find
 *  candidates; two numbers that differ by one of these are still different. */
const CONFUSABLE: Readonly<Record<string, string>> = { O: "0", Q: "0", I: "1", L: "1", S: "5", B: "8", Z: "2", G: "6" };

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const fold = (s: string) => [...s].map((ch) => CONFUSABLE[ch] ?? ch).join("");

export type DiffSegment =
  | { kind: "same"; text: string }
  /** The candidate has `text` where the typed number has `typed`. */
  | { kind: "changed"; text: string; typed: string }
  /** The candidate has `text` and the typed number has nothing there. */
  | { kind: "added"; text: string }
  /** The typed number has `typed` here and the candidate has nothing. */
  | { kind: "missing"; typed: string };

export type LookAlike = {
  /** The candidate, as the document writes it. */
  label: string;
  /** Where it was read from (a document's filename, or "the device schedule"). */
  from: string;
  /** The candidate written out with each material difference marked. */
  diff: DiffSegment[];
  /** Plain words for the difference: `"0" (zero) where you typed "O" (letter O)`. */
  summary: string;
};

type Op = { op: "same" | "sub"; a: string; b: string } | { op: "ins"; b: string } | { op: "del"; a: string };

/** Edit script turning `a` into `b` (Levenshtein, substitutions preferred). */
function align(a: string, b: string): Op[] {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
    }
  }
  const ops: Op[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      ops.push({ op: a[i - 1] === b[j - 1] ? "same" : "sub", a: a[i - 1], b: b[j - 1] });
      i--;
      j--;
    } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
      ops.push({ op: "ins", b: b[j - 1] });
      j--;
    } else {
      ops.push({ op: "del", a: a[i - 1] });
      i--;
    }
  }
  return ops.reverse();
}

const distance = (ops: Op[]) => ops.filter((o) => o.op !== "same").length;

const charName = (ch: string) =>
  /\d/.test(ch) ? `"${ch}"${ch === "0" ? " (zero)" : ch === "1" ? " (one)" : ""}` : `"${ch}"${ch === "O" ? " (letter O)" : ch === "I" ? " (letter I)" : ch === "L" ? " (letter L)" : ""}`;

/** The candidate's own label with the edit script laid over it (separators kept as written). */
function diffOver(label: string, ops: Op[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  const push = (seg: DiffSegment) => {
    const last = out[out.length - 1];
    if ((seg.kind === "same" || seg.kind === "added") && last?.kind === seg.kind) last.text += seg.text;
    else if (seg.kind === "missing" && last?.kind === "missing") last.typed += seg.typed;
    else out.push(seg);
  };
  let k = 0;
  for (const ch of label) {
    if (!/[A-Za-z0-9]/.test(ch)) {
      push({ kind: "same", text: ch });
      continue;
    }
    while (k < ops.length && ops[k].op === "del") push({ kind: "missing", typed: (ops[k++] as { a: string }).a });
    const o = ops[k++];
    if (!o) break;
    if (o.op === "same") push({ kind: "same", text: ch });
    else if (o.op === "sub") push({ kind: "changed", text: ch, typed: o.a });
    else if (o.op === "ins") push({ kind: "added", text: ch });
  }
  while (k < ops.length) {
    const o = ops[k++];
    if (o.op === "del") push({ kind: "missing", typed: o.a });
  }
  return out;
}

function summaryOf(diff: DiffSegment[]): string {
  const parts = diff.flatMap((s) =>
    s.kind === "changed"
      ? [`${charName(s.text.toUpperCase())} where you typed ${charName(s.typed)}`]
      : s.kind === "added"
        ? [`an extra ${charName(s.text.toUpperCase())}`]
        : s.kind === "missing"
          ? [`no ${charName(s.typed)}`]
          : [],
  );
  return parts.join("; ");
}

/**
 * The look-alikes of `typed` among `known` numbers, closest first. A candidate
 * is a number that is not the typed one but differs only by commonly swapped
 * characters, by up to two characters added or dropped at the end, or by one
 * character in a number of five or more. An exact match is not a look-alike
 * (see `exactMatches`).
 */
export function lookAlikes(typed: string, known: readonly { label: string; from: string }[]): LookAlike[] {
  const a = alnum(typed);
  if (a.length < 3) return [];
  const seen = new Set<string>();
  const out: (LookAlike & { rank: number })[] = [];
  for (const k of known) {
    const b = alnum(k.label);
    if (!b || b === a || seen.has(b)) continue;
    const ops = align(a, b);
    const dist = distance(ops);
    const confusable = a.length === b.length && fold(a) === fold(b);
    let shared = 0;
    while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
    const suffix = shared >= 4 && shared === Math.min(a.length, b.length) && Math.abs(a.length - b.length) <= 2;
    const oneOff = dist === 1 && Math.min(a.length, b.length) >= 5;
    if (!confusable && !suffix && !oneOff) continue;
    seen.add(b);
    const diff = diffOver(k.label, ops);
    out.push({ label: k.label, from: k.from, diff, summary: summaryOf(diff), rank: confusable ? 0 : dist });
  }
  return out.sort((x, y) => x.rank - y.rank || x.label.localeCompare(y.label)).map(({ rank: _rank, ...c }) => c);
}

/** Where `typed` appears exactly (letters and digits) among `known`. */
export function exactMatches(typed: string, known: readonly { label: string; from: string }[]): string[] {
  const a = alnum(typed);
  if (!a) return [];
  return [...new Set(known.filter((k) => alnum(k.label) === a).map((k) => k.from))];
}
