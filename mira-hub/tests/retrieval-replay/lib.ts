/** Pure scoring for the retrieval replay (no I/O) — unit-tested in lib.test.ts. */

export const KS = [6, 12, 24, 50, 100] as const;
export type Mode = "lexical" | "hybrid";

export type ReplayRow = {
  id: string;
  manual: string;
  family: string;
  expectedPage: number;
  /** Pages of every chunk the model receives (6, or a wider page-diverse slice for a broad question). */
  top6Pages: (number | null)[];
  modelInput?: number;
  rankTop6: number | null;
  recallAt: Record<string, boolean>;
  firstRankWithin100: number | null;
  missClass: "A" | "B" | "C" | "D";
  dup: boolean;
  anchorPages: number[];
  walk?: string | null;
  error?: string;
};

/** Lowercase, unify dashes/quotes, drop soft hyphens, collapse whitespace — for anchor matching only. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/­/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function hitRank(pages: (number | null)[], expected: number, tol: number): number | null {
  const i = pages.findIndex((p) => p !== null && Math.abs(p - expected) <= tol);
  return i < 0 ? null : i + 1;
}

export function classify(anchorOnExpected: boolean, rankTop6: number | null, rankWithin100: number | null): ReplayRow["missClass"] {
  if (!anchorOnExpected) return "A";
  if (rankTop6 !== null) return "D";
  if (rankWithin100 !== null) return "C";
  return "B";
}

export function summarize(rows: ReplayRow[], mode: Mode, sha: string | null): { recall: Record<string, number>; classes: Record<string, number>; markdown: string } {
  const ok = rows.filter((r) => !r.error);
  const recall = Object.fromEntries(KS.map((k) => [String(k), ok.filter((r) => r.recallAt[String(k)]).length]));
  const classes: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, dup: 0 };
  for (const r of ok) { classes[r.missClass]++; if (r.dup) classes.dup++; }
  const fams = [...new Set(ok.map((r) => r.family))];
  const famLine = fams.map((f) => {
    const fr = ok.filter((r) => r.family === f);
    return `| ${f} | ${fr.length} | ${KS.map((k) => fr.filter((r) => r.recallAt[String(k)]).length).join(" | ")} |`;
  });
  const md = [
    `# Retrieval replay — ${mode} — corpus provisioned on ${sha?.slice(0, 9) ?? "?"}`,
    "",
    `Questions: ${ok.length} measured, ${rows.length - ok.length} errored.`,
    "",
    `| K | ${KS.join(" | ")} |`,
    `|---|${KS.map(() => "---").join("|")}|`,
    `| expected page in top K | ${KS.map((k) => recall[String(k)]).join(" | ")} |`,
    "",
    `| family | n | ${KS.map((k) => `@${k}`).join(" | ")} |`,
    `|---|---|${KS.map(() => "---").join("|")}|`,
    ...famLine,
    "",
    `Miss classes: A (anchor not in stored text on the page) ${classes.A} · B (not in top 100) ${classes.B} · C (top 100, not top 6) ${classes.C} · D (in top 6) ${classes.D} · anchor also elsewhere ${classes.dup}`,
    "",
    "| id | class | top-6 rank | rank ≤100 | walk | anchor pages | top-6 pages |",
    "|---|---|---|---|---|---|---|",
    ...ok.map((r) => `| ${r.id} | ${r.missClass}${r.dup ? "+dup" : ""} | ${r.rankTop6 ?? "—"} | ${r.firstRankWithin100 ?? "—"} | ${r.walk ?? "?"} | ${r.anchorPages.slice(0, 6).join(",")}${r.anchorPages.length > 6 ? "…" : ""} | ${r.top6Pages.join(",")} |`),
  ].join("\n");
  return { recall, classes, markdown: md };
}

