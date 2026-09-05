/**
 * PHOTO-SOURCE HONESTY (notebook chat route).
 *
 * Run: npx vitest run photo-derived-sources
 *
 * THE DEFECT (real Pixel 9a turn against production, 2026-09-02): a notebook had
 * two photo-derived sources attached and checkbox-included. Asked "Can you read
 * the wire numbers from the photo that is attached?", MIRA answered "I can't read
 * wire numbers because no photo was provided." and, when pushed, "No photo was
 * included in the provided sources." Both are FALSE: the app's own Sources sheet
 * was showing the technician thumbnails and a photo label for those exact rows.
 * Worse, the extracted text it was already holding had been read OFF that
 * photograph by a vision model at nameplate-confirm time.
 *
 * THE FIX UNDER TEST is prompt-side only: the route stops discarding
 * sourceRole/originFileId and states the server-proven fact, plus the honest
 * formulation, inside MACHINE CONTEXT. Nothing here reads or writes the answer.
 *
 * TWO EARLIER DESIGNS WERE BUILT AND REJECTED, both for touching the answer.
 * Sections 4-6 are the permanent locks that make them un-repeatable:
 *   O1 REFERENT MISMATCH  - a truthful denial about a DIFFERENT picture was
 *      rewritten into a false affirmation about the attached one.
 *   O2 DESTROYED REFUSALS - a true negative finding that merely mentioned a
 *      photo in the same sentence was deleted wholesale.
 *   O3 CLASSIFICATION     - injected server text satisfied isRefusal(), so
 *      answers flipped to insufficient_evidence and lost their citations.
 *   O4 SENTENCE SPLITTER  - splitting on [.!?] truncated "The nameplate lists
 *      1.5 A." to "The nameplate lists 1." - a manufactured wrong value.
 *
 * Harness: the Idiom-B skeleton from machine-evidence.test.ts (seam off, so the
 * raw provider body carries messages).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_PDF = "33333333-3333-4333-8333-333333333333";
const DOC_PHOTO = "44444444-4444-4444-8444-444444444444";
const DOC_PHOTO_2 = "66666666-6666-4666-8666-666666666666";
const PHOTO_FILE_ID = "f0000000-0000-4000-8000-000000000001";

const PDF_NAME = "RCMS460-490_D00067_Q_DEEN.pdf";
const PHOTO_NAME = "nameplate-1118ca97-0000-4000-8000-000000000009.txt";
const PHOTO_NAME_2 = "panel-terminals-0002.txt";

/** Verbatim production defect answers. Neither may be altered by the fix — but
 *  neither may be left standing alone, either. */
const DENIAL_1 = "I can't read wire numbers because no photo was provided.";
const DENIAL_2 = "No photo was included in the provided sources, so the wire numbers cannot be read.";
/** The desired model behaviour: photo acknowledged + limitation stated, no
 *  sight claim, no denial — so no notice is owed. */
const HONEST =
  "That photo is attached, but I only receive text extracted from it — I cannot see the image itself, so I cannot read the wire numbers off it.";

const QUESTION = "Can you read the wire numbers from the photo that's attached?";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

/** The Sources-sheet row shape. `sourceRole` + `originFileId` are the two
 *  columns mira-mobile renders "· photo" and the thumbnail from
 *  (NotebookScreen.tsx:628-638) — the same pair the server must not discard. */
type SrcRow = {
  docId: string;
  filename: string | null;
  status: string | null;
  sourceRole: string | null;
  originFileId: string | null;
  pages: number | null;
};
const PDF_ROW: SrcRow = {
  docId: DOC_PDF,
  filename: PDF_NAME,
  status: "ready",
  sourceRole: "manual",
  originFileId: null,
  pages: 40,
};
const PHOTO_ROW: SrcRow = {
  docId: DOC_PHOTO,
  filename: PHOTO_NAME,
  status: "ready",
  sourceRole: "photo",
  originFileId: PHOTO_FILE_ID,
  pages: null,
};
const PHOTO_ROW_2: SrcRow = {
  docId: DOC_PHOTO_2,
  filename: PHOTO_NAME_2,
  status: "ready",
  sourceRole: "photo",
  originFileId: "f0000000-0000-4000-8000-000000000002",
  pages: null,
};

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as unknown[]),
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
vi.mock("@/lib/inference/persist-usage", () => ({
  persistTurnUsage: vi.fn(async () => undefined),
}));

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

import { POST } from "../route";

/** Streams each part as its own delta — a real provider splits mid-sentence, so
 *  the fix must survive that without holding anything back. */
function providerStream(...parts: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
      }
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}
function stubProvider(...parts: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(providerStream(...parts), { status: 200 })),
  );
}
function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const raw = await res.text();
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const p = line.slice(6);
    if (p === "[DONE]") continue;
    try {
      out.push(JSON.parse(p));
    } catch {
      /* partial */
    }
  }
  return out;
}
/** Everything the technician actually reads, in order. */
function contentOf(fs: Record<string, unknown>[]): string {
  return fs
    .filter((f) => f.kind === "content")
    .map((f) => String(f.content))
    .join("");
}
function persistedTurn<T>(): T {
  return (nbMock.recordTurn.mock.calls[0] as unknown[])[2] as T;
}
/** The system prompt the provider actually received. */
function sentSystemPrompt(): string {
  const call = vi.mocked(fetch).mock.calls[0];
  const body = JSON.parse(String((call[1] as RequestInit).body));
  return body.messages[0].content as string;
}

const CHUNK = {
  docId: DOC_PDF,
  title: "RCMS460 manual",
  sourceUrl: "u",
  sourcePage: 12,
  content: "Terminal assignments are listed in section 4.",
};

/** Both photo rows attached AND both in this turn's revalidated scope. */
function twoPhotosInScope() {
  nbMock.listSources.mockResolvedValue([PDF_ROW, PHOTO_ROW, PHOTO_ROW_2]);
  nbMock.validateChatSources.mockResolvedValue({
    ok: true,
    docIds: [DOC_PDF, DOC_PHOTO, DOC_PHOTO_2],
    nodeId: "n1",
  });
}
const ALL_DOCS = [DOC_PDF, DOC_PHOTO, DOC_PHOTO_2];

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.handlers = [];
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.GROQ_API_KEY = "k";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  delete process.env.MIRA_ENFORCE_APPROVED_ASK;
  nbMock.getNotebook.mockResolvedValue({
    id: NB,
    displayName: "Conveyor 1",
    manufacturer: "Automation Direct",
    model: "GS10",
  });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  // Gate G short-circuits a zero-chunk grounded turn BEFORE the prompt is
  // composed and without calling the provider, so a retrieved chunk is
  // mandatory for any assertion about the prompt or the stream.
  ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
  stubProvider(DENIAL_1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1–2. LAYER 1 — the prompt states the server-proven fact.

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE FIX — the prompt states the server-proven fact.
// ─────────────────────────────────────────────────────────────────────────────
describe("1. the prompt states which sources are pictures", () => {
  it("names the count, forbids the denial, and carries the referent bullet", async () => {
    twoPhotosInScope();
    const res = await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params);
    await frames(res);
    const p = sentSystemPrompt();
    expect(p).toContain("ATTACHED PICTURES:");
    expect(p).toContain("2 of the source documents listed above are text extracted from photographs");
    expect(p).toContain("NEVER say that no photo was provided");
    expect(p).toContain("name which pictures ARE attached");
  });

  // The bullet that turns a refusal into an ANSWER. Without it the model treats
  // the extraction as ordinary document text and declines a question the
  // extraction can actually answer.
  it("tells the model the extracted text came from a vision reader", async () => {
    twoPhotosInScope();
    await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));
    const p = sentSystemPrompt();
    expect(p).toContain("produced by a vision reader looking at the photograph");
    expect(p).toContain("Search it before you decline");
    expect(p).toContain("Never answer by denying the photograph");
  });

  it("annotates the photo-derived sources in the loaded-documents line, and only those", async () => {
    twoPhotosInScope();
    await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));
    const p = sentSystemPrompt();
    expect(p).toContain(`${PHOTO_NAME} (text extracted from an attached PICTURE)`);
    expect(p).toContain(`${PDF_NAME},`);
    expect(p).not.toContain(`${PDF_NAME} (text extracted`);
  });

  it("keeps the anti-hallucination floor", async () => {
    twoPhotosInScope();
    await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));
    expect(sentSystemPrompt()).toContain("Never describe, summarize, or infer what a picture looks like");
  });
});

describe("2. sub-count — attached but not selected", () => {
  it("says 'not selected for this chat' when an attached picture is out of scope", async () => {
    nbMock.listSources.mockResolvedValue([PDF_ROW, PHOTO_ROW, PHOTO_ROW_2]);
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_PDF, DOC_PHOTO], nodeId: "n1" });
    await frames(await POST(req({ message: QUESTION, docIds: [DOC_PDF, DOC_PHOTO] }), params));
    const p = sentSystemPrompt();
    expect(p).toContain("not selected for this chat");
    expect(p).toContain('never "not provided"');
  });

  it("does NOT say it when every attached picture is in scope", async () => {
    twoPhotosInScope();
    await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));
    expect(sentSystemPrompt()).not.toContain("not selected for this chat");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. REGRESSION — with no picture attached the prompt is what it always was.
// ─────────────────────────────────────────────────────────────────────────────
describe("3. no picture attached — byte-identical to origin/main", () => {
  beforeEach(() => {
    nbMock.listSources.mockResolvedValue([PDF_ROW]);
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_PDF], nodeId: "n1" });
  });

  it("the MACHINE CONTEXT block is unchanged", async () => {
    await frames(await POST(req({ message: "What is terminal 4?", docIds: [DOC_PDF] }), params));
    const p = sentSystemPrompt();
    expect(p).toContain(`- Loaded source documents: ${PDF_NAME}.\n- Coverage note:`);
    expect(p).not.toContain("ATTACHED PICTURES");
    expect(p).not.toContain("text extracted from an attached PICTURE");
  });

  it("an ordinary grounded answer streams byte-identically", async () => {
    stubProvider("Terminal 4 is the ground lug [1].");
    const fs = await frames(await POST(req({ message: "What is terminal 4?", docIds: [DOC_PDF] }), params));
    expect(contentOf(fs)).toBe("Terminal 4 is the ground lug [1].");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4-6. THE LOCKS. Two rejected designs mutated the answer. Nothing may.
// ─────────────────────────────────────────────────────────────────────────────
describe("4. O1/O2/O4 — model text is never altered, and nothing is appended", () => {
  beforeEach(twoPhotosInScope);

  it("O1: a truthful denial about ANOTHER picture survives verbatim and is not inverted", async () => {
    const truthful = "No photo of the motor terminal box was provided.";
    stubProvider(truthful);
    const fs = await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));
    expect(contentOf(fs)).toBe(truthful);
    expect(contentOf(fs)).not.toContain("is attached to this notebook");
  });

  it("O2: a correct refusal that also mentions a photo is not destroyed", async () => {
    const refusal =
      "I could not find the RCMS490 alarm thresholds in the provided excerpts, and no photo was included.";
    stubProvider(refusal);
    const fs = await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));
    expect(contentOf(fs)).toBe(refusal);
  });

  it("O4: a decimal is never truncated — 'lists 1.5 A' cannot become 'lists 1.'", async () => {
    const withDecimal = "The nameplate lists 1.5 A at 460 V. No photo was provided.";
    stubProvider(withDecimal);
    const fs = await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));
    expect(contentOf(fs)).toBe(withDecimal);
    expect(contentOf(fs)).not.toBe("The nameplate lists 1.");
  });

  it("an abbreviation survives: 'See Fig. 3. No photo was provided.'", async () => {
    const s = "See Fig. 3. No photo was provided.";
    stubProvider(s);
    expect(contentOf(await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params)))).toBe(s);
  });

  it("the verbatim production denial ships unaltered — we fix the PROMPT, not the answer", async () => {
    stubProvider(DENIAL_1);
    const fs = await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));
    expect(contentOf(fs)).toBe(DENIAL_1);
  });

  it("a denial split across three deltas yields the IDENTICAL concatenation", async () => {
    stubProvider("No photo was ", "included in the provided ", "sources.");
    const fs = await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));
    expect(contentOf(fs)).toBe("No photo was included in the provided sources.");
  });
});

describe("5. O3 — a picture in scope cannot change status, citations or basis", () => {
  it("status and citations are IDENTICAL with and without a picture in scope", async () => {
    const answer = "No photo was provided. The manual does not list wire numbers.";

    nbMock.listSources.mockResolvedValue([PDF_ROW]);
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_PDF], nodeId: "n1" });
    stubProvider(answer);
    const without = await frames(await POST(req({ message: QUESTION, docIds: [DOC_PDF] }), params));

    vi.clearAllMocks();
    nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Conveyor 1", manufacturer: "Automation Direct", model: "GS10" });
    nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    twoPhotosInScope();
    stubProvider(answer);
    const with_ = await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));

    const statusOf = (fs: Record<string, unknown>[]) => fs.find((f) => f.kind === "status");
    const citesOf = (fs: Record<string, unknown>[]) =>
      (fs.find((f) => f.kind === "sources")?.citations as unknown[]) ?? [];
    expect(statusOf(with_)).toEqual(statusOf(without));
    expect(citesOf(with_).length).toBe(citesOf(without).length);
    expect(contentOf(with_)).toBe(contentOf(without));
  });
});

describe("6. persistence — the stored turn is the model's text, unchanged", () => {
  it("recordTurn stores exactly what streamed", async () => {
    twoPhotosInScope();
    stubProvider(DENIAL_1);
    await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));
    const turn = persistedTurn<{ answer?: string; answerText?: string }>();
    const stored = String(turn.answer ?? turn.answerText ?? "");
    expect(stored).toBe(DENIAL_1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Observability — the denominator, so the directive's compliance rate can be
//    measured later instead of assumed.
// ─────────────────────────────────────────────────────────────────────────────
describe("7. telemetry", () => {
  it("a served turn with a picture attached emits one photo.turn line", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    twoPhotosInScope();
    await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS }), params));
    const lines = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"photo.turn"'));
    expect(lines).toHaveLength(1);
    const o = JSON.parse(lines[0]);
    expect(o.photosAttached).toBe(2);
    expect(o.photosInScope).toBe(2);
    spy.mockRestore();
  });

  it("a notebook with no picture emits no photo.turn line at all", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    nbMock.listSources.mockResolvedValue([PDF_ROW]);
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_PDF], nodeId: "n1" });
    await frames(await POST(req({ message: "What is terminal 4?", docIds: [DOC_PDF] }), params));
    expect(spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("photo.turn"))).toHaveLength(0);
    spy.mockRestore();
  });
});

describe("8. general mode still receives the directive", () => {
  it("the directive is present even with no retrieved excerpts backing it", async () => {
    twoPhotosInScope();
    await frames(await POST(req({ message: QUESTION, docIds: ALL_DOCS, mode: "general" }), params));
    expect(sentSystemPrompt()).toContain("ATTACHED PICTURES:");
  });
});
