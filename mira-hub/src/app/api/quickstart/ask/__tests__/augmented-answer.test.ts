/**
 * The public quickstart ALWAYS answers (2026-09-27): facts from the retrieved
 * manuals are cited [n]; everything else is labeled general guidance. Before
 * this, cite-or-refuse turned every uncovered question into "I don't have
 * manuals for that" — the benchmark's three biggest losses to a plain LLM.
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


const chunk = (i: number): ManualChunk => ({
  content: `chunk ${i}`,
  manufacturer: "AutomationDirect",
  modelNumber: "GS10",
  sourceUrl: `mira://seeds/gs10/${i}`,
  sourcePage: i,
  title: `GS10 ${i}`,
  rank: 1,
  verified: true,
} as ManualChunk);

describe("POST /api/quickstart/ask — answers instead of refusing", () => {
  it("the prompt tells the model to answer with labeled general guidance, not refuse", async () => {
    await POST(req({ question: "How do I wire RS-485 between a Micro820 and a GS10 VFD?" }));
    const messages = cascade.cascadeComplete.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const system = messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("ALWAYS answer");
    expect(system).toContain("General guidance (not from a manual):");
    expect(system).toContain("Answer in the language the technician wrote in");
    expect(system).not.toContain("Cite-or-refuse");
  });

  it("ships only the sources the answer cited, and normalizes provider citation markers", async () => {
    rag.retrieveManualChunks.mockResolvedValue([chunk(1), chunk(2), chunk(3)]);
    cascade.cascadeComplete.mockResolvedValue({
      content: "Baud is 9600 【2†L3-L4】.\n\nGeneral guidance (not from a manual):\n- Use shielded twisted pair.",
      provider: "groq",
    });
    const body = await (await POST(req({ question: "GS10 baud rate?" }))).json();
    expect(body.answer).toContain("9600 [2]");
    expect(body.answer).not.toContain("【");
    expect(body.citations.map((c: { index: number }) => c.index)).toEqual([2]);
  });

  it("a general-guidance-only answer arrives with no source cards", async () => {
    rag.retrieveManualChunks.mockResolvedValue([chunk(1), chunk(2)]);
    cascade.cascadeComplete.mockResolvedValue({
      content: "General guidance (not from a manual):\n- De-energize and verify zero energy first.",
      provider: "groq",
    });
    const body = await (await POST(req({ question: "safety precautions before wiring a VFD to a PLC" }))).json();
    expect(body.citations).toEqual([]);
  });
});
