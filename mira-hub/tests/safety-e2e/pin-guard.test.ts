/**
 * Generator-pin guard of the e2e safety driver (#4372), proved end to end with
 * the zero-network OpenAI stub (stub-openai.setup.ts): no key, no network.
 *
 * Each case runs the REAL driver (run.e2e.ts) in a child vitest with the stub
 * reporting a chosen served `model`, then reads run.summary.json and
 * generations.jsonl. Run:
 *   npx vitest run --config tests/safety-e2e/vitest.guards.config.ts
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HUB = path.resolve(__dirname, "../..");
const CASES = [1, 2, 3].map((i) => ({ id: `syn-${i}`, question: `synthetic question ${i}`, bound_machine: null, sources: [] }));

type Run = { summary: { aborted: string | null; meter: { calls: number } }; rows: Array<Record<string, unknown>>; calls: number };

function drive(served: string, extra: Record<string, string> = {}, pin = "gpt-5.4-mini"): Run {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pin-guard-"));
  const cases = path.join(dir, "cases.jsonl");
  writeFileSync(cases, CASES.map((c) => JSON.stringify(c)).join("\n") + "\n");
  const out = path.join(dir, "out");
  const log = path.join(dir, "stub.log");
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
  Object.assign(env, {
    SAFETY_E2E_QUIET: "1",
    SAFETY_E2E_MODE: "openai",
    OPENAI_API_KEY: "sk-stub-not-a-key",
    OPENAI_MODEL: pin,
    SAFETY_E2E_BUDGET_USD: "5",
    SAFETY_E2E_CASES: cases,
    SAFETY_E2E_OUT: out,
    STUB_LOG: log,
    STUB_SERVED_MODEL: served,
    STUB_PROMPT_TOKENS: "100",
    STUB_COMPLETION_TOKENS: "10",
    ...extra,
  });
  spawnSync("npx", ["vitest", "run", "--config", "tests/safety-e2e/vitest.stub-openai.config.ts"], {
    cwd: HUB,
    env,
    encoding: "utf8",
    timeout: 240_000,
  });
  const summary = JSON.parse(readFileSync(path.join(out, "run.summary.json"), "utf8"));
  const rows = readFileSync(path.join(out, "generations.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
  return { summary, rows, calls };
}

describe("generator pin: served model must match the pinned generator", () => {
  it("a served dated snapshot that is NOT allowlisted aborts after the first case and is recorded", () => {
    const r = drive("gpt-5.4-mini-2026-03-17");
    expect(r.summary.aborted ?? "").toMatch(/^pin:/);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].pin_check).toMatchObject({ ok: false });
  }, 300_000);

  it("a different served model aborts after the first case", () => {
    const r = drive("gpt-5.5");
    expect(r.summary.aborted ?? "").toMatch(/^pin:/);
    expect(r.rows).toHaveLength(1);
  }, 300_000);

  it("control: the pinned model served verbatim runs every case", () => {
    const r = drive("gpt-5.4-mini");
    expect(r.summary.aborted).toBeNull();
    expect(r.rows).toHaveLength(3);
  }, 300_000);

  it("control: canonicalization accepts a provider prefix and case (OPENAI/GPT-5.4-mini)", () => {
    const r = drive("openai/GPT-5.4-mini");
    expect(r.summary.aborted).toBeNull();
    expect(r.rows).toHaveLength(3);
  }, 300_000);

  it("control: a dated snapshot EXPLICITLY listed in the pin config is accepted", () => {
    const r = drive("gpt-5.4-mini-2026-03-17", { SAFETY_E2E_PIN_SNAPSHOTS: "gpt-5.4-mini-2026-03-17" });
    expect(r.summary.aborted).toBeNull();
    expect(r.rows).toHaveLength(3);
  }, 300_000);
});
