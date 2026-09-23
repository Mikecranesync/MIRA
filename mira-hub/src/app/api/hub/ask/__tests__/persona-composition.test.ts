/**
 * What `/api/hub/ask` actually sends as its system message, under both flag states.
 *
 * WHY THIS FILE EXISTS: `hybrid-corpus.test.ts` never inspects the system message, so
 * it passes identically with `MIRA_PERSONA_CONTRACT` on or off. That makes "the hub
 * suite is green flag-on" evidence that the tests don't look at the prompt — not
 * evidence that the persona migration preserved behaviour. This looks.
 *
 * Spec: `docs/specs/mira-intelligence-contract.md`
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildMiraSystemPrompt, MIRA_AUGMENTED, MIRA_CORE } from "@/lib/mira-contract";

const ORIGINAL = process.env.MIRA_PERSONA_CONTRACT;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MIRA_PERSONA_CONTRACT;
  else process.env.MIRA_PERSONA_CONTRACT = ORIGINAL;
  vi.resetModules();
});
beforeEach(() => vi.resetModules());

/** Capture the system message the route hands the cascade. */
async function systemMessageFrom(flag: "1" | undefined): Promise<string> {
  // Reset HERE, not only in beforeEach: a test that calls this twice would
  // otherwise reuse the module imported on the first call, and the second
  // doMock would never apply — returning "" and silently comparing nothing.
  vi.resetModules();
  if (flag) process.env.MIRA_PERSONA_CONTRACT = flag;
  else delete process.env.MIRA_PERSONA_CONTRACT;

  let captured = "";
  vi.doMock("@/lib/llm/cascade", () => ({
    cascadeComplete: vi.fn(async (msgs: Array<{ role: string; content: string }>) => {
      captured = msgs.find((m) => m.role === "system")?.content ?? "";
      return { provider: "Groq", content: "ok", durationMs: 1 };
    }),
  }));
  vi.doMock("@/lib/session", () => ({
    sessionOr401: vi.fn(async () => ({ tenantId: "t-1", userId: "u-1" })),
  }));
  vi.doMock("@/lib/db", () => ({
    default: {
      query: vi.fn(async () => ({ rows: [] })),
      connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
    },
  }));
  // Spread the real module — only retrieval is stubbed. Replacing it wholesale
  // removed buildGroundedContext and broke the route before the prompt was built.
  vi.doMock("@/lib/manual-rag", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/manual-rag")>()),
    retrieveManualChunks: vi.fn(async () => []),
  }));
  vi.doMock("@/lib/ip-rate-limit", () => ({
    clientIpHash: vi.fn(async () => "iphash"),
    rateLimited: vi.fn(() => false),
  }));

  process.env.NEON_DATABASE_URL ??= "postgres://stub";
  const { POST } = await import("../route");
  await POST(new Request("http://localhost/api/hub/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "How does a VFD derate at low speed?" }),
  }));
  return captured;
}

describe("/api/hub/ask — system message composition", () => {
  it("flag OFF sends the legacy prompt, not the contract", async () => {
    const sys = await systemMessageFrom(undefined);
    expect(sys).toContain("You are MIRA, a maintenance intelligence assistant");
    expect(sys).not.toContain(MIRA_CORE);
  });

  it("flag ON sends the contract in augmented mode with the scope extension", async () => {
    const sys = await systemMessageFrom("1");
    expect(sys).toBe(
      buildMiraSystemPrompt(
        "augmented",
        [
          "SCOPE — you are answering a signed-in maintenance technician asking a GENERAL",
          "question, one not yet bound to a specific machine in their namespace.",
          "- NEVER claim to know which machine they are standing at. You have no",
          "  confirmed asset context here. If the answer would differ by machine,",
          "  say which detail you would need.",
        ].join("\n"),
      ),
    );
  });

  it("the two flag states genuinely differ — this test can tell them apart", async () => {
    // Guards against the failure mode that motivated this file: a test that
    // passes under both flags because it never looks at what changed.
    const off = await systemMessageFrom(undefined);
    const on = await systemMessageFrom("1");
    expect(off).not.toBe(on);
    expect(off.length).toBeGreaterThan(0);
    expect(on.length).toBeGreaterThan(0);
  });

  it("flag ON preserves every behavioural rule the legacy prompt carried", async () => {
    // The migration split one prompt into MIRA_AUGMENTED + SCOPE_EXTENSION. No
    // rule may be lost in the split.
    const on = await systemMessageFrom("1");
    expect(on).toContain("never a refusal");            // answer-anyway
    expect(on).toContain("give the general answer anyway");
    expect(on).toContain("Do NOT invent machine-specific facts");
    expect(on).toContain("NEVER claim to know which machine they are standing at");
    expect(on).toContain("the next most likely alternatives");
    // The 4-8 bullet QUOTA was deliberately removed (goal item 3: no mandatory
    // template). Brevity survives as a preference, not a count.
    expect(on).not.toContain("4-8 short bullets max");
    expect(on).toContain("let the question set the shape, not a bullet quota");
  });

  it("no rule is stated twice — a duplicated instruction contradicts itself later", async () => {
    const on = await systemMessageFrom("1");
    for (const rule of ["let the question set the shape", "NEVER claim to know which machine"]) {
      expect(on.split(rule).length - 1, `"${rule}" appears more than once`).toBe(1);
    }
  });

  it("augmented mode is the mode chosen — not grounded, not general", async () => {
    const on = await systemMessageFrom("1");
    expect(on).toContain(MIRA_AUGMENTED);
  });
});
