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
// lands the row turns red until the mark is removed. No job carries the mark
// today (#5369 removed the last eleven); the count is pinned at the end so that
// a job quietly moved back into that list changes a number a reviewer reads.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { approvalGateEnabled, retrieveNodeChunks } from "@/lib/manual-rag";
import { EXTRA_JOBS, JOBS, passageOf, type Job, type Manual, type Reason } from "./bench";

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
  reason: Reason | null;
  /** Whose model number the refusal is about, when it says. */
  about: "question" | "notebook" | null;
};

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
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("WITH ORDINALITY") || sql.includes("names_document") || sql.includes("quote_literal(lex)")
      || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) {
      return { rows: [] };
    }
    offered++;
    return { rows };
  });
  const diagnostics: { namedModelMismatch?: unknown; ambiguousModelAsk?: unknown; unlistedModelRefusal?: { kind: Reason; source: "question" | "notebook" } } = {};
  const hits = await retrieveNodeChunks({ query } as unknown as PoolClient, TENANT, job.ask, {
    nodeId: "synthetic-technician",
    unsPath: null,
    docIds: docs.map((d) => d.docId),
    approvedSourceDocIds: docs.map((d) => d.docId),
    validatedDocScope: true,
    rawQuery: job.ask,
    topK: 6,
    ...(job.identity ? { identity: job.identity, identityStatus: job.unconfirmed ? ("candidate" as const) : ("user_confirmed" as const) } : {}),
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
    citedFrom: [...new Set(citedFrom)].sort(),
    brokenCitations,
    reason: diagnostics.ambiguousModelAsk ? "asks-which-model"
      : diagnostics.namedModelMismatch ? "mismatch-named"
      : diagnostics.unlistedModelRefusal?.kind ?? null,
    about: diagnostics.unlistedModelRefusal?.source ?? null,
  };
}

/** The one definition of "this job went right". */
function expectRight(job: Job, got: Outcome) {
  expect(got.brokenCitations, "every citation points at its own manual and page").toEqual([]);
  if ("refuse" in job.want) {
    expect(got.citedFrom, "nothing may be cited").toEqual([]);
    if (job.says) expect(got.reason, "the refusal states why").toBe(job.says);
    if (job.about) expect(got.about, "the refusal says whose model number it is about").toBe(job.about);
  } else {
    expect(got.citedFrom, "only the right manual may be cited").toEqual([...job.want.answerFrom].sort());
    expect(got.reason, "an answered question carries no refusal reason").toBeNull();
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

// Registered only while a job carries the mark: an empty suite is an error.
if (failing.length > 0) describe("synthetic technician — KNOWN FAILS on main (each is a wrong-manual answer today)", () => {
  // `it.fails` passes on ANY failure, so each known fail also gets a plain test
  // proving the admission path really ran for it. Without that, a broken
  // fixture would look exactly like the product defect.
  it.each(failing.map((j) => [title(j), j] as const))("reached admission: %s", async (_t, job) => {
    const got = await run(job);
    expect(got.offered, "the stand-in database was asked for candidates").toBeGreaterThan(0);
    expect(got.brokenCitations).toEqual([]);
  });

  it.fails.each(failing.map((j) => [`${title(j)} [${j.knownFail!.tracked}]`, j] as const))("%s", async (_t, job) => {
    const got = await run(job);
    recorded.push({ id: job.id, verdict: judge(job, got), tracked: job.knownFail!.tracked, got });
    expectRight(job, got);
  });
});

describe("synthetic technician — rows added with the #5369 fix (not part of the 30)", () => {
  it.each(EXTRA_JOBS.map((j) => [title(j), j] as const))("%s", async (_t, job) => {
    const got = await run(job);
    expect(got.offered, "the stand-in database was asked for candidates").toBeGreaterThan(0);
    expectRight(job, got);
  });
});

describe("synthetic technician — scorecard", () => {
  it("every job has a unique id and every known fail names where it is tracked", () => {
    expect(new Set([...JOBS, ...EXTRA_JOBS].map((j) => j.id)).size).toBe(JOBS.length + EXTRA_JOBS.length);
    expect(EXTRA_JOBS.every((j) => !j.knownFail), "an added row is never a known fail").toBe(true);
    for (const j of failing) expect(j.knownFail!.tracked, j.id).toMatch(/#\d+/);
  });

  // The count is pinned so that a silently dropped job, or a job quietly moved
  // into the known-fail list, changes a number a reviewer has to look at.
  it("counts: all 30 jobs go right, none is a known wrong-manual fail; the added rows are counted beside them", () => {
    expect({ right: passing.length, knownWrong: failing.length, added: EXTRA_JOBS.length })
      .toEqual({ right: 30, knownWrong: 0, added: 38 });
  });

  // 30 right answers are also reachable by refusing more. These are the jobs
  // that must ANSWER; the number is pinned so one cannot be turned into a refusal unseen.
  it("counts: the jobs that must answer, in the 30 and in the added rows", () => {
    const answers = (jobs: Job[]) => jobs.filter((j) => "answerFrom" in j.want).length;
    expect({ contract: answers(JOBS), added: answers(EXTRA_JOBS) }).toEqual({ contract: 15, added: 23 });
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
