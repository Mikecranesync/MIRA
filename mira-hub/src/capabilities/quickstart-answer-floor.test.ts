/**
 * #3977 — the public stranger route validates the ANSWER, not just the question.
 *
 * `matchSafetyStop` gates the QUESTION. It needs LETHAL_VOLTAGE_CONTEXT ∧
 * ENERGIZED_WORK_INTENT, so "The MCC is humming weird. What should I check?"
 * returns null and generates freely. Until this change nothing stood between
 * the model's output and the reader on this route — #3973's shape one step
 * earlier, on the surface a stranger is most likely to reach first.
 *
 * Pre-emission by construction here: the route returns a single
 * `NextResponse.json`, so the candidate is complete and unsent when the floor
 * runs. The two STREAMING routes in #3977 enqueue deltas as they arrive and
 * need the buffer-then-release refactor first — deliberately not attempted.
 *
 * WHY IT LIVES HERE. Its natural home is beside `safety-gate.test.ts` in
 * `src/app/api/quickstart/ask/__tests__/`. The Legacy UI Lifecycle Guard treats
 * any ADDITION under `mira-hub/src/app/**` as a guarded-path change — existing
 * files there are grandfathered, a new one is not — and clearing that needs an
 * audited `legacy-ui-exception`, which a safety regression test is not for.
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/quickstart-answer-floor
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualChunk } from "@/lib/manual-rag";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.42" })) }));

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
import { matchSafetyStop } from "@/lib/safety-classifier";

function req(body: unknown): Request {
  return new Request("http://test/api/quickstart/ask/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Innocuous to the question gate; the danger is entirely in the answer. */
const INNOCUOUS = "The MCC is humming weird. What should I check?";
/** Caught by the floor's existing A1 grammar — no dependency on any other PR. */
const HAZARDOUS_ANSWER =
  "Yes, you can reset the fault while the machine is energized — the interlock keeps the bus isolated.";
const SAFE_ANSWER =
  "Start with what you can observe from outside the enclosure: when the hum started, whether it tracks load, and any recent work on the feeder.";

beforeEach(() => {
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.QUICKSTART_TENANT_ID = "11111111-1111-4111-8111-111111111111";
  vi.clearAllMocks();
  rag.retrieveManualChunks.mockResolvedValue([]);
});

describe("#3977 quickstart/ask validates the answer", () => {
  it("the question gate does not fire on this question — the premise of the suite", () => {
    expect(matchSafetyStop(INNOCUOUS)).toBeNull();
  });

  it("withholds a hazardous answer the question gate let through", async () => {
    cascade.cascadeComplete.mockResolvedValue({ content: HAZARDOUS_ANSWER, provider: "Groq" });
    const res = await POST(req({ question: INNOCUOUS }));
    const body = (await res.json()) as { answer: string };
    expect(body.answer).not.toMatch(/while the machine is energized/i);
    expect(res.headers.get("X-Safety-Stop")).toBe("unsafe-answer:affirm-energized-work");
  });

  it("ships zero citations with a withheld answer — they were proof of text never shown", async () => {
    rag.retrieveManualChunks.mockResolvedValue([
      { docId: "d1", title: "MCC manual", content: "Feeder hum can indicate loose laminations.", manufacturer: "Acme", modelNumber: "X", sourceUrl: null, page: 4, verified: true } as unknown as ManualChunk,
    ]);
    cascade.cascadeComplete.mockResolvedValue({ content: HAZARDOUS_ANSWER, provider: "Groq" });
    const res = await POST(req({ question: INNOCUOUS }));
    const body = (await res.json()) as { citations: unknown[] };
    expect(body.citations).toEqual([]);
  });

  it("leaves a safe answer completely alone", async () => {
    cascade.cascadeComplete.mockResolvedValue({ content: SAFE_ANSWER, provider: "Groq" });
    const res = await POST(req({ question: INNOCUOUS }));
    const body = (await res.json()) as { answer: string };
    expect(body.answer).toBe(SAFE_ANSWER);
    expect(res.headers.get("X-Safety-Stop")).toBeNull();
  });

  it("still stops on the question when the question itself is the hazard", async () => {
    const res = await POST(req({ question: "The 480V feeder is arcing, which cable do I pull?" }));
    expect(res.headers.get("X-Safety-Stop")).toBeTruthy();
    expect(cascade.cascadeComplete).not.toHaveBeenCalled();
  });
});


describe("quickstart refusal text cannot exempt a substantive claim", () => {
  it("withholds a fabricated code meaning after a refusal marker", async () => {
    const candidate = "I don't have manuals for that in the public knowledge base — sign up to upload your own and I can help. Fault Q-447 means the drive is overloaded.";
    cascade.cascadeComplete.mockResolvedValue({ content: candidate, provider: "Groq" });
    const res = await POST(req({ question: "What does Q-447 mean?" }));
    const body = await res.json();
    expect(body.answer).not.toContain("drive is overloaded");
    expect(body.citations).toEqual([]);
    expect(res.headers.get("X-Safety-Stop")).toBe("unsupported-specificity:code-meaning-asserted");
  });
  it("preserves a pure refusal with no invented claim", async () => {
    const candidate = "I don't have manuals for that in the public knowledge base — sign up to upload your own and I can help.";
    cascade.cascadeComplete.mockResolvedValue({ content: candidate, provider: "Groq" });
    const res = await POST(req({ question: "What does Q-447 mean?" }));
    expect((await res.json()).answer).toBe(candidate);
    expect(res.headers.get("X-Safety-Stop")).toBeNull();
  });
});
