/**
 * The answer is told what is on record about the machine's catalog number.
 *
 * Seen on staging on 2026-11-11 (test account, staging switches): a project
 * confirmed from a typed plate stored the drive as its series only, with no
 * catalog number. Asked "What supply voltage does it need?", the answer gave
 * one variant's voltage class as this drive's. The page it cited did say what
 * the answer said; the page was about a different variant.
 *
 * What the model was sent explains it: the machine header named the series and
 * said nothing about a catalog number, so nothing told the model that the
 * variant was unknown. A project made from a registered machine was sent "an
 * unspecified machine" even though the manual check already knew its model.
 *
 * These rows run the real chat route and the real retrieval function and read
 * the system message that is handed to the provider. Only the database, the
 * session and the provider are stand-ins. They prove what the model is TOLD.
 * They do not prove what a real model then answers; that is seen on staging.
 *
 * Covers are the benchmark's (public PDFs' first stored block). Passage bodies
 * are stand-ins. No model, network or real database call.
 *
 * Run: npx vitest run src/capabilities/__tests__/answer-is-told-the-catalog-number.route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GS10, type Manual } from "./synthetic-technician/bench";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const MACHINE = "44444444-4444-4444-8444-444444444444";
const OTHER_MACHINE = "66666666-6666-4666-8666-666666666666";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({ state: "unbound" })),
  recordTurn: vi.fn(async () => "turn-row"),
  listTurns: vi.fn(async () => []),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: vi.fn(async () => null) }));

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
  // The second argument is the message list handed to the provider.
  buildRequestBody: vi.fn((_provider: unknown, _messages: { role: string; content: string }[], _cap: unknown) => ({})),
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

const params = { params: Promise.resolve({ id: NB }) };
const VARIANT_PASSAGE =
  "Model GS11N-20P2: one-phase 200-240 VAC input. Model GS13N-43P0: three-phase 460 VAC input.";
const QUESTION = "What supply voltage does it need?";

const attach = (m: Manual, content = VARIANT_PASSAGE) => {
  db.rows = [
    {
      doc_id: DOC_A,
      filename: m.filename,
      document_heading: m.heading,
      source_url: `https://test.invalid/${m.key}/${m.filename}`,
      source_page: m.page,
      page_start: m.page,
      page_label: m.pageLabel,
      section_path: null,
      content,
      rank: 0.8,
    },
  ];
};

/** Ask through the real route; return the system message the provider was handed. */
async function systemMessageFor(message: string, extra: Record<string, unknown> = {}) {
  const res = await POST(
    new NextRequest("http://test/api/equipment-notebooks/x/chat", {
      method: "POST",
      body: JSON.stringify({ message, sourceDocIds: db.rows.map((r) => String(r.doc_id)), ...extra }),
      headers: { "Content-Type": "application/json" },
    }),
    params,
  );
  const served = await res.text();
  const call = seamMock.buildRequestBody.mock.calls[0];
  expect(call, `the provider was asked; the route served: ${served.slice(0, 600)}`).toBeDefined();
  const system = call![1].find((m) => m.role === "system");
  expect(system, "a system message was sent").toBeDefined();
  return system!.content;
}

const blankProject = { id: NB, displayName: "Bench drive", manufacturer: null, model: null, catalogNumber: null, identityStatus: "unknown" };
/** What the typed-plate confirm stores today for "AutomationDirect GS11N-20P2". */
const typedPlateProject = { ...blankProject, manufacturer: "AutomationDirect", model: "GS11N", catalogNumber: "", identityStatus: "user_confirmed" };
const boundDrive = {
  state: "resolved",
  entityId: MACHINE,
  name: "CV-101 bench drive",
  unsPath: "enterprise.garage.cv_101.drive",
  selectedVia: "asset_picker",
  confirmedAt: "2026-11-10T07:40:00.000Z",
  manufacturer: "AutomationDirect",
  model: "GS11N-20P2",
};

const NO_CATALOG = /Catalog number: none on record/;
const CATALOG_ON_RECORD = /Catalog number on record:/;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.NOTEBOOK_HYBRID_RETRIEVAL = "0";
  process.env.NOTEBOOK_RERANK = "0";
  process.env.NOTEBOOK_LEXICAL_V2 = "0";
  process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue(blankProject);
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.listSources.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "See the excerpt [1]." } }] })}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    ),
  );
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["NOTEBOOK_HYBRID_RETRIEVAL", "NOTEBOOK_RERANK", "NOTEBOOK_LEXICAL_V2", "MIRA_ENFORCE_APPROVED_RETRIEVAL"]) delete process.env[k];
});

describe("a project with a model on record and no catalog number", () => {
  it("tells the model that no catalog number is on record and how to answer a value that differs by variant", async () => {
    nbMock.getNotebook.mockResolvedValue(typedPlateProject);
    attach(GS10);
    const system = await systemMessageFor(QUESTION);
    expect(system).toContain('- Equipment: AutomationDirect GS11N — "Bench drive".');
    expect(system).toMatch(NO_CATALOG);
    // The instruction, not a ruling on this model: it holds for any model on record.
    expect(system).toMatch(/differs between variants or catalog numbers/);
    expect(system).toMatch(/only when the model above identifies that variant/);
    expect(system).toMatch(/full catalog number from the nameplate/);
    expect(system).not.toMatch(CATALOG_ON_RECORD);
    // One header line, between the equipment line and the document line.
    expect(system).toMatch(/"Bench drive"\.\n- Catalog number: none on record\. [^\n]+ nameplate\.\n- Loaded source documents: none\.\n/);
  });

  it("says the same when the catalog number is stored as null", async () => {
    nbMock.getNotebook.mockResolvedValue({ ...typedPlateProject, catalogNumber: null });
    attach(GS10);
    expect(await systemMessageFor(QUESTION)).toMatch(NO_CATALOG);
  });

  it("says the same for a model nobody has confirmed yet, since the header shows that model too", async () => {
    nbMock.getNotebook.mockResolvedValue({ ...typedPlateProject, identityStatus: "proposed" });
    attach(GS10);
    expect(await systemMessageFor(QUESTION)).toMatch(NO_CATALOG);
  });
});

describe("a project with a catalog number on record", () => {
  it("tells the model the catalog number and does not say none is on record", async () => {
    nbMock.getNotebook.mockResolvedValue({ ...typedPlateProject, catalogNumber: "GS11N-20P2" });
    attach(GS10);
    const system = await systemMessageFor(QUESTION);
    expect(system).toContain(
      '- Equipment: AutomationDirect GS11N — "Bench drive".\n- Catalog number on record: GS11N-20P2.\n- Loaded source documents: none.\n',
    );
    expect(system).not.toMatch(NO_CATALOG);
  });

  it("tells the model the catalog number when no model is on record", async () => {
    nbMock.getNotebook.mockResolvedValue({ ...typedPlateProject, model: null, catalogNumber: "GS11N-20P2" });
    attach(GS10);
    const system = await systemMessageFor(QUESTION);
    expect(system).toContain("- Catalog number on record: GS11N-20P2.");
    expect(system).not.toMatch(NO_CATALOG);
  });
});

describe("a project made from a registered machine", () => {
  it("tells the model the confirmed machine's maker and model instead of an unspecified machine", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue(boundDrive);
    attach(GS10);
    const system = await systemMessageFor(QUESTION);
    expect(system).toContain('- Equipment: AutomationDirect GS11N-20P2 — "Bench drive".');
    expect(system).not.toContain("an unspecified machine");
    expect(system).toContain("Identity CONFIRMED by a technician.");
    // The machine record holds a model, not a catalog number field.
    expect(system).toMatch(NO_CATALOG);
  });

  it("keep: a machine nobody confirmed supplies no model, as today", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue({ ...boundDrive, confirmedAt: null });
    attach(GS10);
    const system = await systemMessageFor(QUESTION);
    expect(system).toContain("- Equipment: an unspecified machine");
    expect(system).not.toContain("GS11N-20P2 —");
    expect(system).not.toMatch(/Catalog number/);
  });

  it("keep: a machine with no model on record supplies none, as today", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue({ ...boundDrive, manufacturer: null, model: null });
    attach(GS10);
    const system = await systemMessageFor(QUESTION);
    expect(system).toContain("- Equipment: an unspecified machine");
    expect(system).not.toMatch(/Catalog number/);
  });

  it("keep: the project's own maker and model are shown, not the machine's, when it has its own", async () => {
    nbMock.getNotebook.mockResolvedValue(typedPlateProject);
    nbMock.resolveBoundAsset.mockResolvedValue(boundDrive);
    attach(GS10);
    const system = await systemMessageFor(QUESTION);
    expect(system).toContain('- Equipment: AutomationDirect GS11N — "Bench drive".');
    expect(system).not.toContain("GS11N-20P2");
  });

  it("keep: when the technician's device is at a different machine, the machine's model and any catalog line are withheld", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue(boundDrive);
    attach(GS10);
    const system = await systemMessageFor(QUESTION, {
      machineEvidence: { assetId: OTHER_MACHINE, anchorAt: "2026-11-11T12:00:00.000Z" },
    });
    expect(system).toContain("identity DISPUTED for this question");
    expect(system).not.toContain("GS11N-20P2");
    expect(system).not.toMatch(/Catalog number/);
  });
});

describe("a turn with no manual to read", () => {
  // The app's general mode, with nothing offered by the database stand-in: no
  // excerpt reaches the model and the route answers on its no-manual path. The
  // question is a general one on purpose: with a model on record and no manual,
  // a question about THIS machine is declined before any provider is asked.
  const noManual = async (project: Record<string, unknown>) => {
    nbMock.getNotebook.mockResolvedValue(project);
    db.rows = [];
    return systemMessageFor("What does PNP mean on a sensor?", { mode: "general" });
  };

  it("keep: the line about excerpts is not sent when there are no excerpts; the header is as today", async () => {
    const system = await noManual(typedPlateProject);
    expect(system).toContain('- Equipment: AutomationDirect GS11N — "Bench drive".\n- Loaded source documents: none.\n');
    expect(system).not.toMatch(/Catalog number/);
  });

  it("a catalog number on record is still stated", async () => {
    const system = await noManual({ ...typedPlateProject, catalogNumber: "GS11N-20P2" });
    expect(system).toContain("- Catalog number on record: GS11N-20P2.\n- Loaded source documents: none.\n");
  });
});

describe("keep: a project with nothing on record", () => {
  it("is sent no machine header at all, as today", async () => {
    attach(GS10);
    const system = await systemMessageFor(QUESTION);
    expect(system).not.toContain("MACHINE CONTEXT");
    expect(system).not.toMatch(/Catalog number/);
  });

  it("stated limit: with ONLY a catalog number on record it is sent no machine header, as today", async () => {
    nbMock.getNotebook.mockResolvedValue({ ...blankProject, catalogNumber: "GS11N-20P2", identityStatus: "user_confirmed" });
    attach(GS10);
    expect(await systemMessageFor(QUESTION)).not.toContain("MACHINE CONTEXT");
  });

  it("with a loaded document it is sent the header with no catalog line, as today", async () => {
    nbMock.listSources.mockResolvedValue([{ filename: GS10.filename }]);
    attach(GS10);
    const system = await systemMessageFor(QUESTION);
    expect(system).toContain("- Equipment: an unspecified machine");
    expect(system).toContain(`- Loaded source documents: ${GS10.filename}.`);
    expect(system).not.toMatch(/Catalog number/);
  });
});
