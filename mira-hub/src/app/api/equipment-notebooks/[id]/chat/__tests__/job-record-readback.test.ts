/**
 * #5335 — "what did I note on the open job?" is read back by the server from
 * the job sheet: no provider call (nothing recorded leaves the server, and no
 * document gate can discard a correct answer), only for a job started on the
 * notebook's confirmed, undisputed machine. Harness copied from
 * living-sheet-job-context.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1", email: "me@example.com" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(async () => ({ ok: false, error: "no_sources_selected" })),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  // R2-33: the real buildManualUserContent folds its 3rd (visual/data-context)
  // arg in ABOVE the user question — this mock mirrors that shape so a test
  // can assert the job-context text actually reaches the user message.
  buildManualUserContent: vi.fn((q: string, _chunks: unknown[], extra?: string) =>
    extra ? `${extra}\n\n${q}` : q,
  ),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

// Legacy (seam-off) cascade so the raw provider body carries `messages`.
const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => false),
  canonicalProviders: vi.fn(() => []),
  buildRequestBody: vi.fn(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

const storeMock = vi.hoisted(() => ({ loadJob: vi.fn(), listOpenJobIdsForMachine: vi.fn() }));
vi.mock("@/capabilities/living-sheet/store", () => storeMock);
// withSheetReceipt is covered by receipt.test.ts / sheet-receipt-gating.test.ts;
// this suite is purely about what reaches the ANSWER, so make it a passthrough.
vi.mock("@/capabilities/living-sheet/receipt", () => ({ withSheetReceipt: vi.fn(async (res: Response) => res) }));

import { JOB_RECORD_HEADER, POST, isJobRecordQuestion, parseJobRecordQuestion, renderJobRecordAnswer, withoutJobRecordAnswers } from "../route";

function providerStream(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}
function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };



const SHEET_VIEW = {
  jobId: JOB_ID,
  seq: 4,
  title: "PM — Pump 07",
  machine: { entityId: "cmms-pump07", name: "Pump 07" },
  templateRevisionId: null,
  template: { title: "PM — Pump 07", machineLabel: null, component: null, jobType: null, estHours: null, crewSize: null, isolationPoints: null, cautions: null, returnToService: [], items: [], torques: [], steps: [], author: null, notes: null },
  steps: [
    { id: "step-1", text: "Check seal", checkoff: "none" as const, torqueRef: null, source: null, done: false, doneBy: null, doneAt: null, note: null, history: [] },
    { id: "step-2", text: "Grease bearing", checkoff: "none" as const, torqueRef: null, source: null, done: true, doneBy: "tech-1", doneAt: "2026-11-03T12:00:00.000Z", note: null, history: [] },
  ],
  readings: [
    { id: "r1", what: "Discharge pressure", current: { value: 48, unit: "psi", by: "tech-1", at: "2026-11-03T11:00:00.000Z", eventId: "e1" }, history: [] },
  ],
  parts: [],
  notes: [],
  questions: [],
  photos: [],
  handover: { current: null, history: [] },
  finished: null,
  openSteps: 1,
  openQuestions: 0,
  warnings: [],
};

const ORIGINAL_FLAG = process.env.NOTEBOOK_LIVING_SHEET;
beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.GROQ_API_KEY = "k";
  delete process.env.NOTEBOOK_LIVING_SHEET;
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Pump 07" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  storeMock.loadJob.mockResolvedValue({ status: "ok", view: RECORDED_VIEW });
  storeMock.listOpenJobIdsForMachine.mockResolvedValue([JOB_ID]);
  nbMock.resolveBoundAsset.mockResolvedValue(RESOLVED as never);
  process.env.NOTEBOOK_LIVING_SHEET = "1";
  // The S12 shape: a manual is selected, and the search finds nothing for a
  // record question (Gate G would abstain on the normal path).
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: ["d1"], nodeId: "n1" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("Finish the open step."), { status: 200 })));
});
afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.NOTEBOOK_LIVING_SHEET;
  else process.env.NOTEBOOK_LIVING_SHEET = ORIGINAL_FLAG;
});


const RESOLVED = { state: "resolved" as const, entityId: "cmms-pump07", name: "CV-101 conveyor drive (GS11N-20P2)", unsPath: "enterprise.site.pump07", selectedVia: "qr_scan" as const, confirmedAt: "2026-11-03T09:00:00.000Z" };
const NOTE = "Synthetic test note: conveyor motor relay output suspected. PLC program and I/O NOT read.";
const LONG_HANDOVER = `Next shift: ${"re-check the relay output wiring at the terminal block. ".repeat(14)}CORRECTION: lock out the drive first.`;
const RECORDED_VIEW = {
  ...SHEET_VIEW,
  readings: [{ ...SHEET_VIEW.readings[0]!, current: { ...SHEET_VIEW.readings[0]!.current, by: "me@example.com" } }],
  notes: [
    { id: "n1", text: NOTE, by: "me@example.com", at: "2026-11-03T11:05:00.000Z", eventId: "e2" },
    { id: "n2", text: "Coworker note: belt tension fine.", by: "other@example.com", at: "2026-11-03T11:07:00.000Z", eventId: "e3" },
  ],
  photos: [{ id: "p1", fileId: "f1", caption: "relay output terminal block", by: "u1", at: "2026-11-03T11:06:00.000Z", eventId: "e4" }],
  handover: { current: { text: LONG_HANDOVER, by: "other@example.com", at: "2026-11-03T11:30:00.000Z", eventId: "e5" }, history: [] },
};

async function framesOf(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text.split("\n\n").map((b) => b.replace(/^data: /, "").trim()).filter((b) => b && b !== "[DONE]").map((b) => JSON.parse(b));
}
const contentOf = (f: Record<string, unknown>[]) => f.filter((x) => x.kind === "content").map((x) => x.content).join("");
const Q = "What did I note on the open CV-101 job?";

describe("#5335 — job record read-back", () => {
  it("one open job on the confirmed machine: answered from the sheet, no provider call, persisted as answered with no citations", async () => {
    const res = await POST(req({ message: Q }), params);
    expect(res.status).toBe(200);
    const f = await framesOf(res);
    expect(fetch).not.toHaveBeenCalled();
    expect(storeMock.listOpenJobIdsForMachine).toHaveBeenCalledWith(TENANT, NB, "cmms-pump07", 11);
    expect(storeMock.loadJob).toHaveBeenCalledWith(TENANT, NB, JOB_ID);
    const text = contentOf(f);
    expect(text.startsWith(`${JOB_RECORD_HEADER}\nJob: "PM — Pump 07" (in progress).`)).toBe(true);
    expect(text).toContain(`- Note by you at 2026-11-03T11:05:00.000Z: ${NOTE}`);
    expect(f.find((x) => x.kind === "status")).toMatchObject({ status: "answered" });
    expect(f.find((x) => x.kind === "sources")).toMatchObject({ citations: [] });
    const turn = (vi.mocked(nbMock.recordTurn).mock.calls as unknown as unknown[][])[0]![2] as Record<string, unknown>;
    expect(turn).toMatchObject({ answerStatus: "answered", answerText: text, model: null, basis: null });
  });

  it("answers before the manual search and query rewrite: a failing search cannot break or delay it (r4 F2)", async () => {
    process.env.NOTEBOOK_QUERY_REWRITE = "1";
    ragMock.retrieveNodeChunks.mockRejectedValue(new Error("statement timeout"));
    try {
      const f = await framesOf(await POST(req({ message: Q }), params));
      expect(contentOf(f)).toContain(NOTE);
      expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled(); // no rewrite call either
    } finally {
      delete process.env.NOTEBOOK_QUERY_REWRITE;
    }
  });

  it("'what did I note' lists the asker's own notes first-hand, never crowded out by coworkers' later notes (r4 F11)", async () => {
    const coworker = Array.from({ length: 21 }, (_, k) => ({ id: `c${k}`, text: `coworker-${k}`, by: "other@example.com", at: `2026-11-03T12:${String(k).padStart(2, "0")}:00.000Z`, eventId: `ec${k}` }));
    storeMock.loadJob.mockResolvedValue({ status: "ok", view: { ...RECORDED_VIEW, notes: [RECORDED_VIEW.notes[0]!, ...coworker] } });
    const text = contentOf(await framesOf(await POST(req({ message: "Show me my notes" }), params)));
    expect(text).toContain(`- Note by you at 2026-11-03T11:05:00.000Z: ${NOTE}`);
    expect(text).not.toContain("coworker-");
    expect(text).not.toContain("earlier note");
    expect(text).toContain("- 21 records by other technicians are on the job sheet and not shown here.");
  });

  it("a question naming another machine's job is never answered with this machine's records (r4 F10)", async () => {
    const f = await framesOf(await POST(req({ message: "What did I note on the open CV-202 job?" }), params));
    const text = contentOf(f);
    expect(text).not.toContain(NOTE);
    expect(text).toContain('No records were read: this notebook\'s machine is CV-101 conveyor drive (GS11N-20P2), and "cv-202" does not match it');
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the same with a job opened on the sheet: its records are not read back for another named machine", async () => {
    const text = contentOf(await framesOf(await POST(req({ message: "What did I note on the CV-202 job?", livingSheetJobId: JOB_ID }), params)));
    expect(text).not.toContain(NOTE);
    expect(text).toContain("No records were read");
  });

  it("control: naming this machine (any spelling) reads its job", async () => {
    const text = contentOf(await framesOf(await POST(req({ message: "What did I note on the cv101 conveyor job?" }), params)));
    expect(text).toContain(NOTE);
  });

  it("a mixed record + restart question keeps the normal, safety-aware path and its restart warning (r4 F9)", async () => {
    await (await POST(req({ message: "What did I note, and can I restart it after the fault?", mode: "general" }), params)).text();
    expect(storeMock.listOpenJobIdsForMachine).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
  });

  it.each([
    ["a reported hazard (smoke)", "What did I note about the smoke coming out of the motor?"],
  ])("%s that the matcher accepts still keeps the safety-aware path (r4 F9, gate on the route's own flags)", async (_l, q) => {
    expect(isJobRecordQuestion(q)).toBe(true); // precondition: only the route's flags can stop it
    await (await POST(req({ message: q, mode: "general" }), params)).text();
    expect(storeMock.listOpenJobIdsForMachine).not.toHaveBeenCalled();
  });

  it("an earlier read-back in the conversation never reaches the provider on a later question (r4 F8)", async () => {
    const earlier = `${JOB_RECORD_HEADER}\nJob: "PM — Pump 07" (in progress).\n- Note by other@example.com at 2026-11-03T11:07:00.000Z: ${NOTE}`;
    await (
      await POST(req({ message: "What is the discharge pressure rating?", mode: "general", history: [{ role: "user", content: Q }, { role: "assistant", content: earlier }] }), params)
    ).text();
    const body = String((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain("What is the discharge pressure rating?"); // precondition: this is the provider call
    expect(body).not.toContain(NOTE);
    expect(body).not.toContain("other@example.com");
    expect(body).toContain("Job sheet records were shown to the technician here");
  });

  it("names each record's real author: 'you' for the asker (by email or user id), the coworker by label", async () => {
    const text = contentOf(await framesOf(await POST(req({ message: "Show me the notes on this job" }), params)));
    expect(text).toContain(`- Note by you at 2026-11-03T11:05:00.000Z: ${NOTE}`);
    expect(text).toContain("- Note by other@example.com at 2026-11-03T11:07:00.000Z: Coworker note: belt tension fine.");
    expect(text).toContain("- Reading: Discharge pressure = 48 psi, recorded by you at 2026-11-03T11:00:00.000Z");
    expect(text).toContain('- Photos attached: 1 ("relay output terminal block" by you at 2026-11-03T11:06:00.000Z)');
  });

  it("shows a long handover in full, so a final correction is never cut off", async () => {
    const text = contentOf(await framesOf(await POST(req({ message: Q }), params)));
    expect(LONG_HANDOVER.length).toBeGreaterThan(700); // precondition
    expect(text).toContain(`- Handover by other@example.com at 2026-11-03T11:30:00.000Z: ${LONG_HANDOVER}`);
  });

  it("shows a long note in full", async () => {
    const long = `Relay output 3 chatters. ${"Checked the coil supply twice. ".repeat(25)}Do not reset until the coil is replaced.`;
    storeMock.loadJob.mockResolvedValue({ status: "ok", view: { ...RECORDED_VIEW, notes: [{ id: "n9", text: long, by: "me@example.com", at: "2026-11-03T11:05:00.000Z", eventId: "e9" }] } });
    const text = contentOf(await framesOf(await POST(req({ message: Q }), params)));
    expect(long.length).toBeGreaterThan(700); // precondition
    expect(text).toContain(long);
  });

  it("an explicitly opened finished job is read back as finished, not in progress", async () => {
    storeMock.loadJob.mockResolvedValue({ status: "ok", view: { ...RECORDED_VIEW, finished: { by: "me@example.com", at: "2026-11-03T12:00:00.000Z", summary: null } } });
    const text = contentOf(await framesOf(await POST(req({ message: Q, livingSheetJobId: JOB_ID }), params)));
    expect(storeMock.listOpenJobIdsForMachine).not.toHaveBeenCalled();
    expect(text).toContain('"PM — Pump 07" (finished 2026-11-03T12:00:00.000Z)');
  });

  it("a job from an earlier binding is never read back for the current machine; the turn takes its normal path", async () => {
    storeMock.loadJob.mockResolvedValue({ status: "ok", view: { ...RECORDED_VIEW, machine: { entityId: "cmms-old", name: "Old" } } });
    const res = await POST(req({ message: Q, mode: "general", livingSheetJobId: JOB_ID }), params);
    const text = contentOf(await framesOf(res));
    expect(storeMock.loadJob).toHaveBeenCalled(); // precondition: it was loaded
    expect(text).not.toContain(NOTE);
    expect(fetch).toHaveBeenCalled(); // normal path
  });

  it("several open jobs: says so and guesses none", async () => {
    storeMock.listOpenJobIdsForMachine.mockResolvedValue([JOB_ID, "44444444-4444-4444-8444-444444444444"]);
    const text = contentOf(await framesOf(await POST(req({ message: Q }), params)));
    expect(storeMock.loadJob).not.toHaveBeenCalled();
    expect(text).toBe("There are 2 unfinished jobs on this machine's job sheet. Open the one you mean in the Job sheet and ask again.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("no open job: says so, no provider call", async () => {
    storeMock.listOpenJobIdsForMachine.mockResolvedValue([]);
    const text = contentOf(await framesOf(await POST(req({ message: Q }), params)));
    expect(text).toBe("There is no unfinished job on this machine's job sheet. Open a job in the Job sheet and ask again.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["a scanned but unconfirmed machine", { ...RESOLVED, confirmedAt: null }],
    ["an unbound notebook", { state: "unbound" }],
  ])("%s: no record read at all; the turn takes its normal path", async (_l, asset) => {
    nbMock.resolveBoundAsset.mockResolvedValue(asset as never);
    await (await POST(req({ message: Q, mode: "general" }), params)).text();
    expect(storeMock.listOpenJobIdsForMachine).not.toHaveBeenCalled();
    expect(storeMock.loadJob).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
  });

  it("a disputed binding (the device says another machine): no record read", async () => {
    await (await POST(req({ message: Q, mode: "general", machineEvidence: { assetId: "cmms-other", anchorAt: "2026-11-03T11:00:00.000Z" } }), params)).text();
    expect(storeMock.listOpenJobIdsForMachine).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
  });

  it("flag off: no record read; the turn takes its normal path", async () => {
    delete process.env.NOTEBOOK_LIVING_SHEET;
    await (await POST(req({ message: Q, mode: "general" }), params)).text();
    expect(storeMock.listOpenJobIdsForMachine).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
  });

  it("control: an unrelated question on the same notebook never reads the job and sends no record to the provider", async () => {
    await (await POST(req({ message: "What is the discharge pressure rating?", mode: "general" }), params)).text();
    expect(storeMock.listOpenJobIdsForMachine).not.toHaveBeenCalled();
    expect(storeMock.loadJob).not.toHaveBeenCalled();
    const body = String((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body);
    expect(body).not.toContain(NOTE);
  });

  it("a failed read falls through to the normal path, never a broken turn", async () => {
    storeMock.listOpenJobIdsForMachine.mockRejectedValue(Object.assign(new Error("relation missing"), { code: "42P01" }));
    const res = await POST(req({ message: Q, mode: "general" }), params);
    expect(res.status).toBe(200);
    await res.text();
    expect(fetch).toHaveBeenCalled();
  });

  it("only the newest 20 notes are listed, and the omission is said", () => {
    const notes = Array.from({ length: 23 }, (_, i) => ({ id: `n${i}`, text: `note-${i}`, by: "x", at: "t", eventId: `e${i}` }));
    const text = renderJobRecordAnswer({ ...SHEET_VIEW, readings: [], notes } as never, { email: "me@example.com", userId: "u1" });
    expect(text).toContain("- 3 earlier notes are on the job sheet and not repeated here.");
    expect(text).not.toContain("note-2\n");
    expect(text).toContain("note-3");
    expect(text).toContain("note-22");
  });

  it("an empty job says nothing has been recorded", () => {
    const text = renderJobRecordAnswer({ ...SHEET_VIEW, readings: [] } as never, { email: "me@example.com", userId: "u1" });
    expect(text).toContain("Nothing has been recorded on this job yet");
  });
});

describe("#5335 — isJobRecordQuestion: a pure read-back of the record, nothing else", () => {
  it.each([
    "What did I note on the open CV-101 job?",
    "What have I already recorded on the CV-101 job today, and what motor current did I measure at start?",
    "Show me my notes",
    "what did we log on this job",
    "What's in the handover?",
  ])("matches: %s", (q) => expect(isJobRecordQuestion(q)).toBe(true));
  it.each([
    "For this job, what torque should I record for the coupling bolts?",
    "What did I note, and what should P01.12 be set to?",
    "What is the default of P01.12?",
    "How do I record a reading?",
    "I noted the drive trips on start — what does F004 mean?",
    "What did I measure, and is that safe?",
    "What is the discharge pressure rating?",
    "What did I note, and can I restart it after the fault?",
    "What did I record before the reset?",
  ])("control, does not match: %s", (q) => expect(isJobRecordQuestion(q)).toBe(false));
  it("first person singular is 'mine'; 'we' and 'the' are the whole job; a named job is the target", () => {
    expect(parseJobRecordQuestion("What did I note on the open CV-101 job?")).toEqual({ mine: true, target: "cv-101" });
    expect(parseJobRecordQuestion("Show me my notes")).toEqual({ mine: true, target: null });
    expect(parseJobRecordQuestion("what did we log on this job")).toEqual({ mine: false, target: null });
    expect(parseJobRecordQuestion("Show me the notes on the open job")).toEqual({ mine: false, target: null });
  });
  it("withoutJobRecordAnswers stubs only the server's own read-backs", () => {
    const h = [{ role: "user", content: "q" }, { role: "assistant", content: `${JOB_RECORD_HEADER}\nsecret` }, { role: "assistant", content: "other" }];
    expect(withoutJobRecordAnswers(h).map((t) => t.content)).toEqual(["q", "(Job sheet records were shown to the technician here; they are not repeated.)", "other"]);
  });
});
