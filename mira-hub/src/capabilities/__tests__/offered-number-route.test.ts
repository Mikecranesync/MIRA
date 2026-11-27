/**
 * #6085: the identity card frame offers the typed order number, live and in the saved turn.
 * Same stand-ins as synthetic-technician/typed-machine.route.test.ts: the route, the proposal
 * code, the model parser and the offered-number reader are real; the provider, database and
 * session are stand-ins. The automatic manual search switch is on, as in production. No
 * network, $0.
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/__tests__/offered-number-route
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseFrame } from "@/lib/notebook-chat-types";

const TENANT = "6085c000-0000-4000-8000-000000000011";
const NB = "6085c000-0000-4000-8000-000000000022";
const NODE = "6085c000-0000-4000-8000-000000000033";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })) }));

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

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  corpusManufacturers: vi.fn(async () => [] as string[]),
}));
vi.mock("@/lib/manual-rag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/manual-rag")>()),
  ...ragMock,
}));

const tenantQuery = vi.hoisted(() => vi.fn(async () => ({ rows: [], rowCount: 0 })));
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
vi.mock("@/lib/inference/canonical-cascade", () => ({
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
const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => true),
  startManualAcquisition: vi.fn(async () => true),
  readAcquisition: vi.fn(async () => null as unknown),
  reconcileAcquisition: vi.fn(async (_t: string, _n: string, rec: unknown) => rec),
}));
// The offer is the real reader unless a test stands one in (`offer.fn`).
const offer = vi.hoisted(() => ({ fn: null as null | ((q: string, id: unknown) => string | null) }));
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>();
  return {
    ...real,
    ...acqMock,
    offeredOwnNumber: (q: string, id: Parameters<typeof real.offeredOwnNumber>[1]) => (offer.fn ? offer.fn(q, id) : real.offeredOwnNumber(q, id)),
  };
});

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

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

async function ask(message: string): Promise<Record<string, unknown>[]> {
  const res = await POST(
    new NextRequest("http://test/api/equipment-notebooks/x/chat", {
      method: "POST",
      body: JSON.stringify({ message, mode: "general" }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: NB }) },
  );
  const out: Record<string, unknown>[] = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ") || line.slice(6) === "[DONE]") continue;
    try { out.push(JSON.parse(line.slice(6))); } catch { /* partial frame */ }
  }
  return out;
}

const proposalIn = (frames: Record<string, unknown>[]) => frames.find((f) => f.kind === "identity_proposal");
const savedProposal = () => {
  const turn = (nbMock.recordTurn.mock.calls as unknown as Array<[string, string, { evidence?: unknown[] }]>)[0]?.[2];
  return (turn?.evidence ?? []).find((e) => (e as { kind?: string }).kind === "identity_proposal") as Record<string, unknown> | undefined;
};

const WALK = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";

beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.NEON_DATABASE_URL = "postgres://test";
  delete process.env.NOTEBOOK_WORK_PACKET;
  vi.clearAllMocks();
  offer.fn = null;
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "New machine", nodeId: NODE, manufacturer: null, model: null });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  ragMock.corpusManufacturers.mockResolvedValue(["Siemens", "Schneider Electric", "AutomationDirect"]);
  acqMock.acquisitionEnabled.mockReturnValue(true);
  acqMock.startManualAcquisition.mockResolvedValue(true);
  acqMock.readAcquisition.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("A general reply."), { status: 200 })));
});

describe("the identity card offers the typed order number (#6085)", () => {
  it("precondition: the walk question gets a Siemens TP700 card", async () => {
    expect(proposalIn(await ask(WALK))).toMatchObject({ manufacturer: "Siemens", model: "TP700" });
  });

  it("the live card frame offers the order number", async () => {
    expect(proposalIn(await ask(WALK))).toMatchObject({ offeredNumber: "6AV2124-0GC01-0AX0" });
  });

  it("the saved turn's card offers the same number, so a reload shows the same box", async () => {
    await ask(WALK);
    expect(savedProposal()).toMatchObject({ kind: "identity_proposal", offeredNumber: "6AV2124-0GC01-0AX0" });
  });

  // The route emits the card from two places: next to a generated answer, and on a turn that
  // abstains without calling the model. A manual request with nothing retrieved abstains. Its
  // card comes from the exact-request reader, which proposes the order number as the model, so
  // the only other token is the family name, and a model name is never offered.
  const ABSTAIN = "Find the manual for Siemens TP700 Comfort 6AV2124-0GC01-0AX0";
  it("the abstained manual-request card offers nothing: its other token is a model name", async () => {
    const frames = await ask(ABSTAIN);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled(); // precondition: the turn abstained
    expect(frames).toContainEqual(expect.objectContaining({ kind: "status", status: "insufficient_evidence" }));
    expect(proposalIn(frames)).toMatchObject({ model: "6AV2124-0GC01-0AX0" });
    expect(proposalIn(frames)).not.toHaveProperty("offeredNumber");
  });

  // No typed question both abstains and offers today, so the abstained emit site is pinned with
  // a stood-in offer: whatever the reader returns rides the abstained card, live and saved.
  it("the abstained turn's card carries whatever the offer returns", async () => {
    offer.fn = () => "6AV2124-0GC01-0AX0";
    const frames = await ask(ABSTAIN);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(proposalIn(frames)).toMatchObject({ offeredNumber: "6AV2124-0GC01-0AX0" });
    expect(savedProposal()).toMatchObject({ offeredNumber: "6AV2124-0GC01-0AX0" });
  });

  // The offer is an optional extra on the card: a reader that throws must not cost the answer.
  it("a reader that throws leaves the card without an offer, and the turn answers", async () => {
    offer.fn = () => { throw new Error("offer failed"); };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const frames = await ask(WALK);
    expect(proposalIn(frames)).toMatchObject({ manufacturer: "Siemens", model: "TP700" });
    expect(proposalIn(frames)).not.toHaveProperty("offeredNumber");
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    expect(nbMock.recordTurn).toHaveBeenCalledTimes(1);
  });

  // #6104 r1 F1: two order numbers joined in one token are not one number.
  it("a token joining two order numbers gets a TP700 card with no offer", async () => {
    const card = proposalIn(await ask("Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0|S7-1200 will not power up."));
    expect(card).toMatchObject({ manufacturer: "Siemens", model: "TP700" }); // precondition: the card exists
    expect(card).not.toHaveProperty("offeredNumber");
  });

  it("control: a card whose question names no number offers none", async () => {
    const card = proposalIn(await ask("Our Siemens TP700 Comfort panel will not power up."));
    expect(card).toMatchObject({ manufacturer: "Siemens", model: "TP700" });
    expect(card).not.toHaveProperty("offeredNumber");
  });
});

describe("the frame validator (#6085)", () => {
  const base = { kind: "identity_proposal", manufacturer: "Siemens", model: "TP700" };
  it("keeps a string offeredNumber", () => {
    expect(parseFrame(JSON.stringify({ ...base, offeredNumber: "6AV2124-0GC01-0AX0" }))).toMatchObject({ offeredNumber: "6AV2124-0GC01-0AX0" });
  });
  it("rejects a non-string offeredNumber, the same way it rejects a non-string catalogNumber", () => {
    expect(parseFrame(JSON.stringify({ ...base, offeredNumber: 6 }))).toBeNull();
    expect(parseFrame(JSON.stringify({ ...base, catalogNumber: 6 }))).toBeNull();
  });
  it("control: a frame with no offeredNumber still parses", () => {
    expect(parseFrame(JSON.stringify(base))).toMatchObject(base);
  });
});
