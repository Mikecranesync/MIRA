/**
 * Stranger Walk plumbing (#4460): the staging-only guard, the paid-inference
 * budget, the deploy identity, the corpus PDFs, and tenant teardown.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Manual } from "./score";

/** The ONLY base this walk may touch (same guard as retrieval-acceptance.yml). */
export const STAGING = "https://app-staging.factorylm.com";

export function stagingBase(): string {
  const base = (process.env.STRANGER_WALK_BASE ?? STAGING).replace(/\/+$/, "");
  if (base !== STAGING) throw new Error(`stranger walk runs against staging only (got ${base})`);
  return base;
}

/**
 * Hard $ budget, declared up front (zero-token rule: paid inference here is validation, never
 * debugging). Every dispatched turn BOOKS its worst case — every call it could cause, at the repo's
 * own declared prices — before it is sent, and a turn is dispatched only if that booking still fits
 * the budget. Nothing is released afterwards, because some calls (a timed-out attempt the Hub
 * retried on the next provider, the safety judge) never reach the client's stream. So the recorded
 * spend is an upper bound on the true spend, and it can never pass the budget.
 *
 * Worst case of one turn, from production constants:
 *  - answer: every cascade provider may attempt it in full — ≤ TURN_BOUND.inputTokens in and
 *    ≤ 1400 out (`requestCap` in api/equipment-notebooks/[id]/chat/route.ts);
 *  - safety judge: every provider may attempt it — same input bound, ≤ 200 out
 *    (`max_completion_tokens 200`, src/capabilities/answer-safety-check.ts).
 * Input bound: static system prompt + ≤ 6 chunks of ≤ 1200 chars (`manual-rag.ts`) + no history
 * (every question is a fresh chat) — ~3k tokens observed; 16k declared.
 * Prices ($/Mtok): gpt-5.4-mini from tools/review_router/prices.json; the rest from
 * `PRICE_PER_MTOK` in src/lib/inference/canonical-cascade.ts (Cerebras included though archived).
 *
 * FAILS CLOSED: a turn whose final usage is unreadable or breaks the declared bound stops every
 * later paid turn — the booking assumed a bound that no longer holds.
 */
export const PROVIDER_PRICES: Record<string, { input: number; output: number }> = {
  OpenAI: { input: 0.75, output: 4.5 },
  OpenRouter: { input: 0.2, output: 0.52 },
  Groq: { input: 0.15, output: 0.75 },
  Cerebras: { input: 0.1, output: 0.6 },
  Together: { input: 0.88, output: 0.88 },
};
export const TURN_BOUND = { inputTokens: 16_000, answerOutputTokens: 1_400, judgeOutputTokens: 200 };

/** Model env vars the cascade honours (canonical-cascade.ts). The table above prices only the
 *  defaults, so ANY override means an unpriced model: the walk refuses to start. */
const MODEL_OVERRIDES = ["OPENAI_MODEL", "OPENROUTER_MODEL", "GROQ_MODEL", "CEREBRAS_MODEL", "TOGETHER_MODEL"];

/**
 * The prices the deployed Hub bills against, read from the SAME env the Hub reads (the walk runs
 * under `doppler run --config stg`): OPENAI_PRICE_PER_MTOK_IN/OUT override gpt-5.4-mini's declared
 * rate exactly as `openai-run-budget.ts` does. Fails closed — throws before any paid request — on
 * an invalid price or a model override this table cannot price.
 */
export function pricesFromEnv(env: Record<string, string | undefined> = process.env): Record<string, { input: number; output: number }> {
  const overridden = MODEL_OVERRIDES.filter((k) => (env[k] ?? "").trim() !== "");
  if (overridden.length) throw new Error(`unpriced model override(s): ${overridden.join(", ")} — refusing to spend`);
  const rate = (k: string, fallback: number) => {
    const raw = env[k];
    if (raw === undefined || raw.trim() === "") return fallback;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) throw new Error(`${k}=${raw} is not a valid price — refusing to spend`);
    return v;
  };
  return {
    ...PROVIDER_PRICES,
    OpenAI: { input: rate("OPENAI_PRICE_PER_MTOK_IN", PROVIDER_PRICES.OpenAI.input), output: rate("OPENAI_PRICE_PER_MTOK_OUT", PROVIDER_PRICES.OpenAI.output) },
  };
}

/** $ upper bound of one turn: the answer and the judge, each attempted on every provider. */
export function worstCaseTurnUsd(prices = PROVIDER_PRICES, b = TURN_BOUND): number {
  let usd = 0;
  for (const p of Object.values(prices)) {
    usd += (b.inputTokens * p.input + b.answerOutputTokens * p.output) / 1e6; // answer attempt
    usd += (b.inputTokens * p.input + b.judgeOutputTokens * p.output) / 1e6; // judge attempt
  }
  return usd;
}

export const BUDGET = {
  /** 50 questions × the booked worst case, rounded up. Real spend is a small fraction (≈ $0.2). */
  usdPerRun: Number(process.env.STRANGER_WALK_BUDGET_USD ?? "4.50"),
  usdBookedPerTurn: worstCaseTurnUsd(),
};

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Did the turn's visible usage stay inside the bound the booking assumed? `readable: false` = no
 *  response, no usage frame, or null / negative / non-finite counts. */
export function turnUsage(sse: string | null): { readable: boolean; inBound: boolean; inputTokens: number; outputTokens: number } {
  let frames = 0, input = 0, output = 0;
  for (const line of (sse ?? "").split("\n")) {
    if (!line.startsWith("data: ")) continue;
    let f: Record<string, unknown>;
    try { f = JSON.parse(line.slice(6)); } catch { continue; }
    if (f?.kind !== "usage") continue;
    const i = count(f.inputTokens), c = count(f.cachedInputTokens ?? 0), o = count(f.outputTokens);
    if (i === null || c === null || o === null) return { readable: false, inBound: false, inputTokens: 0, outputTokens: 0 };
    input = Math.max(input, i); output = Math.max(output, o); frames++;
  }
  if (!frames) return { readable: false, inBound: false, inputTokens: 0, outputTokens: 0 };
  return { readable: true, inBound: input <= TURN_BOUND.inputTokens && output <= TURN_BOUND.answerOutputTokens, inputTokens: input, outputTokens: output };
}

export class BudgetMeter {
  /** Booked (upper-bound) spend: turns × the worst case, never less than true spend. */
  booked = 0;
  turns = 0;
  /** Set by the first turn whose usage was unreadable or out of bound; nothing paid follows it. */
  unbounded: string | null = null;
  constructor(readonly budget = BUDGET.usdPerRun, readonly perTurn = BUDGET.usdBookedPerTurn) {}
  /** May the next paid turn go out? Only if its worst case still fits. */
  canAfford(): boolean { return this.unbounded === null && this.booked + this.perTurn <= this.budget + 1e-9; }
  /** Book a turn at dispatch — before the request leaves, so no later failure can skip it. */
  book(): void { this.booked += this.perTurn; this.turns++; }
  /** Check what the turn's stream showed against the bound the booking assumed. */
  verify(id: string, sse: string | null): void {
    const u = turnUsage(sse);
    if (!u.readable || !u.inBound) this.unbounded ??= id;
  }
}

/**
 * Fallback teardown when the register response could not be read: find the throwaway account by its
 * exact, run-unique email on STAGING. null ONLY when a successful query found no account; throws when
 * the lookup cannot run. Refuses anything but a strangerwalk email.
 */
export async function tenantIdForEmail(email: string): Promise<string | null> {
  if (!/^strangerwalk-[a-z0-9-]+@factorylm\.com$/.test(email)) throw new Error(`refusing a non-walk email: ${email}`);
  // No database is not proof of no tenant: fail, so the caller cannot report a clean teardown.
  if (!process.env.NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL unset — cannot prove the run's tenant is gone");
  const { Client } = await import("pg");
  const c = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r = await c.query("SELECT tenant_id::text AS t FROM hub_users WHERE email = $1", [email]);
    return r.rows[0]?.t ?? null;
  } finally {
    await c.end();
  }
}

export type Identity = { gitSha: string; builtAt: string };

export async function identity(base: string): Promise<Identity> {
  const res = await fetch(`${base}/api/health/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`health ${res.status}`);
  const body = (await res.json()) as { gitSha?: string; builtAt?: string };
  if (!/^[0-9a-f]{40}$/.test(body.gitSha ?? "")) throw new Error(`health reported no 40-char gitSha (${body.gitSha})`);
  return { gitSha: body.gitSha!, builtAt: body.builtAt ?? "" };
}

/** Fetch (or reuse from cache) one corpus PDF; null + reason when the bytes are not the frozen ones. */
export async function manualBytes(m: Manual, cacheDir: string): Promise<{ bytes: Buffer | null; problem: string | null }> {
  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${m.sha256}.pdf`);
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  if (existsSync(file) && sha(readFileSync(file)) === m.sha256) return { bytes: readFileSync(file), problem: null };
  try {
    const res = await fetch(m.url, { headers: { "user-agent": "Mozilla/5.0 (FactoryLM stranger-walk)" } });
    if (!res.ok) return { bytes: null, problem: `manual download ${res.status}` };
    const b = Buffer.from(await res.arrayBuffer());
    const got = sha(b);
    if (got !== m.sha256) return { bytes: null, problem: `manual sha256 mismatch (got ${got.slice(0, 12)}…)` };
    writeFileSync(file, b);
    return { bytes: b, problem: null };
  } catch (e) {
    return { bytes: null, problem: `manual download failed: ${(e as Error).message}` };
  }
}

/**
 * Delete the throwaway tenant through the beta gate's provisioner sweep, which
 * verifies the auth + data rows are gone. Needs NEON_DATABASE_URL (staging;
 * the walk is run under `doppler run --config stg`). Never throws: teardown runs
 * on every exit path and reports instead.
 */
export function teardownTenant(tenantId: string): { ok: boolean; detail: string } {
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) return { ok: false, detail: `refusing to sweep a non-uuid tenant id: ${tenantId}` };
  if (!process.env.NEON_DATABASE_URL) return { ok: false, detail: "NEON_DATABASE_URL unset — tenant NOT swept" };
  try {
    const out = execFileSync("bun", ["run", "scripts/provision-beta-gate.ts", "--cleanup", tenantId], {
      cwd: path.join(__dirname, "../.."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, detail: out.trim() || "cleaned" };
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    return { ok: false, detail: (err.stderr || err.message).split("\n").slice(-3).join(" ") };
  }
}
