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
 * debugging). Before EVERY turn the meter reserves a declared per-turn upper bound and refuses the
 * turn unless spent + that bound fits the budget, so no sequence of in-bound turns can pass it.
 *
 * The bound comes from the Hub's own code, not from history: output is capped at
 * `DEFAULT_MAX_OUTPUT_TOKENS` = 4000 (`src/lib/inference/canonical-cascade.ts`); input is a static
 * system prompt + at most 6 retrieved chunks of ≤ 1200 chars (`manual-rag.ts MAX_CONTENT_CHARS`,
 * `topK: 6`) + no history (every question is a fresh chat) — about 3k tokens observed, so 32k is
 * declared with 10× headroom. Priced at worst-case RATES (above gpt-5.4-mini list price), plus an
 * allowance for calls the stream does not report (the safety judge).
 *
 * FAILS CLOSED: a dispatched turn whose cost cannot be read (no response, no usage frame,
 * null / negative / non-finite counts) or whose usage breaks the declared bound stops every later
 * paid turn. Unasked rows are BROKEN ("budget stop"), never dropped.
 */
export const RATES = { inputPerMTok: 2.0, cachedInputPerMTok: 0.2, outputPerMTok: 16.0 };
export const UNMETERED_USD_PER_TURN = 0.02;
export const TURN_BOUND = { inputTokens: 32_000, outputTokens: 4_000 };
export const BUDGET = {
  usdPerRun: Number(process.env.STRANGER_WALK_BUDGET_USD ?? "3.00"),
  /** The declared worst case of one in-bound turn — reserved before each dispatch. */
  usdReservePerTurn: (TURN_BOUND.inputTokens * RATES.inputPerMTok + TURN_BOUND.outputTokens * RATES.outputPerMTok) / 1e6 + UNMETERED_USD_PER_TURN,
};

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Worst-case $ for one dispatched turn, from its recorded stream. `metered: false` = unreadable;
 *  `inBound: false` = its usage broke the declared per-turn bound. */
export function turnCostUsd(sse: string | null): { usd: number; metered: boolean; inBound: boolean } {
  let usd = 0, frames = 0, input = 0, output = 0;
  for (const line of (sse ?? "").split("\n")) {
    if (!line.startsWith("data: ")) continue;
    let f: Record<string, unknown>;
    try { f = JSON.parse(line.slice(6)); } catch { continue; }
    if (f?.kind !== "usage") continue;
    const i = count(f.inputTokens), c = count(f.cachedInputTokens ?? 0), o = count(f.outputTokens);
    if (i === null || c === null || o === null) return { usd: 0, metered: false, inBound: false };
    usd += (Math.max(i - c, 0) * RATES.inputPerMTok + c * RATES.cachedInputPerMTok + o * RATES.outputPerMTok) / 1e6;
    input += i; output += o; frames++;
  }
  if (!frames) return { usd: 0, metered: false, inBound: false };
  return { usd: usd + UNMETERED_USD_PER_TURN, metered: true, inBound: input <= TURN_BOUND.inputTokens && output <= TURN_BOUND.outputTokens };
}

export class BudgetMeter {
  spent = 0;
  turns = 0;
  /** Set by the first dispatched turn whose cost was unreadable or out of bound; nothing paid follows it. */
  unbounded: string | null = null;
  constructor(readonly budget = BUDGET.usdPerRun) {}
  /** May the next paid turn go out? Only if its declared worst case still fits. */
  canAfford(): boolean { return this.unbounded === null && this.spent + BUDGET.usdReservePerTurn <= this.budget + 1e-9; }
  /** Charge one DISPATCHED turn exactly once, as soon as its response (or its absence) is known. */
  charge(id: string, sse: string | null): number {
    const c = turnCostUsd(sse);
    this.turns++;
    this.spent += c.usd;
    if (!c.metered || !c.inBound) this.unbounded ??= id;
    return c.usd;
  }
}

/**
 * Fallback teardown when the register response could not be read: find the throwaway account by its
 * exact, run-unique email on STAGING and sweep its tenant. Refuses anything but a strangerwalk email.
 */
export async function tenantIdForEmail(email: string): Promise<string | null> {
  if (!/^strangerwalk-[a-z0-9-]+@factorylm\.com$/.test(email)) throw new Error(`refusing a non-walk email: ${email}`);
  if (!process.env.NEON_DATABASE_URL) return null;
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
