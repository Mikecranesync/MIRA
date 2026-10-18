/**
 * TQ-08 (2026-10-17 prod test) — the route wiring for the claim-support check.
 *
 * The capability itself is covered in `capabilities/__tests__/claim-support.test.ts`.
 * What is proven HERE is the wiring, which the capability tests cannot reach:
 * with the flag on, an answer whose value is absent from the page it cites is
 * replaced BEFORE release and the turn is persisted as a refusal; with the
 * flag off (the default) the identical turn streams untouched.
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/claim-support-gate.test.ts"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CLAIM_NOT_STATED_TEXT } from "@/capabilities/claim-support";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

/** The cited page states 1.76 N·m — and nothing else. */
const TORQUE_CHUNK = {
  content: "Terminal screw torque: tighten the main circuit terminals to 1.76 N·m before applying power.",
  docId: DOC_A,
  manufacturer: "",
  modelNumber: "",
  sourceUrl: "node-doc/u1/gs10.pdf",
  sourcePage: 21,
  chunkIndex: null,
  title: "GS10 User Manual.pdf",
  rank: 0.5,
  verified: true,
};

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  neutralizeReferenceText: vi.fn((t: string) => t),
}));
vi.mock("@/lib/manual-rag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/manual-rag")>();
  return { ...actual, ...ragMock };
});

vi.mock("@/lib/workspace-files", () => ({
  photoLinkedToTarget: vi.fn(async () => null),
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: vi.fn(async () => ({ rows: [] })) }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

import { POST } from "../route";

const params = { params: Promise.resolve({ id: NB }) };
const req = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && !l.startsWith("data: [DONE]"))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
}
const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;

/** Streams `text`; answers the non-streaming semantic judge with "safe". */
function provider(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"verdict":"safe","hazard_class":"none","reason":"ok"}' } }] }),
          { status: 200 },
        );
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(delta(text)));
            c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`));
            c.enqueue(enc.encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    }),
  );
}

// The value is NOT on the cited page (the page says 1.76 N·m).
const WRONG_VALUE_ANSWER = "Tighten the main terminals to 2.5 N·m [1].";
const ASK = "what is the terminal screw torque";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  delete process.env.NOTEBOOK_CLAIM_SUPPORT;
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "GS10", manufacturer: "AutomationDirect", model: "GS10" });
  ragMock.retrieveNodeChunks.mockResolvedValue([TORQUE_CHUNK]);
  provider(WRONG_VALUE_ANSWER);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env.NOTEBOOK_CLAIM_SUPPORT;
});

const contentOf = (f: Record<string, unknown>[]) =>
  f.filter((x) => x.kind === "content").map((x) => String(x.content)).join("");

describe("TQ-08 — a value absent from the cited page is withheld (flag on)", () => {
  it("replaces the answer before release, states no number, and persists a refusal", async () => {
    process.env.NOTEBOOK_CLAIM_SUPPORT = "1";
    const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));

    const content = contentOf(out);
    expect(content).toContain("won't state it as fact");
    expect(content).not.toContain("2.5");
    expect(content).toBe(CLAIM_NOT_STATED_TEXT);

    const status = out.find((f) => f.kind === "status") as { status: string };
    expect(status.status).toBe("insufficient_evidence");

    expect(nbMock.recordTurn).toHaveBeenCalledTimes(1);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as {
      answerStatus: string;
      answerText: string | null;
    };
    expect(persisted.answerStatus).toBe("insufficient_evidence");
    expect(persisted.answerText).not.toContain("2.5");
  });

  it("control: the SAME turn with the flag off (the default) streams the model's answer untouched", async () => {
    const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
    expect(contentOf(out)).toContain("2.5");
    const status = out.find((f) => f.kind === "status") as { status: string };
    expect(status.status).toBe("answered");
  });

  it("control: with the flag ON, an answer stating the page's own value still releases", async () => {
    process.env.NOTEBOOK_CLAIM_SUPPORT = "1";
    provider("Tighten the main circuit terminals to 1.76 N·m [1].");
    const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
    expect(contentOf(out)).toContain("1.76");
    const status = out.find((f) => f.kind === "status") as { status: string };
    expect(status.status).toBe("answered");
  });
});
