/**
 * Every canonical-cascade consumer speaks the provider's request dialect — offline contract.
 *
 * Codex F1 on #4349: the registry declared `requestStyle: "openai-reasoning"` for
 * OpenAI, but four consumers borrowed only the provider LIST and still sent
 * `max_tokens` + a non-default `temperature` inline. With OpenAI first and Groq /
 * Together down, asset chat, namespace chat, report generation and the semantic
 * safety judge would 400 on the one funded provider and exhaust the cascade.
 *
 * Two layers, both offline:
 *  1. `requestDialectFields()` is the ONE place the cap/temperature fields are
 *     shaped (gpt-5: `max_completion_tokens`, no `temperature`; compat: both).
 *  2. The consumer files are pinned by source: each must call the helper and may
 *     not carry an inline `max_tokens:` literal. A new consumer that copies the
 *     old pattern fails here before it fails in production.
 *
 * Run: npx vitest run src/capabilities/__tests__/cascade-dialect-consumers.test.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRequestBody,
  canonicalProviders,
  requestDialectFields,
} from "@/lib/inference/canonical-cascade";

const ENV = { ...process.env };
beforeEach(() => {
  process.env.OPENAI_API_KEY = "k0";
  process.env.GROQ_API_KEY = "k1";
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.TOGETHERAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
});
afterEach(() => {
  process.env = { ...ENV };
});

const HUB = resolve(__dirname, "..", "..");
/** Every registry consumer that builds its own request body (not via buildRequestBody). */
const CONSUMERS = [
  "app/api/assets/[id]/chat/route.ts",
  "app/api/namespace/node/[id]/chat/route.ts",
  "app/api/reports/generate/route.ts",
  "capabilities/answer-safety-check.ts",
];

describe("requestDialectFields — the single cap/temperature shaper", () => {
  it("gpt-5 dialect: max_completion_tokens, no temperature, provider extras ride along", () => {
    const [openai] = canonicalProviders();
    expect(openai.name).toBe("OpenAI");
    const f = requestDialectFields(openai, 800, 0.3);
    expect(f).toMatchObject({ max_completion_tokens: 800, reasoning_effort: "low" });
    expect(f).not.toHaveProperty("max_tokens");
    expect(f).not.toHaveProperty("temperature");
  });

  it("compat dialect keeps max_tokens + the caller's temperature and adds nothing else", () => {
    const [, groq] = canonicalProviders();
    expect(groq.name).toBe("Groq");
    expect(requestDialectFields(groq, 500, 0.4)).toEqual({ max_tokens: 500, temperature: 0.4 });
  });

  it("buildRequestBody is byte-stable: same fields as before the helper existed", () => {
    const [openai, groq] = canonicalProviders();
    const o = buildRequestBody(openai, [{ role: "user", content: "hi" }], 500);
    expect(o).toEqual({
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 500,
      reasoning_effort: "low",
    });
    const g = buildRequestBody(groq, [{ role: "user", content: "hi" }], 500);
    expect(g).toEqual({
      model: groq.model,
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 500,
      temperature: 0.3,
      reasoning_effort: "low",
    });
  });
});

describe("every registry consumer uses the shaper (source contract)", () => {
  for (const rel of CONSUMERS) {
    it(`${rel} calls requestDialectFields and has no inline max_tokens literal`, () => {
      const src = readFileSync(resolve(HUB, rel), "utf8");
      expect(src).toMatch(/requestDialectFields\(/);
      // The literal `max_tokens:` is the exact shape OpenAI's gpt-5 family rejects.
      expect(src).not.toMatch(/^\s*max_tokens\s*:/m);
    });
  }

  it("control: a consumer that still inlines the old shape would fail the literal check", () => {
    const stale = "body: JSON.stringify({\n  model: p.model,\n  max_tokens: 800,\n  temperature: 0.3,\n})";
    expect(stale).toMatch(/^\s*max_tokens\s*:/m);
  });
});
