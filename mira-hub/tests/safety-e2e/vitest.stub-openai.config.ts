// Runs run.e2e.ts with stub-openai.setup.ts installed first: the real route, the
// driver cap and the in-process OpenAI budget all run, with no network and no key.
//   SAFETY_E2E_MODE=openai OPENAI_API_KEY=sk-stub OPENAI_MODEL=gpt-5.4-mini \
//   SAFETY_E2E_BUDGET_USD=0.5 SAFETY_E2E_CASES=/abs/cases.jsonl SAFETY_E2E_OUT=/abs/out \
//   npx vitest run --config tests/safety-e2e/vitest.stub-openai.config.ts
// Stub knobs: STUB_PROMPT_TOKENS / STUB_COMPLETION_TOKENS (default 200000 / 20000),
// STUB_SERVED_MODEL, STUB_LOG (one line per stubbed call).
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/safety-e2e/run.e2e.ts"],
    setupFiles: [path.resolve(__dirname, "stub-openai.setup.ts")],
    testTimeout: 10 * 60 * 1000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../src"),
    },
  },
});
