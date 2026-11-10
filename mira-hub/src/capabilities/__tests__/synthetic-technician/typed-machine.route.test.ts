/**
 * Synthetic technician — the typed plate, through the real notebook chat route.
 *
 * typed-machine.test.ts proves the proposal function. This file sends the same
 * messages through POST /api/equipment-notebooks/[id]/chat for a blank notebook
 * and reads the frames a client would receive. The model provider, the
 * database and the session are stand-ins; the route, the proposal code and the
 * model parser are the real ones. No network, $0.
 *
 * It then does what the card's "Use its manuals" button does: posts the
 * proposal to POST /api/equipment-notebooks/[id]/identity/confirm. That route
 * reads no work-packet switch (it is left unset here, which is production's
 * value, but unsetting it changes nothing). The automatic manual search switch
 * is on, as in production, and one row turns it off. The confirm write is the
 * real function; only the SQL client is a stand-in, so the test reads the
 * statement and the values it would send.
 *
 * The card is offered to a blank project only: no machine picked, no maker or
 * model recorded, no manual selected. The last rows pin that.
 *
 * Not proven here: the card on a screen, the database trigger that promotes a
 * found manual, or production's maker list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "5e7c0000-0000-4000-8000-000000000011";
const NB = "5e7c0000-0000-4000-8000-000000000022";
const NODE = "5e7c0000-0000-4000-8000-000000000033";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async (): Promise<Record<string, unknown>> => ({ state: "unbound" })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
  listTurns: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

// The model parser stays REAL (the proposal depends on it); only the database
// reads are stand-ins. The maker list is the fixture typed-machine.test.ts uses.
const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  corpusManufacturers: vi.fn(async () => [] as string[]),
}));
vi.mock("@/lib/manual-rag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/manual-rag")>()),
  ...ragMock,
}));

// One shared SQL stand-in, so the confirm step can read what would be written.
// Reset to "returns nothing" before every test, which is what the chat route's
// fail-open reads saw before this stand-in was shared.
const tenantQuery = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: tenantQuery })),
}));
vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  },
}));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "stand-in", url: "https://test.invalid/v1", key: "k", model: "m" }]),
  buildRequestBody: vi.fn((provider: { model: string }, messages: unknown) => ({ model: provider.model, messages, stream: true })),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "stand-in" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => true),
  startManualAcquisition: vi.fn(async () => true),
  readAcquisition: vi.fn(async () => null as unknown),
  reconcileAcquisition: vi.fn(async (_t: string, _n: string, rec: unknown) => rec),
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>()),
  ...acqMock,
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { POST as CONFIRM } from "@/app/api/equipment-notebooks/[id]/identity/confirm/route";

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

/** `docIds` empty is what the screen sends as a general question (hub-host-logic.ts). */
async function ask(message: string, docIds: string[] = []): Promise<Record<string, unknown>[]> {
  const res = await POST(
    new NextRequest("http://test/api/equipment-notebooks/x/chat", {
      method: "POST",
      body: JSON.stringify(docIds.length === 0 ? { message, mode: "general" } : { message, docIds }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: NB }) },
  );
  const out: Record<string, unknown>[] = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ") || line.slice(6) === "[DONE]") continue;
    try {
      out.push(JSON.parse(line.slice(6)));
    } catch {
      /* partial frame */
    }
  }
  return out;
}

const proposalIn = (frames: Record<string, unknown>[]) => frames.find((f) => f.kind === "identity_proposal");

/** What the card's "Use its manuals" button sends (hub-host.tsx onConfirmIdentity). */
async function confirm(proposal: Record<string, unknown> | undefined) {
  if (!proposal) throw new Error("no machine was proposed, so there is nothing to confirm");
  const res = await CONFIRM(
    new NextRequest("http://test/api/equipment-notebooks/x/identity/confirm", {
      method: "POST",
      body: JSON.stringify({ manufacturer: proposal.manufacturer, model: proposal.model }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: NB }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The identity write the confirm step sent to the database, if any. */
function identityWrite(): unknown[] | undefined {
  const call = tenantQuery.mock.calls.find(([sql]) => /UPDATE equipment_notebooks/.test(String(sql)));
  return call?.[1] as unknown[] | undefined;
}

const writeSucceeds = () =>
  tenantQuery.mockImplementation(async (sql: string) =>
    /UPDATE equipment_notebooks/.test(sql) ? { rows: [{ id: NB }], rowCount: 1 } : { rows: [], rowCount: 0 },
  );

beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.NEON_DATABASE_URL = "postgres://test";
  delete process.env.NOTEBOOK_WORK_PACKET;
  vi.clearAllMocks();
  tenantQuery.mockReset();
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "New machine", nodeId: NODE, manufacturer: null, model: null });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  ragMock.retrieveManualChunks.mockResolvedValue([]);
  ragMock.corpusManufacturers.mockResolvedValue(["Rockwell Automation", "AutomationDirect", "Schneider Electric", "Siemens"]);
  acqMock.acquisitionEnabled.mockReturnValue(true);
  acqMock.startManualAcquisition.mockResolvedValue(true);
  acqMock.readAcquisition.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("A general reply."), { status: 200 })));
});

describe("a blank notebook, and the technician types both lines of the PLC's plate", () => {
  const TYPED = "Allen-Bradley Micro820 2080-LC20-20QBB has a red fault light";

  it("the reply carries a machine proposal for the family", async () => {
    expect(proposalIn(await ask(TYPED))).toMatchObject({ manufacturer: "Allen-Bradley", model: "820" });
  });

  it("nothing is bound and no manual search starts before the technician confirms", async () => {
    await ask(TYPED);
    expect(nbMock.recordTurn).toHaveBeenCalled();
    expect(identityWrite()).toBeUndefined();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  it("a plate that contradicts itself is not proposed", async () => {
    expect(proposalIn(await ask("Allen-Bradley Micro850 2080-LC20-20QBB has a red fault light"))).toBeUndefined();
  });

  // Codex round 1 on #5387 (F1): an explicit two-machine question. The second
  // machine has no digit in its name, so only the shared model detector sees it.
  it("the plate beside a second machine with no digit in its name carries no proposal", async () => {
    const frames = await ask("Allen-Bradley Micro820 2080-LC20-20QBB and an SMC Flex both faulted, which manual should I use?");
    expect(proposalIn(frames)).toBeUndefined();
    expect(identityWrite()).toBeUndefined();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  // Codex round 3 on #5387 (F4): the second machine is a product line named
  // in two everyday words. Main sends no card for these; the reviewed head did.
  it.each(["POINT I/O", "FLEX I/O", "Compact I/O", "POINT I/Os", "Flex-I/O", "Compact 5000 I/O"])("the plate beside a %s rack carries no proposal", async (line) => {
    const frames = await ask(`Allen-Bradley Micro820 2080-LC20-20QBB and a ${line} rack both faulted, which manual should I use?`);
    expect(proposalIn(frames)).toBeUndefined();
    expect(identityWrite()).toBeUndefined();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  // Codex round 2 on #5387 (F3): a rating typed after the machine is not a
  // second machine. Main sends this card; the reviewed head sent none.
  it("the family with its supply voltage after a comma still carries the proposal", async () => {
    expect(proposalIn(await ask("Allen-Bradley Micro820, 24 VDC supply"))).toMatchObject({ manufacturer: "Allen-Bradley", model: "820" });
  });

  it("both lines of the plate with a comma between them still carry the proposal", async () => {
    expect(proposalIn(await ask("Allen-Bradley Micro820, 2080-LC20-20QBB, 24 VDC"))).toMatchObject({ manufacturer: "Allen-Bradley", model: "820" });
  });

  it("a sibling written as a bare number after the plate carries no proposal", async () => {
    expect(proposalIn(await ask("Allen-Bradley Micro820 2080-LC20-20QBB and 850 both faulted"))).toBeUndefined();
  });
});

describe("a blank notebook, and the technician types the relay the way its data sheet titles it", () => {
  it("the reply carries a machine proposal for the relay", async () => {
    expect(proposalIn(await ask("Schneider Electric TeSys K CA3KN22BD, what is the coil voltage?"))).toMatchObject({
      manufacturer: "Schneider Electric",
      model: "CA3KN22BD",
    });
  });

  it("the relay beside a second machine with no digit in its name carries no proposal", async () => {
    expect(proposalIn(await ask("Schneider Electric TeSys K CA3KN22BD and an SMC Flex both faulted"))).toBeUndefined();
  });

  // Cheap review round 9: the number belongs to an Allen-Bradley controller.
  // The typed-text reader is the only one asked when the label reader is
  // switched off with the automatic manual search; there it now gives no card,
  // as on main.
  it("the relay's range before another maker's catalog number carries no proposal from the typed-text reader", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(false);
    const frames = await ask("Schneider Electric TeSys 2080-LC20-20QBB has a red fault light");
    expect(proposalIn(frames)).toBeUndefined();
    expect(identityWrite()).toBeUndefined();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  // KNOWN LIMIT, on main and unchanged here: with the label reader on, IT
  // proposes the maker and the part for the same message (a maker and one part
  // number, nothing else). Main shows this same card. The spelling of the
  // maker tells the two readers apart.
  it("known limit: the label reader still proposes that message, the same card as main", async () => {
    const proposal = proposalIn(await ask("Schneider Electric TeSys 2080-LC20-20QBB has a red fault light"));
    expect(proposal).toMatchObject({ manufacturer: "SCHNEIDER ELECTRIC", model: "2080-LC20-20QBB" });
  });

  it("control: a general question proposes nothing", async () => {
    expect(proposalIn(await ask("what does PNP mean on a sensor?"))).toBeUndefined();
  });
});

describe("the technician taps \"Use its manuals\" on the card, with the work-packet switch off", () => {
  it("PLC: the family is recorded as the confirmed machine, and only then does the manual search start", async () => {
    const proposal = proposalIn(await ask("Allen-Bradley Micro820 2080-LC20-20QBB has a red fault light"));
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    writeSucceeds();

    const { status, body } = await confirm(proposal);

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, manufacturer: "Allen-Bradley", model: "820", catalogNumber: "" });
    const write = identityWrite();
    expect(write?.slice(0, 5)).toEqual([TENANT, NB, "Allen-Bradley", "820", ""]);
    expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
    expect(acqMock.startManualAcquisition.mock.calls[0]).toMatchObject([
      { notebookId: NB, identity: { identityStatus: "user_confirmed", manufacturer: "Allen-Bradley", model: "820" } },
    ]);
  });

  it("relay: the catalog number is recorded as the confirmed machine", async () => {
    const proposal = proposalIn(await ask("Schneider Electric TeSys K CA3KN22BD, what is the coil voltage?"));
    writeSucceeds();

    const { status, body } = await confirm(proposal);

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, manufacturer: "Schneider Electric", model: "CA3KN22BD" });
    expect(identityWrite()?.slice(0, 5)).toEqual([TENANT, NB, "Schneider Electric", "CA3KN22BD", ""]);
  });

  it("control: the drive, which main already proposes, is recorded as its series", async () => {
    const proposal = proposalIn(await ask("AutomationDirect GS11N-20P2 trips on acceleration"));
    writeSucceeds();

    const { status, body } = await confirm(proposal);

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, manufacturer: "AutomationDirect", model: "GS11N" });
    expect(identityWrite()?.slice(0, 5)).toEqual([TENANT, NB, "AutomationDirect", "GS11N", ""]);
  });

  it("control: a machine already confirmed as something else is not overwritten (a stale card)", async () => {
    const proposal = { manufacturer: "Allen-Bradley", model: "820" };
    tenantQuery.mockImplementation(async (sql: string) =>
      /UPDATE equipment_notebooks/.test(sql)
        ? { rows: [], rowCount: 0 }
        : { rows: [{ manufacturer: "AutomationDirect", model: "GS11N-20P2" }], rowCount: 1 },
    );

    const { status, body } = await confirm(proposal);

    expect(status).toBe(409);
    expect(body).toMatchObject({ error: "identity_already_confirmed", manufacturer: "AutomationDirect", model: "GS11N-20P2" });
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  it("control: the plate that contradicts itself gives the technician nothing to confirm", async () => {
    const proposal = proposalIn(await ask("Allen-Bradley Micro850 2080-LC20-20QBB has a red fault light"));
    await expect(confirm(proposal)).rejects.toThrow("nothing to confirm");
    expect(identityWrite()).toBeUndefined();
  });
});

// The card is offered to a BLANK project only. These rows pin that, because the
// pilot's project is set up with a machine picked and a manual attached: there,
// typing the plate offers nothing, with or without this branch.
describe("the same plate typed into a project that is no longer blank", () => {
  const TYPED = "Allen-Bradley Micro820 2080-LC20-20QBB has a red fault light";
  const DOC = "5e7c0000-0000-4000-8000-000000000044";

  it("a machine is already picked: no card", async () => {
    nbMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved",
      entityId: "5e7c0000-0000-4000-8000-000000000055",
      name: "CV-101",
      unsPath: "enterprise.garage.demo_cell.cv_101",
      selectedVia: "asset_picker",
      confirmedAt: null,
    });
    expect(proposalIn(await ask(TYPED))).toBeUndefined();
  });

  it("a model is already recorded: no card", async () => {
    nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "PLC", nodeId: NODE, manufacturer: null, model: "Micro850" });
    expect(proposalIn(await ask(TYPED))).toBeUndefined();
  });

  it("a manual is attached and selected: no card", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC], nodeId: NODE });
    nbMock.listSources.mockResolvedValue([{ filename: "2080-um005.pdf" }]);
    expect(proposalIn(await ask(TYPED, [DOC]))).toBeUndefined();
  });
});

describe("the confirm step with the automatic manual search switched off", () => {
  it("the machine is still recorded, and no search starts", async () => {
    const proposal = proposalIn(await ask("Allen-Bradley Micro820 2080-LC20-20QBB has a red fault light"));
    acqMock.acquisitionEnabled.mockReturnValue(false);
    writeSucceeds();

    const { status, body } = await confirm(proposal);

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, model: "820", searching: false });
    expect(identityWrite()?.slice(0, 5)).toEqual([TENANT, NB, "Allen-Bradley", "820", ""]);
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });
});
