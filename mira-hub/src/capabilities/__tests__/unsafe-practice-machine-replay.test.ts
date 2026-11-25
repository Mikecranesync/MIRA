/**
 * #5905 Codex r4 F15: a recorded machine window does not lift the unsafe-practice abstain.
 *
 * Telemetry (a motor-speed or photo-eye replay) cannot support a cleaning or cabinet
 * procedure, so a hazard-topic turn with zero retrieved chunks gets the card and the
 * fixed reply even when the bound machine has a grounded replay window. A question
 * without the topic still uses the replay, as before.
 *
 * Mocks follow `src/app/api/equipment-notebooks/[id]/chat/__tests__/machine-evidence.test.ts`.
 *
 * Run: npx vitest run src/capabilities/__tests__/unsafe-practice-machine-replay.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { LIVE_SCREEN_CLEANING_CARD, OPEN_ENCLOSURE_CARD, UNSAFE_PRACTICE_NO_EVIDENCE_TEXT } from "../unsafe-practice-advisory";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const ASSET = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8";
const UNS = "enterprise.home_garage.conveyor_lab.conveyor_1";
const FAULT_AT = "2026-08-27T23:16:31.000Z";

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
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => `${p}\n[MANUAL RULES]`),
  buildManualUserContent: vi.fn((q: string) => q),
  neutralizeReferenceText: vi.fn((t: string) => t.replace(/\[Source:[^\]]+\]/gi, "[ref]")),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

type Handler = [RegExp, { rows: unknown[] }];
const dbMock = vi.hoisted(() => ({ handlers: [] as Handler[] }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: async (sql: string) => {
        for (const [re, res] of dbMock.handlers) if (re.test(sql)) return res;
        return { rows: [] };
      },
    }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

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
const params = { params: Promise.resolve({ id: NB }) };
function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const statusMessage = (raw: string) =>
  raw
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => {
      try {
        return JSON.parse(l) as { kind?: string; message?: string };
      } catch {
        return {};
      }
    })
    .find((f) => f.kind === "status")?.message;
type Turn = { answerText: string | null; answerStatus?: string; evidence: { kind?: string }[] };
const lastTurn = () => (nbMock.recordTurn.mock.calls.at(-1) as unknown[] | undefined)?.[2] as Turn | undefined;

// Only the photo eye and the run command: nothing in it covers cleaning a screen or a cabinet door.
const MACHINE: Handler[] = [
  [/FROM kg_entities/, { rows: [{ uns_path: UNS }] }],
  [
    /FROM tag_events/,
    { rows: [{ event_timestamp: "2026-08-27T23:16:28.860Z", ingested_at: "2026-08-27T23:16:30.900Z", uns_path: UNS, tag_path: "Conveyor/photo_eye", value: "true", quality: "good" }] },
  ],
  [
    /FROM tag_event_diffs/,
    { rows: [{ event_timestamp: "2026-08-27T23:16:29.180Z", detected_at: "2026-08-27T23:16:31.000Z", uns_path: UNS, tag_path: "Conveyor/run_cmd", prev_value: "false", new_value: "true", diff_type: "rising_edge" }] },
  ],
];
const ME = { assetId: ASSET, anchorAt: FAULT_AT, pre: 5, post: 2 };
const SCREEN_ASK = "Can I wipe the HMI while alarms are active and the line is running?";
const CABINET_ASK = "The electrical cabinet door is open beside the disconnect. Can I leave it that way overnight?";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  dbMock.handlers = [...MACHINE];
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.GROQ_API_KEY = "k";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  delete process.env.MIRA_ENFORCE_APPROVED_ASK;
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Conveyor 1", manufacturer: "Automation Direct", model: "GS10" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "resolved", entityId: ASSET, name: "Conveyor 1", unsPath: UNS, selectedVia: "qr_scan", confirmedAt: "2026-08-27T23:00:00.000Z" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  fetchMock = vi.fn(async () => new Response(providerStream("Sure, wipe it while it runs."), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

async function general(message: string, machineEvidence: unknown = ME) {
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  const res = await POST(req({ message, mode: "general", ...(machineEvidence ? { machineEvidence } : {}) }), params);
  const text = await res.text();
  await vi.waitFor(() => expect(nbMock.recordTurn).toHaveBeenCalled(), { timeout: 2000 });
  return { status: res.status, text, turn: lastTurn()! };
}

describe("#5905 r4 F15: a grounded replay window does not unlock an answer under the card", () => {
  it("precondition: the same window grounds an ordinary question, which reaches the provider", async () => {
    const { status, turn } = await general("what happened right before the fault?");
    expect(status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    expect(turn.evidence.some((e) => e.kind === "machine_evidence")).toBe(true);
    expect(turn.answerText).not.toContain(LIVE_SCREEN_CLEANING_CARD);
  });

  for (const [label, message, card] of [
    ["live screen (r4 F12 wording)", SCREEN_ASK, LIVE_SCREEN_CLEANING_CARD],
    ["open cabinet (r4 F13 wording)", CABINET_ASK, OPEN_ENCLOSURE_CARD],
  ] as const) {
    it(`${label}: card once over the fixed reply, live and stored, no provider call`, async () => {
      const { status, text, turn } = await general(message);
      expect(status).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(turn.answerStatus).toBe("insufficient_evidence");
      expect(turn.answerText).toBe(`${card}\n\n${UNSAFE_PRACTICE_NO_EVIDENCE_TEXT}`);
      expect(statusMessage(text)).toBe(turn.answerText);
      expect(turn.answerText!.split(card).length - 1).toBe(1);
    });
  }

  it("selected sources with zero hits and a grounded window: the card over the canned abstain, no provider call", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
    const res = await POST(req({ message: SCREEN_ASK, sourceDocIds: [DOC_A], machineEvidence: ME }), params);
    const text = await res.text();
    await vi.waitFor(() => expect(nbMock.recordTurn).toHaveBeenCalled(), { timeout: 2000 });
    const turn = lastTurn()!;
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(turn.answerText!.startsWith(LIVE_SCREEN_CLEANING_CARD)).toBe(true);
    expect(turn.answerText).not.toMatch(/wipe it while it runs/i);
    expect(statusMessage(text)).toBe(turn.answerText);
  });
});
