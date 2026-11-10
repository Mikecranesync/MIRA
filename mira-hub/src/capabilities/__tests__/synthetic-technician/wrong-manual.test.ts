// Synthetic technician: does the right manual answer, and only the right one?
//
// Each job in bench.ts is one technician question against the manuals attached
// to a project. The suite runs the product's real admission path
// (`retrieveNodeChunks`) with a database stand-in that always offers every
// attached manual's page, so the only thing decided here is which pages are
// admitted and what their citations point at.
//
// It proves nothing about SQL recall, answer wording, a deployed build, or a
// photo read. It makes no model, network or database call.
//
// A job marked `knownFail` is a FAIL the product has today. It is written with
// the CORRECT expectation and registered with `it.fails`, so the day a fix
// lands the row turns red until the mark is removed. A green run of this file
// therefore does NOT mean every job passes: read the scorecard test at the end.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { approvalGateEnabled, retrieveNodeChunks } from "@/lib/manual-rag";
import { JOBS, passageOf, type Job, type Manual } from "./bench";

const TENANT = "5a7ec000-0000-4000-8000-000000000001";
const docIdOf = (i: number) => `5a7ec000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;

type Outcome = {
  /** Candidate queries that reached the stand-in database. 0 = stopped before retrieval. */
  offered: number;
  /** Keys of the manuals whose page was admitted. */
  citedFrom: string[];
  /** A citation whose document, page or address is not the admitted manual's own. */
  brokenCitations: string[];
  /** The product's own stated reason, when it gave one. */
  reason: "mismatch-named" | "asks-which-model" | null;
  /** Statements the stand-in database does not know. It answers them with nothing and lists them here. */
  unrecognised: string[];
};

/** How every passage query in the product opens today. A query that opens differently is not answered with passages. */
const PASSAGE_QUERY_OPENS = "SELECT content, doc_id::text AS doc_id";

async function run(job: Job): Promise<Outcome> {
  const docs = job.attached.map((m, i) => ({ m, docId: docIdOf(i) }));
  const rows = docs.map(({ m, docId }, i) => ({
    doc_id: docId,
    filename: m.filename,
    document_heading: m.heading,
    source_url: `https://test.invalid/${m.key}/${m.filename}`,
    source_page: m.page,
    page_start: m.page,
    page_label: m.pageLabel,
    section_path: null,
    content: passageOf(m),
    rank: 0.8 - i * 0.01,
  }));
  let offered = 0;
  const unrecognised: string[] = [];
  // The stand-in knows three kinds of statement and no others: savepoint
  // bookkeeping, the lookups that have no rows on this bench, and the passage
  // query. Anything else gets no rows and is listed, and a listed statement
  // fails the job. So a retrieval query that is added or reworded cannot be
  // answered with this bench's passages by accident, and cannot empty the
  // bench without a failure either.
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("WITH ORDINALITY") || sql.includes("names_document") || sql.includes("quote_literal(lex)")
      || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) {
      return { rows: [] };
    }
    const flat = sql.replace(/\s+/g, " ").trim();
    if (!flat.startsWith(PASSAGE_QUERY_OPENS)) {
      unrecognised.push(flat.slice(0, 120));
      return { rows: [] };
    }
    offered++;
    return { rows };
  });
  const diagnostics: { namedModelMismatch?: unknown; ambiguousModelAsk?: unknown } = {};
  const hits = await retrieveNodeChunks({ query } as unknown as PoolClient, TENANT, job.ask, {
    nodeId: "synthetic-technician",
    unsPath: null,
    docIds: docs.map((d) => d.docId),
    approvedSourceDocIds: docs.map((d) => d.docId),
    validatedDocScope: true,
    rawQuery: job.ask,
    topK: 6,
    ...(job.identity ? { identity: job.identity, identityStatus: "user_confirmed" as const } : {}),
    diagnostics: diagnostics as never,
  });
  const byDoc = new Map(docs.map((d) => [d.docId, d.m] as const));
  const citedFrom: string[] = [];
  const brokenCitations: string[] = [];
  for (const h of hits) {
    const m: Manual | undefined = byDoc.get(h.docId ?? "");
    if (!m) { brokenCitations.push(`unknown document ${h.docId}`); continue; }
    citedFrom.push(m.key);
    if (h.sourcePage !== m.page) brokenCitations.push(`${m.key}: page ${h.sourcePage}, expected ${m.page}`);
    if (h.pageLabel !== m.pageLabel) brokenCitations.push(`${m.key}: label ${h.pageLabel}, expected ${m.pageLabel}`);
    if (h.sourceUrl !== `https://test.invalid/${m.key}/${m.filename}`) brokenCitations.push(`${m.key}: address ${h.sourceUrl}`);
    if (h.content !== passageOf(m)) brokenCitations.push(`${m.key}: passage text is not this manual's`);
  }
  return {
    offered,
    unrecognised,
    citedFrom: [...new Set(citedFrom)].sort(),
    brokenCitations,
    reason: diagnostics.ambiguousModelAsk ? "asks-which-model" : diagnostics.namedModelMismatch ? "mismatch-named" : null,
  };
}

/** The one definition of "this job went right". */
function expectRight(job: Job, got: Outcome) {
  // A refusal only counts when the manual's pages were really on offer: with
  // nothing offered, "nothing cited" would be true of any product at all.
  expect(got.unrecognised, "every statement sent to the stand-in database is one it knows").toEqual([]);
  // The one refusal that comes before any search is the product asking which
  // of two named models is meant. It has to say so; silence does not count.
  if (got.offered === 0) {
    expect(got.reason, "nothing was searched, so the product must have asked which model").toBe("asks-which-model");
    expect("refuse" in job.want, "a job that expects an answer must have been searched").toBe(true);
  }
  expect(got.brokenCitations, "every citation points at its own manual and page").toEqual([]);
  if ("refuse" in job.want) {
    expect(got.citedFrom, "nothing may be cited").toEqual([]);
  } else {
    expect(got.citedFrom, "only the right manual may be cited").toEqual([...job.want.answerFrom].sort());
  }
}

const recorded: Array<{ id: string; verdict: "PASS" | "FAIL"; tracked?: string; got: Outcome }> = [];
const judge = (job: Job, got: Outcome): "PASS" | "FAIL" => {
  try { expectRight(job, got); return "PASS"; } catch { return "FAIL"; }
};

beforeEach(() => {
  // Production's switch values for the pilot: approval gate on; hybrid, rerank and lexical-v2 off.
  vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
  expect(approvalGateEnabled()).toBe(true);
  vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
  vi.stubEnv("NOTEBOOK_RERANK", "0");
  vi.stubEnv("NOTEBOOK_LEXICAL_V2", "0");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No provider or network call is allowed in this suite"); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const title = (j: Job) => `${j.id} ${j.who}, ${j.doing}: "${j.ask}"`;
const passing = JOBS.filter((j) => !j.knownFail);
const failing = JOBS.filter((j) => j.knownFail);

describe("synthetic technician — the right manual answers, and only the right one", () => {
  it.each(passing.map((j) => [title(j), j] as const))("%s", async (_t, job) => {
    const got = await run(job);
    recorded.push({ id: job.id, verdict: judge(job, got), got });
    expectRight(job, got);
  });
});

describe("synthetic technician — KNOWN FAILS on main (each is a wrong-manual answer today)", () => {
  // `it.fails` passes on ANY failure, so each known fail also gets a plain test
  // proving the admission path really ran for it. Without that, a broken
  // fixture would look exactly like the product defect.
  it.each(failing.map((j) => [title(j), j] as const))("reached admission: %s", async (_t, job) => {
    const got = await run(job);
    expect(got.offered, "the stand-in database was asked for candidates").toBeGreaterThan(0);
    expect(got.unrecognised).toEqual([]);
    expect(got.brokenCitations).toEqual([]);
  });

  it.fails.each(failing.map((j) => [`${title(j)} [${j.knownFail!.tracked}]`, j] as const))("%s", async (_t, job) => {
    const got = await run(job);
    recorded.push({ id: job.id, verdict: judge(job, got), tracked: job.knownFail!.tracked, got });
    expectRight(job, got);
  });
});

describe("synthetic technician — scorecard", () => {
  it("every job has a unique id and every known fail names where it is tracked", () => {
    expect(new Set(JOBS.map((j) => j.id)).size).toBe(JOBS.length);
    for (const j of failing) expect(j.knownFail!.tracked, j.id).toMatch(/#\d+/);
  });

  // The count is pinned so that a silently dropped job, or a job quietly moved
  // into the known-fail list, changes a number a reviewer has to look at.
  it("counts: 26 jobs go right, 11 are known wrong-manual fails", () => {
    expect({ right: passing.length, knownWrong: failing.length }).toEqual({ right: 26, knownWrong: 11 });
  });
});

afterAll(() => {
  const out = process.env.SYNTHETIC_TECHNICIAN_SCORECARD_OUT;
  if (!out) return;
  recorded.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  writeFileSync(out, JSON.stringify({
    what: "Admission of an offered page, at $0. Not SQL recall, not answer wording, not a deployed build.",
    pass: recorded.filter((r) => r.verdict === "PASS").length,
    fail: recorded.filter((r) => r.verdict === "FAIL").length,
    rows: recorded,
  }, null, 2));
});
