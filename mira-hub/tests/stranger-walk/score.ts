/**
 * Stranger Walk scoring (#4460) — pure functions, no browser, no network.
 *
 * One observation per corpus question → one classification. Precedence is
 * fixed here, before any run, so a result can never pick its own bucket:
 *   BROKEN > ABSTAINED > UNCITED > WRONG_PAGE > CORRECT
 * The first citation is the one scored: it is the one a technician opens.
 */
import type { TurnRecord } from "../fidelity/surfaces";

export type Classification = "CORRECT" | "WRONG_PAGE" | "UNCITED" | "ABSTAINED" | "BROKEN";
export const CLASSES: Classification[] = ["CORRECT", "WRONG_PAGE", "UNCITED", "ABSTAINED", "BROKEN"];

export type Manual = { id: string; oem: string; family: string; title: string; url: string; filename: string; sha256: string; bytes: number; pages: number };
export type Question = { id: string; manual: string; question: string; expectedPage: number; safetyRelevant: boolean; anchor: string };
export type Corpus = { version: number; tolerance: number; manuals: Manual[]; questions: Question[] };

/** What the walker saw for one question. `broken` is set only for a UI/infra failure. */
export type Observation = {
  id: string;
  broken: string | null;
  rendered: TurnRecord | null;
  /** Source cards under the answer (`data-part-type="source"`): title + page from the "p. N" locator.
   *  Inline chips only render where the answer text carries "[n]" markers; a card is still a
   *  citation the technician can open, so it is the fallback when no inline chip rendered. */
  cards: { title: string; page: string | null }[];
  /** The first inline citation chip in READING (DOM) order — the one a technician opens.
   *  `rendered.citations` is sorted by id ("11" < "4") and is kept only as the record. */
  firstChip: { n: string; title: string; page: string | null } | null;
  /** The SSE `status` frame (`answered`, `insufficient_evidence`, `error`, …); null if none was seen. */
  streamStatus: string | null;
  /** `data-error-code` of an error part in the turn, if any. */
  errorPart: string | null;
  /** After clicking the first citation: did the source viewer open on a file. */
  viewerOpened: boolean | null;
  sse: string | null;
  elapsedMs: number;
};

export type Scored = {
  id: string;
  manual: string;
  expectedPage: number;
  safetyRelevant: boolean;
  classification: Classification;
  reason: string;
  citedTitle: string | null;
  citedPage: number | null;
  /** Which rendered element the scored citation came from. */
  citedVia: "inline" | "card" | null;
  /** Safety-relevant question whose notice is missing, not shown first, or never observable
   *  (no turn rendered — a BROKEN safety question is still a safety question with no notice). */
  safetyRedLine: "NO_NOTICE" | "NOT_FIRST" | "UNOBSERVED" | null;
  viewerOpened: boolean | null;
};

const stem = (filename: string) => filename.replace(/\.pdf$/i, "").toLowerCase();

export function classify(q: Question, m: Manual, o: Observation, tolerance = 1): Omit<Scored, "safetyRedLine" | "viewerOpened"> & { safetyRedLine: Scored["safetyRedLine"] } {
  const base = { id: q.id, manual: q.manual, expectedPage: q.expectedPage, safetyRelevant: q.safetyRelevant };
  const r = o.rendered;
  const inline = o.firstChip;
  const first = inline ?? o.cards[0] ?? null;
  const citedPage = first?.page != null && /^\d+$/.test(first.page) ? Number(first.page) : null;
  const cited = { citedTitle: first?.title ?? null, citedPage, citedVia: first ? (inline ? "inline" as const : "card" as const) : null };
  const redLine = (): Scored["safetyRedLine"] => {
    if (!q.safetyRelevant) return null;
    if (!r) return "UNOBSERVED";
    if (!r.safety.present) return "NO_NOTICE";
    return r.safety.first === true ? null : "NOT_FIRST";
  };
  const done = (classification: Classification, reason: string) => ({ ...base, ...cited, classification, reason, safetyRedLine: redLine() });

  if (o.broken) return done("BROKEN", o.broken);
  if (!r) return done("BROKEN", "no assistant turn was extracted");
  if (o.errorPart) return done("BROKEN", `error part: ${o.errorPart}`);
  if (o.streamStatus === "error") return done("BROKEN", "stream status: error");
  if (!r.answer) return done("BROKEN", "assistant turn has no answer text");

  if (o.streamStatus === "insufficient_evidence") return done("ABSTAINED", "stream status: insufficient_evidence");
  if (!first) {
    return r.evidence === null
      ? done("ABSTAINED", "no citation and no evidence basis rendered")
      : done("UNCITED", `answered without a citation (basis: ${r.evidence})`);
  }
  if (!first!.title.toLowerCase().includes(stem(m.filename))) return done("WRONG_PAGE", `wrong_doc: first citation is "${first!.title}"`);
  if (citedPage === null) return done("WRONG_PAGE", "first citation carries no page");
  // Opening the first citation is part of the journey: one that does not open is not a citation.
  if (o.viewerOpened === false) return done("BROKEN", `first citation did not open in the source viewer (cited p.${citedPage ?? "?"})`);
  const off = citedPage - q.expectedPage;
  if (Math.abs(off) > tolerance) return done("WRONG_PAGE", `cited p.${citedPage}, expected p.${q.expectedPage} (off by ${off})`);
  return done("CORRECT", `cited p.${citedPage}, expected p.${q.expectedPage}`);
}

export function scoreAll(corpus: Corpus, obs: Observation[]): Scored[] {
  const byId = new Map(obs.map((o) => [o.id, o]));
  return corpus.questions.map((q) => {
    const m = corpus.manuals.find((x) => x.id === q.manual)!;
    const o = byId.get(q.id) ?? { id: q.id, broken: "question was never asked (run stopped)", rendered: null, cards: [], firstChip: null, streamStatus: null, errorPart: null, viewerOpened: null, sse: null, elapsedMs: 0 };
    return { ...classify(q, m, o, corpus.tolerance), viewerOpened: o.viewerOpened };
  });
}

export type Scorecard = { total: number; counts: Record<Classification, number>; headline: string; safetyRedLines: string[] };

export function scorecard(rows: Scored[]): Scorecard {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<Classification, number>;
  for (const r of rows) counts[r.classification]++;
  return {
    total: rows.length,
    counts,
    headline: `${counts.CORRECT}/${rows.length} CORRECT`,
    safetyRedLines: rows.filter((r) => r.safetyRedLine).map((r) => `${r.id} ${r.safetyRedLine}`),
  };
}

/** Rows whose classification differs between two runs of the same corpus — flakes, by name. */
export function flakes(a: Scored[], b: Scored[]): { id: string; a: Classification; b: Classification }[] {
  const bm = new Map(b.map((r) => [r.id, r.classification]));
  return a.filter((r) => bm.get(r.id) !== r.classification).map((r) => ({ id: r.id, a: r.classification, b: bm.get(r.id)! }));
}

/**
 * Seeded defects (prove-the-test-fails). Given the control classification of a
 * replayed row, what each mutation must turn it into. BROKEN rows have no
 * recorded stream and are not replayed.
 */
export type Mutation = "strip-sources" | "page-offset";
export const PAGE_OFFSET = 5;

export function predict(row: Scored, mutation: Mutation, tolerance = 1): Classification {
  const c = row.classification;
  if (c === "BROKEN" || c === "ABSTAINED" || c === "UNCITED") return c;
  if (mutation === "strip-sources") return "UNCITED";
  // page-offset: every chip's page moves by +PAGE_OFFSET; wrong_doc stays wrong.
  if (row.reason.startsWith("wrong_doc") || row.citedPage === null) return "WRONG_PAGE";
  return Math.abs(row.citedPage + PAGE_OFFSET - row.expectedPage) <= tolerance ? "CORRECT" : "WRONG_PAGE";
}

/**
 * Failure → fixture: the record a fix starts from. `message` + `sse` are the
 * fidelity oracle's scenario shape (tests/fidelity/fixtures/oracle.json), so
 * the replay spec serves it through the same harness.
 */
export type FailureFixture = {
  id: string;
  message: string;
  sse: string | null;
  manual: Pick<Manual, "id" | "filename" | "sha256" | "url">;
  expected: { page: number; tolerance: number; safetyRelevant: boolean; anchor: string };
  rendered: TurnRecord | null;
  classification: Classification;
  reason: string;
  safetyRedLine: Scored["safetyRedLine"];
  staging: { gitSha: string; builtAt: string; runId: string };
};

export function fixtureFor(q: Question, m: Manual, o: Observation, s: Scored, staging: FailureFixture["staging"], tolerance = 1): FailureFixture {
  return {
    id: q.id,
    message: q.question,
    sse: o.sse,
    manual: { id: m.id, filename: m.filename, sha256: m.sha256, url: m.url },
    expected: { page: q.expectedPage, tolerance, safetyRelevant: q.safetyRelevant, anchor: q.anchor },
    rendered: o.rendered,
    classification: s.classification,
    reason: s.reason,
    safetyRedLine: s.safetyRedLine,
    staging,
  };
}

export function markdownScorecard(rows: Scored[], card: Scorecard, meta: { gitSha: string; builtAt: string; runId: string }): string {
  const lines = [
    `### Stranger Walk — ${card.headline}`,
    "",
    `Staging \`${meta.gitSha.slice(0, 9)}\` built ${meta.builtAt} · run \`${meta.runId}\``,
    "",
    `| ${CLASSES.join(" | ")} | safety red lines |`,
    `|${CLASSES.map(() => "---").join("|")}|---|`,
    `| ${CLASSES.map((c) => card.counts[c]).join(" | ")} | ${card.safetyRedLines.length} |`,
    "",
    "| # | id | class | expected | cited | safety | reason |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((r, i) => `| ${i + 1} | ${r.id} | ${r.classification} | p.${r.expectedPage} | ${r.citedPage === null ? "—" : `p.${r.citedPage}`} | ${r.safetyRelevant ? (r.safetyRedLine ?? "ok") : "—"} | ${r.reason.replace(/\|/g, "\\|")} |`),
  ];
  return lines.join("\n");
}
