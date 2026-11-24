/**
 * Question judge unit tests (#5905).
 *
 * Tests the pre-retrieval AI question classifier for Hub notebook chat:
 * - Parse/label handling
 * - Thresholds (unsafe >= 0.75, unclear >= 0.90)
 * - Fail-open on error/timeout
 * - Shadow mode never blocks
 * - Enforcement mode blocks per thresholds
 * - #5905 deterministic warning still fires (not replaced)
 *
 * Run: npx vitest run src/capabilities/__tests__/question-judge.test.ts
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  judgeQuestion,
  questionJudgeEnabled,
  questionJudgeMode,
  shouldBlock,
  unsafeThreshold,
  unclearThreshold,
  judgeTimeoutMs,
  QUESTION_JUDGE_BLANKET_REPLY,
  type QuestionJudgeResult,
} from "../question-judge";
import { unsafePracticeWarning } from "../unsafe-practice-advisory";

describe("config flags", () => {
  beforeEach(() => {
    delete process.env.MIRA_QUESTION_JUDGE_ENABLED;
    delete process.env.MIRA_QUESTION_JUDGE_MODE;
    delete process.env.MIRA_QUESTION_JUDGE_UNSAFE_THRESHOLD;
    delete process.env.MIRA_QUESTION_JUDGE_UNCLEAR_THRESHOLD;
    delete process.env.MIRA_QUESTION_JUDGE_TIMEOUT_MS;
  });

  it("judge is disabled by default", () => {
    expect(questionJudgeEnabled()).toBe(false);
  });

  it("judge is enabled when flag is set", () => {
    process.env.MIRA_QUESTION_JUDGE_ENABLED = "1";
    expect(questionJudgeEnabled()).toBe(true);
  });

  it("mode defaults to shadow", () => {
    expect(questionJudgeMode()).toBe("shadow");
  });

  it("mode can be set to enforce", () => {
    process.env.MIRA_QUESTION_JUDGE_MODE = "enforce";
    expect(questionJudgeMode()).toBe("enforce");
  });

  it("unsafe threshold defaults to 0.75", () => {
    expect(unsafeThreshold()).toBe(0.75);
  });

  it("unsafe threshold can be customized", () => {
    process.env.MIRA_QUESTION_JUDGE_UNSAFE_THRESHOLD = "0.8";
    expect(unsafeThreshold()).toBe(0.8);
  });

  it("unclear threshold defaults to 0.90", () => {
    expect(unclearThreshold()).toBe(0.9);
  });

  it("unclear threshold can be customized", () => {
    process.env.MIRA_QUESTION_JUDGE_UNCLEAR_THRESHOLD = "0.95";
    expect(unclearThreshold()).toBe(0.95);
  });

  it("timeout defaults to 1500ms", () => {
    expect(judgeTimeoutMs()).toBe(1500);
  });

  it("timeout can be customized", () => {
    process.env.MIRA_QUESTION_JUDGE_TIMEOUT_MS = "2000";
    expect(judgeTimeoutMs()).toBe(2000);
  });
});

describe("shouldBlock - shadow mode", () => {
  beforeEach(() => {
    process.env.MIRA_QUESTION_JUDGE_MODE = "shadow";
  });

  afterEach(() => {
    delete process.env.MIRA_QUESTION_JUDGE_MODE;
  });

  it("never blocks in shadow mode regardless of verdict", () => {
    const unsafeResult: QuestionJudgeResult = {
      verdict: "unsafe",
      confidence: 0.95,
      latencyMs: 200,
      model: "gpt-5.4-mini",
      provider: "OpenAI",
      error: null,
    };
    expect(shouldBlock(unsafeResult)).toBe(false);

    const unclearResult: QuestionJudgeResult = {
      verdict: "unclear",
      confidence: 0.95,
      latencyMs: 200,
      model: "gpt-5.4-mini",
      provider: "OpenAI",
      error: null,
    };
    expect(shouldBlock(unclearResult)).toBe(false);
  });
});

describe("shouldBlock - enforcement mode", () => {
  beforeEach(() => {
    process.env.MIRA_QUESTION_JUDGE_MODE = "enforce";
    delete process.env.MIRA_QUESTION_JUDGE_UNSAFE_THRESHOLD;
    delete process.env.MIRA_QUESTION_JUDGE_UNCLEAR_THRESHOLD;
  });

  afterEach(() => {
    delete process.env.MIRA_QUESTION_JUDGE_MODE;
  });

  it("blocks unsafe verdict >= 0.75 confidence", () => {
    const result: QuestionJudgeResult = {
      verdict: "unsafe",
      confidence: 0.75,
      latencyMs: 200,
      model: "gpt-5.4-mini",
      provider: "OpenAI",
      error: null,
    };
    expect(shouldBlock(result)).toBe(true);

    const highConfidence: QuestionJudgeResult = {
      verdict: "unsafe",
      confidence: 0.95,
      latencyMs: 200,
      model: "gpt-5.4-mini",
      provider: "OpenAI",
      error: null,
    };
    expect(shouldBlock(highConfidence)).toBe(true);
  });

  it("does not block unsafe verdict < 0.75 confidence", () => {
    const result: QuestionJudgeResult = {
      verdict: "unsafe",
      confidence: 0.74,
      latencyMs: 200,
      model: "gpt-5.4-mini",
      provider: "OpenAI",
      error: null,
    };
    expect(shouldBlock(result)).toBe(false);
  });

  it("blocks unclear verdict >= 0.90 confidence", () => {
    const result: QuestionJudgeResult = {
      verdict: "unclear",
      confidence: 0.9,
      latencyMs: 200,
      model: "gpt-5.4-mini",
      provider: "OpenAI",
      error: null,
    };
    expect(shouldBlock(result)).toBe(true);

    const highConfidence: QuestionJudgeResult = {
      verdict: "unclear",
      confidence: 0.95,
      latencyMs: 200,
      model: "gpt-5.4-mini",
      provider: "OpenAI",
      error: null,
    };
    expect(shouldBlock(highConfidence)).toBe(true);
  });

  it("does not block unclear verdict < 0.90 confidence", () => {
    const result: QuestionJudgeResult = {
      verdict: "unclear",
      confidence: 0.89,
      latencyMs: 200,
      model: "gpt-5.4-mini",
      provider: "OpenAI",
      error: null,
    };
    expect(shouldBlock(result)).toBe(false);
  });

  it("never blocks clear verdict regardless of confidence", () => {
    const result: QuestionJudgeResult = {
      verdict: "clear",
      confidence: 1.0,
      latencyMs: 200,
      model: "gpt-5.4-mini",
      provider: "OpenAI",
      error: null,
    };
    expect(shouldBlock(result)).toBe(false);
  });
});

describe("fail-open on error", () => {
  beforeEach(() => {
    process.env.MIRA_QUESTION_JUDGE_MODE = "enforce";
  });

  afterEach(() => {
    delete process.env.MIRA_QUESTION_JUDGE_MODE;
  });

  it("never blocks when error is present (fail-open)", () => {
    const errorResult: QuestionJudgeResult = {
      verdict: "unsafe",
      confidence: 0.95,
      latencyMs: 200,
      model: "gpt-5.4-mini",
      provider: "OpenAI",
      error: "timeout",
    };
    expect(shouldBlock(errorResult)).toBe(false);
  });
});

describe("blanket reply text", () => {
  it("is plain and non-technical", () => {
    expect(QUESTION_JUDGE_BLANKET_REPLY).not.toMatch(/LOTO|lockout|tag.?out|energi[sz]ed/i);
  });

  it("asks to rephrase", () => {
    expect(QUESTION_JUDGE_BLANKET_REPLY.toLowerCase()).toMatch(/ask again|rephrase|didn't understand/);
  });
});

describe("coexistence with #5905 deterministic detector", () => {
  it("both judge and #5905 detector can run on the same message", () => {
    const message =
      "ops wipe the touch screen while the line runs and it keeps hitting the conveyor start button lol. can they just tape the edge and leave it on while cleaning";

    const detectorResult = unsafePracticeWarning(message);
    expect(detectorResult).not.toBeNull();
    expect(detectorResult).toContain("Switch the panel off");
  });

  it("judge does not replace or disable the #5905 detector", () => {
    const message = "Can I wipe down the HMI while the machine is running?";

    const detectorResult = unsafePracticeWarning(message);
    expect(detectorResult).not.toBeNull();
  });
});

describe("judgeQuestion - no provider configured", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  it("returns clear verdict with no_provider_configured error", async () => {
    const result = await judgeQuestion("What does fault F004 mean?");
    expect(result.verdict).toBe("clear");
    expect(result.error).toBe("no_provider_configured");
    expect(result.provider).toBeNull();
    expect(result.model).toBeNull();
  });
});

describe("judgeQuestion - with mocked provider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "gpt-5.4-mini";
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    global.fetch = originalFetch;
  });

  it("parses valid JSON response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"{\\"verdict\\":\\"clear\\",\\"confidence\\":0.95}"}}]}\n\n',
              ),
            })
            .mockResolvedValueOnce({ done: true }),
        }),
      },
    });

    const result = await judgeQuestion("What does fault F004 mean?");
    expect(result.verdict).toBe("clear");
    expect(result.confidence).toBe(0.95);
    expect(result.error).toBeNull();
    expect(result.provider).toBe("OpenAI");
  });

  it("returns clear verdict with error on HTTP error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await judgeQuestion("What does fault F004 mean?");
    expect(result.verdict).toBe("clear");
    expect(result.error).toBe("http_500");
  });

  it("returns clear verdict with error on missing JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"no json here"}}]}\n\n'),
            })
            .mockResolvedValueOnce({ done: true }),
        }),
      },
    });

    const result = await judgeQuestion("What does fault F004 mean?");
    expect(result.verdict).toBe("clear");
    expect(result.error).toBe("no_json_in_response");
  });

  it("returns clear verdict with error on invalid verdict", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"{\\"verdict\\":\\"invalid\\",\\"confidence\\":0.95}"}}]}\n\n',
              ),
            })
            .mockResolvedValueOnce({ done: true }),
        }),
      },
    });

    const result = await judgeQuestion("What does fault F004 mean?");
    expect(result.verdict).toBe("clear");
    expect(result.error).toMatch(/invalid_verdict/);
  });
});
