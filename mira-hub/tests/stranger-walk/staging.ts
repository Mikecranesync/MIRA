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
 * spend bounds the true spend as long as the deployed Hub bills at the prices read here. A Doppler
 * change without a Hub redeploy breaks that: an owner-accepted residual risk, fixed by #4507.
 *
 * Worst case of one turn, from production constants:
 *  - answer: every cascade provider may attempt it in full — ≤ TURN_BOUND.inputTokens in and
 *    ≤ 1400 out (`requestCap` in api/equipment-notebooks/[id]/chat/route.ts);
 *  - safety judge: every provider may attempt it — same input bound, ≤ 200 out
 *    (`max_completion_tokens 200`, src/capabilities/answer-safety-check.ts).
 * Input bound: static system prompt + ≤ 6 chunks of ≤ 1200 chars (`manual-rag.ts`) + no history
 * (every question is a fresh chat) — ~3.2k tokens observed over 50 turns; 8k declared (2.5×), and
 * a turn that shows more stops every later paid turn.
 * Prices ($/Mtok): gpt-5.4-mini from tools/review_router/prices.json; Groq / Cerebras / Together are
 * the list price of the ONE fixed model each cascade entry names (`PRICE_PER_MTOK` in
 * src/lib/inference/canonical-cascade.ts; Cerebras included though archived). OpenRouter is NOT
 * booked at that table's 0.20/0.52 — the cascade itself says that number is an estimate (it picks
 * among hosts per request). It is booked at `OPENROUTER_CEILING`, and `assertOpenRouterCeiling`
 * checks the live per-host catalog against that ceiling before the first paid request.
 *
 * FAILS CLOSED: a turn whose final usage is unreadable, breaks the declared bound, or was served
 * by a provider/model this table does not price stops every later paid turn — the booking assumed
 * a bound that no longer holds.
 */
/** The one OpenRouter model the deployed cascade requests (`OPENROUTER_TEXT_MODEL`, canonical-cascade.ts). */
export const OPENROUTER_PINNED_MODEL = "meta-llama/llama-3.3-70b-instruct";
/**
 * $/Mtok booked for OpenRouter: a declared ceiling over every host that can serve the pinned model,
 * not the cascade's estimate. 2026-10-31 catalog max was 0.72 in / 2.253 out (Cloudflare fp8) across
 * 10 hosts. Preflight refuses to spend if the live catalog ever lists a host above this.
 */
export const OPENROUTER_CEILING = { input: 1.0, output: 2.5 };
export const PROVIDER_PRICES: Record<string, { input: number; output: number }> = {
  OpenAI: { input: 0.75, output: 4.5 },
  OpenRouter: OPENROUTER_CEILING,
  Groq: { input: 0.15, output: 0.75 },
  Cerebras: { input: 0.1, output: 0.6 },
  Together: { input: 0.88, output: 0.88 },
};
export const TURN_BOUND = { inputTokens: 8_000, answerOutputTokens: 1_400, judgeOutputTokens: 200 };

/** OpenRouter's public per-host price list for one model (no key needed). The catalog is every host,
 *  not only the zero-retention ones the Hub routes to, so its maximum bounds whatever the Hub lands on. */
export const OPENROUTER_ENDPOINTS_URL = `https://openrouter.ai/api/v1/models/${OPENROUTER_PINNED_MODEL}/endpoints`;

/** Highest input / output $/Mtok across the catalog's hosts. Throws on anything unreadable: wrong
 *  model, no hosts, or a non-finite / negative price — never a silent 0. */
export function openRouterCatalogMax(catalog: unknown): { input: number; output: number; hosts: number } {
  const data = (catalog as { data?: { id?: unknown; endpoints?: unknown } } | null)?.data;
  if (!data || data.id !== OPENROUTER_PINNED_MODEL) throw new Error(`OpenRouter catalog is not for ${OPENROUTER_PINNED_MODEL} — refusing to spend`);
  if (!Array.isArray(data.endpoints) || data.endpoints.length === 0) throw new Error("OpenRouter catalog lists no hosts — refusing to spend");
  let input = 0, output = 0;
  for (const e of data.endpoints as Array<{ pricing?: { prompt?: unknown; completion?: unknown } }>) {
    const i = Number(e?.pricing?.prompt) * 1e6, o = Number(e?.pricing?.completion) * 1e6;
    if (!Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) throw new Error("OpenRouter catalog has an unreadable host price — refusing to spend");
    input = Math.max(input, i); output = Math.max(output, o);
  }
  return { input, output, hosts: data.endpoints.length };
}

/** Preflight: every host that can serve the pinned model must be priced at or below the booked
 *  ceiling, or the walk refuses to start. Any fetch/parse failure also refuses (fail closed). */
export async function assertOpenRouterCeiling(fetchImpl: typeof fetch = fetch): Promise<{ input: number; output: number; hosts: number }> {
  let max: { input: number; output: number; hosts: number };
  try {
    const res = await fetchImpl(OPENROUTER_ENDPOINTS_URL, { headers: { accept: "application/json" } });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    max = openRouterCatalogMax(await res.json());
  } catch (e) {
    throw new Error(`OpenRouter price catalog unreadable (${(e as Error).message}) — refusing to spend`);
  }
  if (max.input > OPENROUTER_CEILING.input || max.output > OPENROUTER_CEILING.output) {
    throw new Error(`OpenRouter host priced $${max.input}/$${max.output} per Mtok, above the booked ceiling $${OPENROUTER_CEILING.input}/$${OPENROUTER_CEILING.output} — refusing to spend`);
  }
  return max;
}

/** Model env vars the deployed cascades honour: the answer cascade (canonical-cascade.ts) and the
 *  safety-judge cascade (src/lib/llm/cascade.ts). The table above prices only the defaults, so ANY
 *  override means an unpriced model: the walk refuses to start. */
const MODEL_OVERRIDES = [
  "OPENAI_MODEL", "OPENROUTER_MODEL", "GROQ_MODEL", "CEREBRAS_MODEL", "TOGETHER_MODEL", "TOGETHERAI_MODEL",
  "OPENAI_CLASSIFIER_MODEL", "GROQ_CLASSIFIER_MODEL", "CEREBRAS_CLASSIFIER_MODEL", "TOGETHERAI_CLASSIFIER_MODEL",
];

/**
 * The prices the deployed Hub bills against, read from the walk's own `doppler run --config stg`
 * snapshot. That matches the Hub only if it was redeployed after the last Doppler change (#4507): OPENAI_PRICE_PER_MTOK_IN/OUT override gpt-5.4-mini's declared
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
    // Production (openai-run-budget.ts envNumber, exclusive minimum 0) replaces a zero rate with the
    // nonzero default, so the walk books that default too.
    return v > 0 ? v : fallback;
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

/** The declared hard cap per run. STRANGER_WALK_BUDGET_USD may only LOWER it: a value that is not a
 *  finite number in [0, 4.50] (e.g. an inherited 100 or Infinity) refuses to start. */
export const MAX_USD_PER_RUN = 4.5;
export function budgetUsdFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.STRANGER_WALK_BUDGET_USD;
  if (raw === undefined || raw.trim() === "") return MAX_USD_PER_RUN;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > MAX_USD_PER_RUN) {
    throw new Error(`STRANGER_WALK_BUDGET_USD=${raw} is outside the $0–$${MAX_USD_PER_RUN} budget — refusing to spend`);
  }
  return v;
}

export const BUDGET = {
  /** 50 questions × the booked worst case, rounded up. Real spend is a small fraction (≈ $0.2). */
  usdPerRun: budgetUsdFromEnv(),
  usdBookedPerTurn: worstCaseTurnUsd(),
};

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Did the turn's visible usage stay inside the bound the booking assumed? `readable: false` = no
 *  response, no usage frame, or null / negative / non-finite counts. */
export function turnUsage(sse: string | null): { readable: boolean; inBound: boolean; inputTokens: number; outputTokens: number } {
  let frames = 0, input = 0, output = 0, priced = true;
  for (const line of (sse ?? "").split("\n")) {
    if (!line.startsWith("data: ")) continue;
    let f: Record<string, unknown>;
    try { f = JSON.parse(line.slice(6)); } catch { continue; }
    if (f?.kind !== "usage") continue;
    const i = count(f.inputTokens), c = count(f.cachedInputTokens ?? 0), o = count(f.outputTokens);
    if (i === null || c === null || o === null) return { readable: false, inBound: false, inputTokens: 0, outputTokens: 0 };
    input = Math.max(input, i); output = Math.max(output, o); frames++;
    // The booking priced the five cascade providers, and OpenRouter only on its pinned model. A
    // turn served by anything else was billed at a rate the booking never covered (fail closed).
    // provider null = no provider served (error / empty turn): nothing was billed for the answer.
    if (typeof f.provider === "string") {
      if (!(f.provider in PROVIDER_PRICES)) priced = false;
      if (f.provider === "OpenRouter" && f.model !== OPENROUTER_PINNED_MODEL) priced = false;
    }
  }
  if (!frames) return { readable: false, inBound: false, inputTokens: 0, outputTokens: 0 };
  return { readable: true, inBound: priced && input <= TURN_BOUND.inputTokens && output <= TURN_BOUND.answerOutputTokens, inputTokens: input, outputTokens: output };
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

type Queryable = { query: (sql: string, params: unknown[]) => Promise<unknown> };

/**
 * #4927: with MIRA_PILOT_APPROVAL_REQUIRED on (staging and prod since 2026-10-28), register makes the
 * stranger 'pending' and middleware sends every page to /pending-approval, so the walk never reaches
 * /v3. Put THIS run's own throwaway tenant back on the flag-off path, exactly as the acceptance
 * provisioner does (#4928): owner on a trial, tenant pilot_status NULL — never 'active', so the run
 * never takes one of the real pilot cohort slots. With the flag off both UPDATEs match nothing.
 * Scoped by tenant AND the run-unique walk email; refuses anything else before touching the database.
 */
export async function releaseOwnPilotHold(tenantId: string, email: string, db?: Queryable): Promise<void> {
  if (!/^strangerwalk-[a-z0-9-]+@factorylm\.com$/.test(email)) throw new Error(`refusing a non-walk email: ${email}`);
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error(`refusing: not a tenant uuid: ${tenantId}`);
  let c: (Queryable & { end?: () => Promise<void> }) | undefined = db;
  if (!c) {
    if (!process.env.NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL unset — cannot release the walk tenant from the pilot gate");
    const { Client } = await import("pg");
    const pg = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pg.connect();
    c = pg;
  }
  try {
    await c.query(
      `UPDATE hub_users SET status = 'trial', trial_expires_at = NOW() + INTERVAL '1 day', updated_at = NOW()
       WHERE tenant_id = $1 AND email = $2 AND status = 'pending'`,
      [tenantId, email],
    );
    try {
      await c.query(
        `UPDATE hub_tenants SET pilot_status = NULL WHERE id = $1 AND pilot_status = 'pending'
         AND EXISTS (SELECT 1 FROM hub_users WHERE tenant_id = $1 AND email = $2)`,
        [tenantId, email],
      );
    } catch (err) {
      // Pre-107 schema has no pilot_status column — nothing to undo there.
      if ((err as { code?: string }).code !== "42703") throw err;
    }
  } finally {
    if (!db) await c.end?.();
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
