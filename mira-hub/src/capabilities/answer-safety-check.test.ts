/**
 * Semantic safety check (#3793) — selector breadth, verdict parsing, and the
 * fail-closed provider protocol. The judge model itself is NOT under test
 * here (that is the held-out evaluation's job); the protocol around it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseVerdict,
  selectForSemanticCheck,
  semanticCheckEnabled,
  semanticSafetyCheck,
} from "./answer-safety-check";

const ENV = { ...process.env };
beforeEach(() => {
  process.env.GROQ_API_KEY = "k1";
  process.env.CEREBRAS_API_KEY = "k2";
  process.env.TOGETHERAI_API_KEY = "k3";
  delete process.env.NOTEBOOK_SEMANTIC_CHECK;
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe("selector — every supported hazard class fires, not just energized wording", () => {
  const cases: [string, string][] = [
    ["electrical", "Check the breaker panel and verify zero-energy at the disconnect."],
    ["pressure", "The hydraulic accumulator holds pressure after shutdown."],
    ["confined", "The mixing tank atmosphere must be tested before entry."],
    ["lifting", "Use the overhead crane and a rated sling for the die."],
    ["machine-motion", "The light curtain stops the press when interrupted."],
    ["fire-gas", "There may be a gas leak near the burner train."],
    ["height", "Use a harness and fall protection on the mezzanine."],
  ];
  for (const [cls, text] of cases) {
    it(`selects ${cls}`, () => {
      expect(selectForSemanticCheck(text, "What should I check next?")).toBe(cls);
    });
  }

  it("selects thermal wording (iteration-8 F1)", () => {
    expect(
      selectForSemanticCheck("Touch the 200°C steam pipe with your bare hand to feel whether steam is flowing.", "q"),
    ).not.toBeNull();
  });

  it("selects chemical wording (iteration-8 F1)", () => {
    expect(
      selectForSemanticCheck("Pour the caustic soda into an open bucket and lean over it while mixing.", "q"),
    ).not.toBeNull();
  });

  it("selects ordinary machine-motion / body-contact wording (iteration-8 F1)", () => {
    expect(
      selectForSemanticCheck("Reach into the operating press and pull the obstruction out by hand.", "q"),
    ).not.toBeNull();
  });

  it("selects from the QUESTION even when the answer is generic", () => {
    expect(selectForSemanticCheck("Check the basics first.", "Can I enter the storage silo?")).toBe("confined");
  });

  it("classifies hazard-free conversation as null — telemetry only; the route judges EVERY served answer regardless (iteration-9)", () => {
    expect(
      selectForSemanticCheck(
        "A VFD controls motor speed by varying output frequency.",
        "How does a VFD control speed?",
      ),
    ).toBeNull();
  });
});

describe("verdict parsing — strict, bounded, malformed is null", () => {
  it("parses a strict verdict object", () => {
    expect(parseVerdict('{"verdict":"unsafe","hazard_class":"pressure","reason":"instructs venting under pressure"}')).toEqual({
      verdict: "unsafe",
      hazardClass: "pressure",
      reason: "instructs venting under pressure",
    });
  });

  it("parses a verdict embedded in prose", () => {
    expect(parseVerdict('Here is my judgment: {"verdict":"safe","hazard_class":"none","reason":"educational"} Done.')?.verdict).toBe(
      "safe",
    );
  });

  it("rejects a self-declared unknown, missing verdict, and non-JSON", () => {
    expect(parseVerdict('{"verdict":"unknown"}')).toBeNull();
    expect(parseVerdict('{"reason":"no verdict"}')).toBeNull();
    expect(parseVerdict("SAFE")).toBeNull();
    expect(parseVerdict(undefined)).toBeNull();
  });
});

describe("provider protocol — fail-closed, falls through, never invents a verdict", () => {
  const judgeResponse = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  it("returns the first provider's valid verdict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => judgeResponse('{"verdict":"unsafe","hazard_class":"pressure","reason":"x"}')),
    );
    const v = await semanticSafetyCheck({ question: "q", answerText: "a", general: false, selectedClass: "pressure" });
    expect(v.verdict).toBe("unsafe");
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
  });

  it("falls through a malformed verdict to the next provider", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(judgeResponse("I think it is fine."))
      .mockResolvedValueOnce(judgeResponse('{"verdict":"safe","hazard_class":"pressure","reason":"prohibition"}'));
    vi.stubGlobal("fetch", fetchMock);
    const v = await semanticSafetyCheck({ question: "q", answerText: "a", general: false, selectedClass: "pressure" });
    expect(v.verdict).toBe("safe");
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("returns unknown when every provider fails — never a default of safe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream error", { status: 500 })));
    const v = await semanticSafetyCheck({ question: "q", answerText: "a", general: false, selectedClass: "electrical" });
    expect(v.verdict).toBe("unknown");
    expect(v.hazardClass).toBe("electrical");
    expect(v.reason).toMatch(/^no_provider_verdict\b/);
  });

  // #4022: a withheld answer must say WHY every provider failed, or a red
  // beta-gate / a technician complaint cannot be diagnosed after the fact.
  it("names each provider's failure in the unknown reason (#4022)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(judgeResponse("I think it is fine."))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const v = await semanticSafetyCheck({ question: "q", answerText: "a", general: false, selectedClass: "unclassified" });
    expect(v.verdict).toBe("unknown");
    expect(v.reason).toMatch(/^no_provider_verdict \[/);
    expect(v.reason).toContain("=http_429");
    expect(v.reason).toContain("=malformed");
    expect(v.reason).toContain("=error");
  });

  // #4022 root cause: gpt-oss-120b spends ~200-280 completion tokens reasoning
  // before the JSON verdict. At max_tokens 200, 5 of 8 real judge calls came
  // back finish_reason=length with EMPTY content -> malformed -> every provider
  // "failed" -> a correct grounded answer withheld behind LOTO boilerplate.
  it("gives the reasoning judge enough budget to reach its verdict (#4022)", async () => {
    const fetchMock = vi.fn(async () => judgeResponse('{"verdict":"safe","hazard_class":"x","reason":"y"}'));
    vi.stubGlobal("fetch", fetchMock);
    await semanticSafetyCheck({ question: "q", answerText: "a", general: false, selectedClass: "unclassified" });
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.max_tokens).toBeGreaterThanOrEqual(1024);
  });

  it("names a truncated (finish_reason=length) empty verdict as truncated, not malformed (#4022)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }), { status: 200 })),
    );
    const v = await semanticSafetyCheck({ question: "q", answerText: "a", general: false, selectedClass: "unclassified" });
    expect(v.verdict).toBe("unknown");
    expect(v.reason).toContain("=truncated");
  });

  it("returns unknown on timeout (abort) across providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init: { signal?: AbortSignal }) =>
          new Promise<Response>((_res, rej) => {
            init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const v = await semanticSafetyCheck({
      question: "q",
      answerText: "a",
      general: false,
      selectedClass: "electrical",
      timeoutMs: 30,
    });
    expect(v.verdict).toBe("unknown");
    expect(v.reason).toContain("=timeout");
  });

  it("returns unknown with no configured providers", async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.TOGETHERAI_API_KEY;
    const v = await semanticSafetyCheck({ question: "q", answerText: "a", general: true, selectedClass: "fire-gas" });
    expect(v.verdict).toBe("unknown");
  });
});

describe("kill switch", () => {
  it("NOTEBOOK_SEMANTIC_CHECK=0 disables the layer; default is on", () => {
    expect(semanticCheckEnabled()).toBe(true);
    process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
    expect(semanticCheckEnabled()).toBe(false);
  });
});
