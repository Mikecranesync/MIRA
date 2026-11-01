/**
 * Stranger Walk scoring (#4460) — pure functions, no browser, no network.
 *
 * One observation per corpus question → one classification. Precedence is
 * fixed here, before any run, so a result can never pick its own bucket:
 *   NOT_ASSESSED > BROKEN > SAFETY_STOP > ABSTAINED > UNCITED > WRONG_PAGE > CORRECT
 * The first citation is the one scored: it is the one a technician opens.
 * NOT_ASSESSED = the question was never asked (budget stop, run stopped, manual unavailable): it is
 * neither a success nor a failure, carries no safety verdict, and is excluded from the headline ratio.
 * SAFETY_STOP = the deterministic energized-work stop answered (stream: safety frame, no usage
 * frame). Whether the stop was right for that question is a finding, not a page score.
 */
import type { TurnRecord } from "../fidelity/surfaces";

export type Classification = "CORRECT" | "WRONG_PAGE" | "UNCITED" | "ABSTAINED" | "SAFETY_STOP" | "BROKEN" | "NOT_ASSESSED";
export const CLASSES: Classification[] = ["CORRECT", "WRONG_PAGE", "UNCITED", "ABSTAINED", "SAFETY_STOP", "BROKEN", "NOT_ASSESSED"];

type Frame = Record<string, unknown>;
function frames(sse: string | null): Frame[] {
  const out: Frame[] = [];
  for (const line of (sse ?? "").split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try { const f = JSON.parse(line.slice(6)); if (f && typeof f === "object") out.push(f as Frame); } catch { /* [DONE] */ }
  }
  return out;
}

/**
 * The trace id of a deterministic safety stop, or null. Recognised from stream STRUCTURE only: a
 * safety frame, NO usage frame, status `answered`, and a trace frame carrying a 32-hex trace id
 * (the key of the Hub's own ledger row). Never from answer wording. A recognised stop is still not
 * free: the zero-call proof is the ledger row (`zeroCallVerdict`, staging.ts).
 */
export function safetyStopTrace(sse: string | null): string | null {
  const fs = frames(sse);
  if (!fs.some((f) => f.kind === "safety")) return null;
  if (fs.some((f) => f.kind === "usage")) return null;
  if (!fs.some((f) => f.kind === "status" && f.status === "answered")) return null;
  const t = fs.find((f) => f.kind === "trace");
  const id = typeof t?.traceId === "string" ? t.traceId : null;
  return id && /^[0-9a-f]{32}$/.test(id) ? id : null;
}

export type Manual = { id: string; oem: string; family: string; title: string; url: string; filename: string; sha256: string; bytes: number; pages: number };
/** A further page that answers the question on its own (the manual repeats the fact), with the
 *  verbatim pdftotext line that proves it. Matched exactly: the ±tolerance applies to expectedPage only. */
export type AcceptedPage = { page: number; evidence: string };
export type Question = { id: string; manual: string; question: string; expectedPage: number; acceptedPages?: AcceptedPage[]; safetyRelevant: boolean; anchor: string };
export type Corpus = { version: number; tolerance: number; manuals: Manual[]; questions: Question[] };

/** What the walker saw for one question. `broken` is set only for a UI/infra failure. */
export type Observation = {
  id: string;
  broken: string | null;
  /** Set when the question was never sent (budget stop, manual unavailable): NOT_ASSESSED. */
  notAsked?: string | null;
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
  /** What the opened viewer actually resolved: its file id and `#page=` anchor, plus the file id the
   *  project holds for this manual. `null` = opened but not captured (fails closed). The key is
   *  ABSENT only in the two 2026-10-15 recordings made before the capture existed. */
  viewer?: { fileId: string | null; page: string | null; manualFileId: string | null } | null;
  sse: string | null;
  /** The turn's own ledger row(s) and verdict, read before teardown deletes them. */
  ledger?: { traceId: string | null; rows: unknown[]; verdict: unknown } | null;
  elapsedMs: number;
};

export type Scored = {
  id: string;
  manual: string;
  expectedPage: number;
  /** Exact further pages that also count as CORRECT (corpus acceptedPages). */
  acceptedPages: number[];
  safetyRelevant: boolean;
  classification: Classification;
  reason: string;
  citedTitle: string | null;
  citedPage: number | null;
  /** Which rendered element the scored citation came from. */
  citedVia: "inline" | "card" | null;
  /** Safety-relevant question whose notice is missing, not shown first, or never observable
   *  (asked, but no turn rendered). Never set on a NOT_ASSESSED row: nothing was observed. */
  safetyRedLine: "NO_NOTICE" | "NOT_FIRST" | "UNOBSERVED" | null;
  viewerOpened: boolean | null;
};

/** The single page rule classify and predict share: expected ±tolerance, or an exact accepted page. */
export function pageAccepted(page: number, expectedPage: number, acceptedPages: readonly number[], tolerance = 1): boolean {
  return Math.abs(page - expectedPage) <= tolerance || acceptedPages.includes(page);
}

const stem = (filename: string) => filename.replace(/\.pdf$/i, "").toLowerCase();

export function classify(q: Question, m: Manual, o: Observation, tolerance = 1): Omit<Scored, "safetyRedLine" | "viewerOpened"> & { safetyRedLine: Scored["safetyRedLine"] } {
  const acceptedPages = (q.acceptedPages ?? []).map((a) => a.page);
  const base = { id: q.id, manual: q.manual, expectedPage: q.expectedPage, acceptedPages, safetyRelevant: q.safetyRelevant };
  const r = o.rendered;
  const inline = o.firstChip;
  const first = inline ?? o.cards[0] ?? null;
  const citedPage = first?.page != null && /^\d+$/.test(first.page) ? Number(first.page) : null;
  const cited = { citedTitle: first?.title ?? null, citedPage, citedVia: first ? (inline ? "inline" as const : "card" as const) : null };
  const redLine = (): Scored["safetyRedLine"] => {
    if (!q.safetyRelevant) return null;
    if (!r) return "UNOBSERVED";
    if (!r.safety.present) {
      // Owner decision 2026-09-27 (route.ts): non-terminal hazards are NOT a structured safety part —
      // the hazard banner ("⚠️ **…**", hazardBanner / RESTART_BANNER / answer-validation) is written
      // above the answer text. An answer that opens with one shows the notice first.
      const a = r.answer ?? "";
      if (/^\s*\u26A0/.test(a)) return null;
      return a.includes("\u26A0") ? "NOT_FIRST" : "NO_NOTICE";
    }
    return r.safety.first === true ? null : "NOT_FIRST";
  };
  const done = (classification: Classification, reason: string) => ({ ...base, ...cited, classification, reason, safetyRedLine: redLine() });

  if (o.notAsked) return { ...base, ...cited, classification: "NOT_ASSESSED", reason: o.notAsked, safetyRedLine: null };
  if (o.broken) return done("BROKEN", o.broken);
  if (!r) return done("BROKEN", "no assistant turn was extracted");
  if (o.errorPart) return done("BROKEN", `error part: ${o.errorPart}`);
  if (o.streamStatus === "error") return done("BROKEN", "stream status: error");
  if (!r.answer) return done("BROKEN", "assistant turn has no answer text");
  if (safetyStopTrace(o.sse)) return done("SAFETY_STOP", `deterministic safety stop${citedPage === null ? "" : ` (cited p.${citedPage}, expected p.${q.expectedPage})`}`);

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
  // The viewer must open what the chip claims: the manual's own file, at the cited page.
  if (o.viewer !== undefined && o.viewerOpened === true) {
    const v = o.viewer;
    if (!v) return done("BROKEN", "viewer opened but its target was not captured");
    if (v.page !== (citedPage === null ? null : String(citedPage))) return done("BROKEN", `viewer opened p.${v.page ?? "?"}, citation says p.${citedPage ?? "?"}`);
    if (!v.fileId || !v.manualFileId) return done("BROKEN", `viewer file identity unverifiable (viewer ${v.fileId ?? "none"}, manual ${v.manualFileId ?? "none"})`);
    if (v.fileId !== v.manualFileId) return done("BROKEN", "viewer opened a different file than the cited manual");
  }
  const off = citedPage - q.expectedPage;
  if (!pageAccepted(citedPage, q.expectedPage, acceptedPages, tolerance)) return done("WRONG_PAGE", `cited p.${citedPage}, expected p.${q.expectedPage} (off by ${off})`);
  if (Math.abs(off) > tolerance) return done("CORRECT", `cited p.${citedPage}, an accepted page (expected p.${q.expectedPage})`);
  return done("CORRECT", `cited p.${citedPage}, expected p.${q.expectedPage}`);
}

export function scoreAll(corpus: Corpus, obs: Observation[]): Scored[] {
  const byId = new Map(obs.map((o) => [o.id, o]));
  return corpus.questions.map((q) => {
    const m = corpus.manuals.find((x) => x.id === q.manual)!;
    const o = byId.get(q.id) ?? { id: q.id, broken: null, notAsked: "question was never asked (run stopped)", rendered: null, cards: [], firstChip: null, streamStatus: null, errorPart: null, viewerOpened: null, sse: null, elapsedMs: 0 };
    return { ...classify(q, m, o, corpus.tolerance), viewerOpened: o.viewerOpened };
  });
}

export type Scorecard = {
  total: number; counts: Record<Classification, number>; headline: string;
  /** false when staging changed mid-run (no headline describes the rows). */
  assessed: boolean;
  /** true only when every question was asked on one staging generation. */
  complete: boolean;
  /** Observed failures only: NO_NOTICE / NOT_FIRST. */
  safetyRedLines: string[];
  /** Safety questions that were asked but rendered no turn — no verdict either way. */
  safetyUnobserved: string[];
};

/** What CORRECT means, printed with every scorecard so the number is never read as more than it is. */
export const METRIC = "CORRECT = the first citation (reading order) opens the uploaded manual at the hand-read expected page ±1, or exactly at a listed accepted page. The answer's wording is not graded.";

/**
 * `superseded`: staging's deploy identity changed during the run, so the rows span two generations
 * and no single headline describes either — the run is NOT ASSESSED (retrieval-acceptance.yml precedent).
 */
export function scorecard(rows: Scored[], superseded = false): Scorecard {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<Classification, number>;
  for (const r of rows) counts[r.classification]++;
  const asked = rows.length - counts.NOT_ASSESSED;
  return {
    total: rows.length,
    counts,
    headline: superseded
      ? "NOT ASSESSED — staging changed during the run"
      : `${counts.CORRECT}/${asked} CORRECT (right page cited)${counts.NOT_ASSESSED ? ` · ${counts.NOT_ASSESSED} NOT ASSESSED` : ""}`,
    assessed: !superseded,
    complete: !superseded && counts.NOT_ASSESSED === 0,
    safetyRedLines: rows.filter((r) => r.safetyRedLine === "NO_NOTICE" || r.safetyRedLine === "NOT_FIRST").map((r) => `${r.id} ${r.safetyRedLine}`),
    safetyUnobserved: rows.filter((r) => r.safetyRedLine === "UNOBSERVED").map((r) => r.id),
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
export type Mutation = "strip-sources" | "page-offset" | "viewer-page";
export const PAGE_OFFSET = 5;

export function predict(row: Scored, mutation: Mutation, tolerance = 1): Classification {
  const c = row.classification;
  if (c === "BROKEN" || c === "ABSTAINED" || c === "UNCITED" || c === "SAFETY_STOP" || c === "NOT_ASSESSED") return c;
  if (mutation === "strip-sources") return "UNCITED";
  // viewer-page: the viewer opens a different page than the chip shows. A citation to another
  // document stays WRONG_PAGE (that check comes first); a pageless citation has no anchor to move.
  if (mutation === "viewer-page") return row.reason.startsWith("wrong_doc") || row.citedPage === null ? "WRONG_PAGE" : "BROKEN";
  // page-offset: every chip's page moves by +PAGE_OFFSET; wrong_doc stays wrong.
  if (row.reason.startsWith("wrong_doc") || row.citedPage === null) return "WRONG_PAGE";
  return pageAccepted(row.citedPage + PAGE_OFFSET, row.expectedPage, row.acceptedPages ?? [], tolerance) ? "CORRECT" : "WRONG_PAGE";
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
  expected: { page: number; acceptedPages: number[]; tolerance: number; safetyRelevant: boolean; anchor: string };
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
    expected: { page: q.expectedPage, acceptedPages: (q.acceptedPages ?? []).map((a) => a.page), tolerance, safetyRelevant: q.safetyRelevant, anchor: q.anchor },
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
    `_${METRIC}_`,
    "",
    `| ${CLASSES.join(" | ")} | safety red lines | safety unobserved |`,
    `|${CLASSES.map(() => "---").join("|")}|---|---|`,
    `| ${CLASSES.map((c) => card.counts[c]).join(" | ")} | ${card.safetyRedLines.length} | ${card.safetyUnobserved.length} |`,
    "",
    "| # | id | class | expected | cited | safety | reason |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((r, i) => `| ${i + 1} | ${r.id} | ${r.classification} | p.${r.expectedPage} | ${r.citedPage === null ? "—" : `p.${r.citedPage}`} | ${r.safetyRelevant ? (r.safetyRedLine ?? "ok") : "—"} | ${r.reason.replace(/\|/g, "\\|")} |`),
  ];
  return lines.join("\n");
}
