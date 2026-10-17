/**
 * #4224 Defect B — the grounding-honesty floor on /api/quickstart/ask.
 *
 * On citations:[] (a non-refusal answer that cited no manual) the route must
 * prepend the explicit "not grounded in an OEM manual" notice, mirroring the
 * authenticated equipment-notebook's "General guidance - not grounded in this
 * machine's documents." label. Before the fix the route shipped a confident,
 * unlabelled wall of text and broke the page's own "if we can't cite a source,
 * we say so" promise.
 *
 * Lives under src/capabilities/ (not the route's co-located __tests__/, which
 * is frozen legacy UI — FactoryLM Unified UI Cutover), per the #3978 precedent.
 *
 * The trigger is UNCONDITIONAL on citations: it does NOT depend on how many
 * chunks were retrieved. Chunk count is unobservable from Mike's report (he
 * gave citation counts, not chunk counts), so a chunks>0 gate could silently
 * leave the P0 live while chunk-present mocks showed green. The two positives
 * below — one with chunks, one with NONE — pin that.
 *
 * Controls (per .claude/rules/prove-the-test-fails.md §7):
 *   - a CITED answer must NOT get the notice, and
 *   - an explicit REFUSAL must NOT get the notice (it already admits it) — the
 *     case a naive "citations empty -> stamp" would double-label.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUICKSTART_UNGROUNDED_NOTICE,
  QUICKSTART_REFUSAL_MARK,
  withUngroundedNotice,
  type ManualChunk,
} from "@/lib/manual-rag";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.11" })) }));

const tenant = vi.hoisted(() => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => Promise<unknown>) => fn({})),
}));
vi.mock("@/lib/tenant-context", () => tenant);

const cascade = vi.hoisted(() => ({ cascadeComplete: vi.fn() }));
vi.mock("@/lib/llm/cascade", () => cascade);

const rag = vi.hoisted(() => ({ retrieveManualChunks: vi.fn(async () => [] as ManualChunk[]) }));
vi.mock("@/lib/manual-rag", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/manual-rag")>()),
  retrieveManualChunks: rag.retrieveManualChunks,
}));

import { POST } from "@/app/api/quickstart/ask/route";

function req(body: unknown): Request {
  return new Request("http://test/api/quickstart/ask/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const chunk = (i: number): ManualChunk => ({
  content: `chunk ${i}`,
  manufacturer: "Rockwell Automation",
  modelNumber: "PowerFlex 525",
  sourceUrl: `mira://seeds/pf525/${i}`,
  sourcePage: i,
  title: `PowerFlex 525 ${i}`,
  rank: 1,
  verified: true,
} as ManualChunk);

const UNCITED_ANSWER =
  "Most likely cause: a DC-bus voltage problem on power-up.\n\n" +
  "General guidance (not from a manual):\n- Verify incoming line voltage.";

beforeEach(() => {
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.QUICKSTART_TENANT_ID = "11111111-1111-4111-8111-111111111111";
  vi.clearAllMocks();
  rag.retrieveManualChunks.mockResolvedValue([]);
  cascade.cascadeComplete.mockResolvedValue({ content: "answer", provider: "groq" });
});

describe("POST /api/quickstart/ask — grounding-honesty floor (#4224 Defect B)", () => {
  it("prepends the no-source notice when candidates were retrieved but none cited (the F0004 case)", async () => {
    rag.retrieveManualChunks.mockResolvedValue([chunk(1), chunk(2)]);
    cascade.cascadeComplete.mockResolvedValue({ content: UNCITED_ANSWER, provider: "groq" });

    const body = await (await POST(req({ question: "PowerFlex 525 fault F0004 on power-up, drive won't reset" }))).json();

    // citations empty for the RIGHT reason: no [n] markers, and not a refusal.
    expect(body.citations).toEqual([]);
    expect(body.answer).not.toContain(QUICKSTART_REFUSAL_MARK);
    expect(body.answer.startsWith(QUICKSTART_UNGROUNDED_NOTICE)).toBe(true);
    expect(body.answer).toContain("DC-bus voltage problem");
  });

  it("STILL fires when zero chunks were retrieved — the trigger is citations, not chunk count", async () => {
    rag.retrieveManualChunks.mockResolvedValue([]); // nothing retrieved at all
    cascade.cascadeComplete.mockResolvedValue({ content: UNCITED_ANSWER, provider: "groq" });

    const body = await (await POST(req({ question: "some drive is acting weird" }))).json();

    expect(body.citations).toEqual([]);
    expect(body.answer.startsWith(QUICKSTART_UNGROUNDED_NOTICE)).toBe(true);
  });

  it("does NOT add the notice to a cited answer (control)", async () => {
    rag.retrieveManualChunks.mockResolvedValue([chunk(1), chunk(2)]);
    cascade.cascadeComplete.mockResolvedValue({ content: "Fault F005 is overvoltage [1]. Check the DC bus.", provider: "groq" });

    const body = await (await POST(req({ question: "PowerFlex 525 fault F005" }))).json();

    expect(body.citations.map((c: { index: number }) => c.index)).toEqual([1]);
    expect(body.answer).not.toContain(QUICKSTART_UNGROUNDED_NOTICE);
  });

  it("does NOT double-stamp an explicit refusal (control — it already admits it)", async () => {
    rag.retrieveManualChunks.mockResolvedValue([chunk(1)]);
    cascade.cascadeComplete.mockResolvedValue({ content: `${QUICKSTART_REFUSAL_MARK}. Try rephrasing.`, provider: "groq" });

    const body = await (await POST(req({ question: "something with no coverage" }))).json();

    expect(body.citations).toEqual([]);
    expect(body.answer).not.toContain(QUICKSTART_UNGROUNDED_NOTICE);
    expect(body.answer).toContain(QUICKSTART_REFUSAL_MARK);
  });
});

describe("withUngroundedNotice — pure helper", () => {
  it("is idempotent (never double-stamps on re-wrap/replay)", () => {
    const once = withUngroundedNotice("bare answer");
    expect(once.startsWith(QUICKSTART_UNGROUNDED_NOTICE)).toBe(true);
    expect(withUngroundedNotice(once)).toBe(once);
  });
});
