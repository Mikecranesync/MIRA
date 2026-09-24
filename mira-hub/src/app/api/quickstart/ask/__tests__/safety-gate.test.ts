/**
 * #3876 — the public stranger route must hard-stop on a safety-keyword match
 * BEFORE retrieval and before the provider call, exactly as the asset, node,
 * notebook and hub/ask chat routes do (security-boundaries.md). The classifier's
 * educational carve-out keeps the questions this route exists for answering.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualChunk } from "@/lib/manual-rag";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.9" })) }));

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

beforeEach(() => {
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.QUICKSTART_TENANT_ID = "11111111-1111-4111-8111-111111111111";
  vi.clearAllMocks();
  rag.retrieveManualChunks.mockResolvedValue([]);
  cascade.cascadeComplete.mockResolvedValue({ content: "answer", provider: "groq" });
});

describe("POST /api/quickstart/ask — safety hard-stop (#3876)", () => {
  it("a hazard report stops before retrieval and the provider — SAFETY_STOP body, X-Safety-Stop header", async () => {
    const res = await POST(req({ question: "Is it safe to work on this live panel with the cover off?" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Safety-Stop")).toBeTruthy();
    const body = await res.json();
    expect(body.answer).toContain("SAFETY STOP");
    expect(body.citations).toEqual([]);
    expect(rag.retrieveManualChunks).not.toHaveBeenCalled();
    expect(cascade.cascadeComplete).not.toHaveBeenCalled();
  });

  it("an educational safety question still answers (classifier carve-out): 'What is LOTO and when is it required'", async () => {
    cascade.cascadeComplete.mockResolvedValue({ content: "Lockout/tagout is…", provider: "groq" });
    const res = await POST(req({ question: "What is LOTO and when is it required" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Safety-Stop")).toBeNull();
    expect(cascade.cascadeComplete).toHaveBeenCalledTimes(1);
    expect((await res.json()).answer).toBe("Lockout/tagout is…");
  });

  it("the ordinary stranger question is unchanged: retrieval then provider", async () => {
    const res = await POST(req({ question: "What does fault F004 mean on a PowerFlex 525" }));
    expect(res.status).toBe(200);
    expect(rag.retrieveManualChunks).toHaveBeenCalledTimes(1);
    expect(cascade.cascadeComplete).toHaveBeenCalledTimes(1);
  });
});
