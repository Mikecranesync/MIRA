/**
 * An attached manual is not automatically an applicable one.
 *
 * Two things seen on screen on 2026-11-10 (local walk, stand-in answers), run
 * here through the real chat route AND the real retrieval function. Only the
 * database, the session and the provider are stand-ins, so a red run fails the
 * way the screen did: the wrong sheet is cited and a provider is asked.
 *
 *  1. A project made from a registered controller (the machine-first path)
 *     carried no maker or model into the manual check. With only a relay's
 *     data sheet attached it answered "What is the supply voltage?" from it.
 *  2. A project with only a controller sheet attached was told "the plate
 *     reads … GS11N-20P2", refused, then answered the next question from the
 *     controller sheet.
 *
 * Covers are the benchmark's (public PDFs' first stored block). Passage bodies
 * are stand-ins. No model, network or real database call.
 *
 * Run: npx vitest run src/capabilities/__tests__/attached-is-not-applicable.route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GS10, MICRO820_SHEET_AS_STORED, RELAY_SHEET_AS_STORED, RX410_TITLED, type Manual } from "./synthetic-technician/bench";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const MACHINE = "44444444-4444-4444-8444-444444444444";
const DOC_B = "55555555-5555-4555-8555-555555555555";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

type StoredTurn = { question: string; answerStatus: string; answerText: string | null; basis: string | null };
const stored = vi.hoisted(() => ({
  turns: [] as Array<{ question: string; answerStatus: string; answerText: string | null; basis: string | null }>,
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({ state: "unbound" })),
  recordTurn: vi.fn(),
  listTurns: vi.fn(),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const filesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
}));
vi.mock("@/lib/workspace-files", () => filesMock);

// The database stand-in: it always offers the attached manual's page, the same
// way the synthetic-technician bench does, so the only thing decided is whether
// that page is admitted.
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string) =>
        sql.includes("WITH ORDINALITY") || sql.includes("names_document") || sql.includes("quote_literal(lex)")
          || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)
          ? { rows: [] }
          : { rows: db.rows },
      ),
    }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "groq", url: "https://x/y", key: "k", model: "m" }]),
  buildRequestBody: vi.fn(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "groq" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && !l.startsWith("data: [DONE]"))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
}

const PASSAGE = "The controller requires a 24 V DC supply.";
const LOCKOUT_PASSAGE =
  "WARNING: Hazardous voltage. Disconnect power and apply lockout/tagout before servicing. Wait 5 minutes for the capacitors to discharge.";
const HAZARD_ASK = "It's still powered up. Can I swap the fan?";
const pageOf = (m: Manual, docId: string, content: string) => ({
  doc_id: docId,
  filename: m.filename,
  document_heading: m.heading,
  source_url: `https://test.invalid/${m.key}/${m.filename}`,
  source_page: m.page,
  page_start: m.page,
  page_label: m.pageLabel,
  section_path: null,
  content,
  rank: 0.8,
});
const attach = (m: Manual, content = PASSAGE) => {
  db.rows = [pageOf(m, DOC_A, content)];
};
/** Two manuals in one notebook, both selected for the turn. */
const attachTwo = (a: Manual, b: Manual) => {
  db.rows = [pageOf(a, DOC_A, PASSAGE), pageOf(b, DOC_B, PASSAGE)];
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A, DOC_B], nodeId: "node-1" });
};

async function ask(message: string) {
  const out = await frames(await POST(req({ message, sourceDocIds: db.rows.map((r) => String(r.doc_id)) }), params));
  const status = out.find((f) => f.kind === "status") as { status: string; message?: string } | undefined;
  const sources = out.find((f) => f.kind === "sources") as { citations: unknown[] } | undefined;
  return {
    status,
    citations: sources?.citations ?? [],
    providerAsked: vi.mocked(fetch).mock.calls.length > 0,
    kinds: out.map((f) => String(f.kind)),
  };
}

const blankProject = { id: NB, displayName: "Bench drive wrong sheet", manufacturer: null, model: null, catalogNumber: null, identityStatus: "unknown" };

beforeEach(() => {
  vi.clearAllMocks();
  stored.turns = [];
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.NOTEBOOK_HYBRID_RETRIEVAL = "0";
  process.env.NOTEBOOK_RERANK = "0";
  process.env.NOTEBOOK_LEXICAL_V2 = "0";
  process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue(blankProject);
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  // What the route stores is what the next turn reads back. Like the real
  // listTurns: the most recent `limit` turns, OLDEST first.
  nbMock.recordTurn.mockImplementation(async (_t: string, _n: string, turn: StoredTurn) => {
    stored.turns.push({ question: turn.question, answerStatus: turn.answerStatus, answerText: turn.answerText, basis: turn.basis ?? null });
    return "turn-row";
  });
  nbMock.listTurns.mockImplementation(async (_t: string, _n: string, limit = 50) =>
    stored.turns.slice(-limit).map((t, i) => ({ id: `t${i}`, threadId: null, evidence: [], ...t })),
  );
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  // If the route asks a provider, this is the wrong-manual value it would serve.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "It needs a 24 V DC supply [1]." } }] })}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    ),
  );
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["NOTEBOOK_HYBRID_RETRIEVAL", "NOTEBOOK_RERANK", "NOTEBOOK_LEXICAL_V2", "MIRA_ENFORCE_APPROVED_RETRIEVAL"]) delete process.env[k];
});

describe("a notebook confirmed as one machine does not answer from another product's manual", () => {
  const confirmedController = { ...blankProject, manufacturer: "Allen-Bradley", model: "Micro820", identityStatus: "user_confirmed" };

  it("refuses the relay's sheet, says which product it is for and how to get an answer", async () => {
    nbMock.getNotebook.mockResolvedValue(confirmedController);
    attach(RELAY_SHEET_AS_STORED);
    const { status, citations, providerAsked } = await ask("What is the supply voltage?");
    expect(citations, "the relay's sheet must not be cited for the controller").toEqual([]);
    expect(providerAsked, "no provider is asked when no manual applies").toBe(false);
    expect(status?.status).toBe("insufficient_evidence");
    expect(status?.message).toContain("CA3KN22BD");
    expect(status?.message).toContain("Micro820");
    expect(status?.message).toMatch(/name it in the question/i);
    expect(status?.message).not.toMatch(/24 V/);
  });

  it("control: the same sheet answers when the question names the relay", async () => {
    nbMock.getNotebook.mockResolvedValue(confirmedController);
    attach(RELAY_SHEET_AS_STORED);
    const { citations, providerAsked } = await ask("What is the coil voltage of the CA3KN22BD?");
    expect(providerAsked).toBe(true);
    expect(citations.length).toBeGreaterThan(0);
  });

  it("control: an identity nobody confirmed scopes nothing, as today", async () => {
    nbMock.getNotebook.mockResolvedValue({ ...confirmedController, identityStatus: "proposed" });
    attach(RELAY_SHEET_AS_STORED);
    const { citations, providerAsked } = await ask("What is the supply voltage?");
    expect(providerAsked).toBe(true);
    expect(citations.length).toBeGreaterThan(0);
  });
});

describe("a project made from a registered machine carries that machine into the manual check", () => {
  const boundController = {
    state: "resolved",
    entityId: MACHINE,
    name: "CV-101 bench PLC",
    unsPath: "enterprise.garage.cv_101.plc",
    selectedVia: "asset_picker",
    confirmedAt: "2026-11-10T07:40:00.000Z",
    manufacturer: "Allen-Bradley",
    model: "2080-LC20-20QBB",
  };

  it("refuses the relay's sheet for a question about the machine, says why, cites nothing and asks no provider", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue(boundController);
    attach(RELAY_SHEET_AS_STORED);
    const { status, citations, providerAsked } = await ask("What is the supply voltage?");
    expect(citations, "the relay's sheet must not be cited for the controller").toEqual([]);
    expect(providerAsked, "no provider is asked when no manual applies").toBe(false);
    expect(status?.status).toBe("insufficient_evidence");
    expect(status?.message).toContain("CA3KN22BD");
    expect(status?.message).toContain("2080-LC20-20QBB");
    expect(status?.message).not.toMatch(/24 V/);
  });

  it("control: the controller's own sheet still answers in that project", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue(boundController);
    attach(MICRO820_SHEET_AS_STORED);
    const { citations, providerAsked } = await ask("What is the supply voltage?");
    expect(providerAsked).toBe(true);
    expect(citations.length).toBeGreaterThan(0);
  });

  it("control: the relay's sheet answers there when the question names the relay", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue(boundController);
    attach(RELAY_SHEET_AS_STORED);
    const { citations, providerAsked } = await ask("What is the coil voltage of the CA3KN22BD?");
    expect(providerAsked).toBe(true);
    expect(citations.length).toBeGreaterThan(0);
  });

  it("a machine whose binding nobody confirmed scopes nothing, as today", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue({ ...boundController, confirmedAt: null });
    attach(RELAY_SHEET_AS_STORED);
    const { citations, providerAsked } = await ask("What is the supply voltage?");
    expect(providerAsked).toBe(true);
    expect(citations.length).toBeGreaterThan(0);
  });

  it("a machine made in the namespace has no maker or model on record and scopes nothing, as today", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue({ ...boundController, manufacturer: null, model: null });
    attach(RELAY_SHEET_AS_STORED);
    const { citations, providerAsked } = await ask("What is the supply voltage?");
    expect(providerAsked).toBe(true);
    expect(citations.length).toBeGreaterThan(0);
  });

  it("the notebook's own confirmed identity wins over the machine it is bound to", async () => {
    // Confirmed on the notebook as the relay; bound to the controller. The relay's sheet is its own.
    nbMock.getNotebook.mockResolvedValue({ ...blankProject, manufacturer: "Schneider Electric", model: "CA3KN22BD", identityStatus: "user_confirmed" });
    nbMock.resolveBoundAsset.mockResolvedValue(boundController);
    attach(RELAY_SHEET_AS_STORED);
    const { citations, providerAsked } = await ask("What is the coil voltage?");
    expect(providerAsked).toBe(true);
    expect(citations.length).toBeGreaterThan(0);
  });
});

describe("the safety stop reads the same manuals as the question does", () => {
  const boundController = {
    state: "resolved", entityId: MACHINE, name: "CV-101 bench PLC", unsPath: "enterprise.garage.cv_101.plc",
    selectedVia: "asset_picker", confirmedAt: "2026-11-10T07:40:00.000Z", manufacturer: "Allen-Bradley", model: "2080-LC20-20QBB",
  };

  it("control: a hazard question in the controller's project still stops and cites the controller manual's own lockout page", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue(boundController);
    attach(MICRO820_SHEET_AS_STORED, LOCKOUT_PASSAGE);
    const { citations, providerAsked, kinds } = await ask(HAZARD_ASK);
    expect(kinds).toContain("safety");
    expect(providerAsked, "a stop never asks a provider").toBe(false);
    expect(citations.length, "the manual's own lockout page is still cited").toBeGreaterThan(0);
  });

  it("the stop does not cite a lockout page from another product's sheet", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue(boundController);
    attach(RELAY_SHEET_AS_STORED, LOCKOUT_PASSAGE);
    const { citations, providerAsked, kinds } = await ask(HAZARD_ASK);
    expect(kinds, "the stop is still served").toContain("safety");
    expect(providerAsked).toBe(false);
    expect(citations, "the relay's sheet must not be cited for the controller").toEqual([]);
  });

  it("control: with no machine identity the stop cites the attached manual's lockout page, as today", async () => {
    attach(RELAY_SHEET_AS_STORED, LOCKOUT_PASSAGE);
    const { citations, kinds } = await ask(HAZARD_ASK);
    expect(kinds).toContain("safety");
    expect(citations.length).toBeGreaterThan(0);
  });
});

describe("the model a technician named is still the subject of the next question", () => {
  const PLATE = "The plate reads AutomationDirect GS11N-20P2. It will not start.";

  it("refuses the plate message, then refuses the follow-up for the same reason instead of answering from the controller sheet", async () => {
    attach(MICRO820_SHEET_AS_STORED);

    const first = await ask(PLATE);
    expect(first.citations).toEqual([]);
    expect(first.providerAsked).toBe(false);
    expect(first.status?.status).toBe("insufficient_evidence");
    expect(first.status?.message).toContain("GS11N-20P2");
    expect(stored.turns.at(-1)).toMatchObject({ question: PLATE, answerStatus: "insufficient_evidence" });

    const second = await ask("What supply voltage does it need?");
    expect(second.citations, "the controller sheet must not be cited for the drive the technician named").toEqual([]);
    expect(second.providerAsked, "no provider is asked when no manual applies").toBe(false);
    expect(second.status?.status).toBe("insufficient_evidence");
    expect(second.status?.message).toContain("GS11N-20P2");
    expect(second.status?.message).toMatch(/earlier in this conversation/i);
    expect(second.status?.message).not.toMatch(/24 V/);
  });

  it("control: naming the attached sheet's own model in the follow-up answers", async () => {
    attach(MICRO820_SHEET_AS_STORED);
    await ask(PLATE);
    vi.mocked(fetch).mockClear();
    const second = await ask("What supply voltage does the Micro820 need?");
    expect(second.providerAsked).toBe(true);
    expect(second.citations.length).toBeGreaterThan(0);
  });

  it("control: a follow-up after an ANSWERED turn is not narrowed by what that turn named", async () => {
    attach(MICRO820_SHEET_AS_STORED);
    const first = await ask("What supply voltage does the Micro820 need?");
    expect(first.providerAsked).toBe(true);
    vi.mocked(fetch).mockClear();
    const second = await ask("And the input voltage range?");
    expect(second.providerAsked).toBe(true);
    expect(second.citations.length).toBeGreaterThan(0);
  });

  it("control: when the earlier turns cannot be read, the turn is served as today", async () => {
    attach(MICRO820_SHEET_AS_STORED);
    nbMock.listTurns.mockRejectedValue(new Error("history read failed"));
    const { providerAsked, citations } = await ask("What supply voltage does it need?");
    expect(providerAsked).toBe(true);
    expect(citations.length).toBeGreaterThan(0);
  });

  it("an answer from a document closes the subject: the next model-less question answers again", async () => {
    attach(MICRO820_SHEET_AS_STORED);
    const plate = await ask(PLATE);
    expect(plate.providerAsked).toBe(false);

    const named = await ask("What supply voltage does the Micro820 need?");
    expect(named.providerAsked).toBe(true);
    expect(named.citations.length).toBeGreaterThan(0);
    // The stored turn, as the route wrote it, is what closes the subject.
    expect(stored.turns.at(-1)).toMatchObject({ answerStatus: "answered" });
    expect(["workspace_evidence", "oem_documentation"]).toContain(stored.turns.at(-1)?.basis);

    vi.mocked(fetch).mockClear();
    const third = await ask("And the input voltage range?");
    expect(third.providerAsked, "the drive named two turns ago is no longer the subject").toBe(true);
    expect(third.citations.length).toBeGreaterThan(0);
  });

  it("two manuals: once a question is answered from a document, the model it named stops narrowing the next one", async () => {
    attachTwo(MICRO820_SHEET_AS_STORED, GS10);
    // What the route handed the answer model for the newest turn (its excerpts name their files).
    const handedToModel = () => JSON.stringify(seamMock.buildRequestBody.mock.calls.at(-1));

    const other = await ask("Which parameter sets acceleration time on the GS23-4010?");
    expect(other.providerAsked, "neither manual is for the GS23").toBe(false);

    const named = await ask("What supply voltage does the Micro820 need?");
    expect(named.providerAsked).toBe(true);
    expect(handedToModel()).toContain(MICRO820_SHEET_AS_STORED.filename);
    expect(handedToModel(), "the drive manual is not offered for a Micro820 question").not.toContain(GS10.filename);
    expect(stored.turns.at(-1)).toMatchObject({ answerStatus: "answered" });

    await ask("Which parameter sets the acceleration time?");
    expect(handedToModel(), "the Micro820 named in the answered turn no longer narrows this one").toContain(GS10.filename);
    expect(handedToModel()).toContain(MICRO820_SHEET_AS_STORED.filename);
  });

  it("in a project made from the confirmed controller machine, the follow-up to the refused plate message is refused too", async () => {
    attach(MICRO820_SHEET_AS_STORED);
    nbMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved", entityId: "e-plc", name: "CV-101 PLC", unsPath: "enterprise.garage.cv_101.plc",
      selectedVia: "asset_picker", confirmedAt: "2026-11-10T07:40:00.000Z", manufacturer: "Allen-Bradley", model: "Micro820",
    });

    const control = await ask("What supply voltage does it need?");
    expect(control.providerAsked, "control: the controller's own project answers a model-less question").toBe(true);
    expect(control.citations.length).toBeGreaterThan(0);
    stored.turns.length = 0;
    vi.mocked(fetch).mockClear();

    const first = await ask(PLATE);
    expect(first.providerAsked).toBe(false);
    expect(first.status?.message).toContain("GS11N-20P2");

    const second = await ask("What supply voltage does it need?");
    expect(second.citations, "the controller sheet must not answer for the drive on the plate").toEqual([]);
    expect(second.providerAsked).toBe(false);
    expect(second.status?.message).toContain("GS11N-20P2");
    expect(second.status?.message).toMatch(/earlier in this conversation/i);
    expect(second.status?.message).toMatch(/start a new chat/);
  });

  it("reads only this technician's turns of this conversation", async () => {
    attach(MICRO820_SHEET_AS_STORED);
    await ask("What supply voltage does it need?");
    expect(nbMock.listTurns).toHaveBeenCalledWith(TENANT, expect.any(String), 6, { viewerUserId: "u1", threadId: null });
  });

  it("a safety stop in between does not close the subject: the next question is still refused", async () => {
    attach(MICRO820_SHEET_AS_STORED, LOCKOUT_PASSAGE);
    await ask(PLATE);

    const stop = await ask(HAZARD_ASK);
    expect(stop.kinds, "the stop is still served").toContain("safety");
    expect(stop.citations, "the stop cites no page from the controller sheet for the drive").toEqual([]);

    const third = await ask("What supply voltage does it need?");
    expect(third.citations).toEqual([]);
    expect(third.providerAsked).toBe(false);
    expect(third.status?.message).toContain("GS11N-20P2");
    expect(third.status?.message).toMatch(/earlier in this conversation/i);
  });
});

// Codex round 1 on #5389 (F1). A fault code, a parameter or a tag reads as a
// number, and any number in the next question used to end the carry: "RX420
// will not start" was refused against the RX410 guide, then "What does fault
// F0004 mean?" was answered from that guide. The stored refusal is what keeps
// the subject open, so this runs through the route, turn after turn.
describe("a fault code in the next question does not change which machine the conversation is about", () => {
  const PLATE = "The plate reads AutomationDirect GS11N-20P2. It will not start.";

  it("refuses the sibling, then the fault-code question, then a model-less one; naming the guide's own model answers", async () => {
    attach(RX410_TITLED);

    const first = await ask("RX420 will not start");
    expect(first.providerAsked).toBe(false);
    expect(first.status?.message).toContain("RX420");

    const fault = await ask("What does fault F0004 mean?");
    expect(fault.citations, "the RX410 guide must not be cited for a fault on the RX420").toEqual([]);
    expect(fault.providerAsked, "no provider is asked when no manual applies").toBe(false);
    expect(fault.status?.status).toBe("insufficient_evidence");
    expect(fault.status?.message).toContain("RX420");
    expect(fault.status?.message).toMatch(/earlier in this conversation/i);
    // The refused fault question is stored unanswered, so the subject stays open.
    expect(stored.turns.at(-1)).toMatchObject({ question: "What does fault F0004 mean?", answerStatus: "insufficient_evidence" });

    const third = await ask("What supply voltage does it need?");
    expect(third.citations).toEqual([]);
    expect(third.providerAsked).toBe(false);
    expect(third.status?.message).toContain("RX420");

    const named = await ask("What does fault F0004 mean on the RX410?");
    expect(named.providerAsked, "control: naming the guide's own model answers").toBe(true);
    expect(named.citations.length).toBeGreaterThan(0);
  });

  it("the same for a model the detector reads: the plate message, then two fault codes", async () => {
    attach(MICRO820_SHEET_AS_STORED);
    await ask(PLATE);

    for (const question of ["What does fault F0004 mean?", "What does CE10 mean?"]) {
      const next = await ask(question);
      expect(next.citations, question).toEqual([]);
      expect(next.providerAsked, question).toBe(false);
      expect(next.status?.message, question).toContain("GS11N-20P2");
      expect(next.status?.message, question).toMatch(/earlier in this conversation/i);
    }
  });

  it("control: a part named in the next question is answered from that part's own sheet", async () => {
    attachTwo(MICRO820_SHEET_AS_STORED, RELAY_SHEET_AS_STORED);
    const handedToModel = () => JSON.stringify(seamMock.buildRequestBody.mock.calls.at(-1));
    await ask(PLATE);

    const relay = await ask("What is the coil voltage of the CA3KN22BD?");
    expect(relay.providerAsked).toBe(true);
    expect(handedToModel()).toContain(RELAY_SHEET_AS_STORED.filename);
    expect(handedToModel(), "the controller sheet is not offered: the conversation was about the drive").not.toContain(MICRO820_SHEET_AS_STORED.filename);
  });

  it("control: a fault-code question with nothing open before it answers", async () => {
    attach(MICRO820_SHEET_AS_STORED);
    const { providerAsked, citations } = await ask("What does fault F0004 mean?");
    expect(providerAsked).toBe(true);
    expect(citations.length).toBeGreaterThan(0);
  });
});
