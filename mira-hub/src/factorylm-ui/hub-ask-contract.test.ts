/**
 * Behavioural contract of POST /api/hub/ask — the endpoint the V3 general
 * scope posts to (`askEndpointFor(null)`). Lives in the adapter root because
 * this is the adapter's dependency contract; the route's own `__tests__/`
 * sits on a guarded path and is mostly source-text assertions.
 *
 * Two of these were recorded as UNTESTED when #3682 merged:
 *   M5 — every provider exhausted → HTTP 503 with the documented body;
 *   M6 — citations are `selectCitations(chunks, answer)` through the real
 *        `chunksToSources` (numbered by unique source, only the ones cited).
 * The rest pin the surrounding behaviour the adapter relies on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualChunk } from "@/lib/manual-rag";

const TENANT = "11111111-1111-4111-8111-111111111111";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1", email: "t@x" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const client = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { connect: vi.fn(async () => client) } }));

const cascade = vi.hoisted(() => ({ cascadeComplete: vi.fn() }));
vi.mock("@/lib/llm/cascade", () => cascade);

const rag = vi.hoisted(() => ({ retrieveManualChunks: vi.fn(async () => [] as ManualChunk[]) }));
vi.mock("@/lib/manual-rag", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/manual-rag")>()),
  retrieveManualChunks: rag.retrieveManualChunks,
}));

const limiter = vi.hoisted(() => ({
  rateLimited: vi.fn(() => false),
  clientIpHash: vi.fn(async () => "ip-hash"),
}));
vi.mock("@/lib/ip-rate-limit", () => limiter);

import { POST } from "@/app/api/hub/ask/route";

const chunk = (over: Partial<ManualChunk>): ManualChunk =>
  ({
    title: "manual",
    content: "text",
    manufacturer: "Rockwell",
    modelNumber: "PowerFlex 525",
    sourceUrl: "https://example.test/a.pdf",
    sourcePage: 4,
    rank: 1,
    verified: true,
    ...over,
  }) as ManualChunk;

// A vendor-free question, so stripConflictingVendors (kept real) is a no-op.
const QUESTION = "What does fault code F004 mean and how do I clear it?";

function req(body: unknown): Request {
  return new Request("http://test/api/hub/ask/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.clearAllMocks();
  rag.retrieveManualChunks.mockResolvedValue([]);
  limiter.rateLimited.mockReturnValue(false);
  cascade.cascadeComplete.mockResolvedValue({ content: "answer", provider: "groq" });
});

describe("POST /api/hub/ask — provider exhaustion (M5)", () => {
  it("answers 503 with the documented body when every provider is unreachable", async () => {
    cascade.cascadeComplete.mockResolvedValue(null);
    const res = await POST(req({ question: QUESTION }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      answer: "Sorry — every model provider is unreachable right now. Try again in a minute.",
      citations: [],
      provider: null,
      basis: null,
    });
  });
});

describe("POST /api/hub/ask — citation wiring (M6)", () => {
  it("ships only the sources the answer cited, numbered by unique source", async () => {
    rag.retrieveManualChunks.mockResolvedValue([
      chunk({}),
      chunk({ content: "same page, second excerpt" }),
      chunk({ sourceUrl: "https://example.test/b.pdf", sourcePage: 9, title: "other" }),
    ]);
    cascade.cascadeComplete.mockResolvedValue({ content: "Clear it via P037 [2].", provider: "groq" });

    const res = await POST(req({ question: QUESTION }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toBe("Clear it via P037 [2].");
    expect(body.provider).toBe("groq");
    // [1] = a.pdf p4 (two excerpts collapse to one source); [2] = b.pdf p9. Only [2] was cited.
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]).toMatchObject({ index: 2, url: "https://example.test/b.pdf", page: 9 });
  });

  it("ships no citation when the answer cites nothing, even with chunks retrieved", async () => {
    rag.retrieveManualChunks.mockResolvedValue([chunk({})]);
    cascade.cascadeComplete.mockResolvedValue({ content: "No marker here.", provider: "together" });
    const body = await (await POST(req({ question: QUESTION }))).json();
    expect(body.citations).toEqual([]);
  });
});

describe("POST /api/hub/ask — the surrounding contract the adapter relies on", () => {
  it("retrieves on the raw owner pool with the caller's tenant and releases the client", async () => {
    await POST(req({ question: QUESTION }));
    expect(rag.retrieveManualChunks).toHaveBeenCalledWith(client, TENANT, QUESTION, {
      manufacturer: null,
      topK: 6,
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("still answers (uncited) and releases the client when retrieval throws", async () => {
    rag.retrieveManualChunks.mockRejectedValue(new Error("neon down"));
    const res = await POST(req({ question: QUESTION }));
    expect(res.status).toBe(200);
    expect((await res.json()).citations).toEqual([]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("returns 429 when the tenant or the IP is over the per-minute limit", async () => {
    limiter.rateLimited.mockReturnValue(true);
    const res = await POST(req({ question: QUESTION }));
    expect(res.status).toBe(429);
    expect(cascade.cascadeComplete).not.toHaveBeenCalled();
  });

  it.each([
    ["empty question", { question: "   " }],
    ["over-long question", { question: "x".repeat(1001) }],
    ["invalid JSON", "{not json"],
  ])("rejects %s with 400 before spending a provider call", async (_label, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(cascade.cascadeComplete).not.toHaveBeenCalled();
  });

  it("passes the 401 through untouched when there is no session", async () => {
    const { NextResponse } = await import("next/server");
    sessionMock.sessionOr401.mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never,
    );
    const res = await POST(req({ question: QUESTION }));
    expect(res.status).toBe(401);
    expect(rag.retrieveManualChunks).not.toHaveBeenCalled();
  });
});

/**
 * L0 — the unbound generative Ask (ChatGPT-first lock, wiki/architecture/
 * chatgpt-first-maintenance-genie.md §2.2 evidence rules, §3 L0/L5):
 * "Unbound → may answer from model prior; must label general_reasoning" and
 * "retrieval miss → still may answer generally and say plant docs didn't match
 * — do NOT only emit sources-miss copy". Observed live on /v3 (2026-09-19):
 * "What is a VFD…" → "I'm sorry — I don't have any relevant manual excerpts…
 * upload a VFD manual". These pin the prompt the route sends and the basis it
 * reports, so the shell's General / Manual p.N badge is driven by the server.
 */
describe("POST /api/hub/ask — L0 unbound generative Ask (ChatGPT-first lock)", () => {
  const GENERAL = "What is a VFD and when would I use one on a conveyor";

  function sentMessages(): { system: string; user: string } {
    const [messages] = cascade.cascadeComplete.mock.calls[0] as [Array<{ role: string; content: string }>];
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    return { system, user };
  }

  it("with no retrieved chunks, instructs the model to ANSWER from general knowledge, not to refuse", async () => {
    rag.retrieveManualChunks.mockResolvedValue([]);
    cascade.cascadeComplete.mockResolvedValue({ content: "A VFD varies motor speed…", provider: "groq" });
    const body = await (await POST(req({ question: GENERAL }))).json();
    const { system, user } = sentMessages();
    expect(system).toMatch(/answer(?:s|ing)? (?:it )?from (?:your )?general/i);
    expect(system).not.toMatch(/cite-or-refuse/i);
    expect(system).not.toMatch(/say so plainly and suggest uploading/i);
    expect(user).toContain(GENERAL);
    expect(body.basis).toBe("general_reasoning");
    expect(body.citations).toEqual([]);
  });

  it("still forbids inventing machine-specific facts (fault codes, part numbers, specs, manual refs)", async () => {
    await POST(req({ question: GENERAL }));
    const { system } = sentMessages();
    expect(system).toMatch(/fault codes/i);
    expect(system).toMatch(/part numbers/i);
    expect(system).toMatch(/do not invent|never invent/i);
  });

  it("with chunks that the answer cites, reports basis manual", async () => {
    rag.retrieveManualChunks.mockResolvedValue([chunk({})]);
    cascade.cascadeComplete.mockResolvedValue({ content: "Clear it via P037 [1].", provider: "groq" });
    const body = await (await POST(req({ question: QUESTION }))).json();
    expect(body.basis).toBe("manual");
    expect(body.citations).toHaveLength(1);
  });

  it("with chunks the answer does not cite (retrieval miss), reports basis general_reasoning and tells the model to say the docs did not match", async () => {
    rag.retrieveManualChunks.mockResolvedValue([chunk({})]);
    cascade.cascadeComplete.mockResolvedValue({ content: "Generally, a VFD…", provider: "groq" });
    const body = await (await POST(req({ question: GENERAL }))).json();
    const { system } = sentMessages();
    expect(system).toMatch(/did not match|didn't match|does not support/i);
    expect(body.basis).toBe("general_reasoning");
    expect(body.citations).toEqual([]);
  });
});
