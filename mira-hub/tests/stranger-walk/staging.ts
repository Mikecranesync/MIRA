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
 * debugging). Enforced by a METER, not a call count: every turn is charged from the stream's own
 * `usage` frames at the declared worst-case RATES (deliberately above gpt-5.4-mini list price),
 * plus a fixed allowance for calls the stream does not report (the safety judge, a cascade retry).
 * A turn with no usage frame is charged the full per-turn ceiling. Before each turn the meter
 * reserves the most expensive turn seen so far (at least the ceiling) and refuses the turn if
 * spent + reserve would exceed the budget; every unasked row is then BROKEN ("budget stop").
 */
export const BUDGET = {
  usdPerRun: Number(process.env.STRANGER_WALK_BUDGET_USD ?? "3.00"),
  usdCeilingPerTurn: 0.05,
};
export const RATES = { inputPerMTok: 2.0, cachedInputPerMTok: 0.2, outputPerMTok: 16.0 };
export const UNMETERED_USD_PER_TURN = 0.02;

/** Worst-case $ for one turn, from its recorded stream (null = the request went out, nothing came back). */
export function turnCostUsd(sse: string | null): { usd: number; metered: boolean } {
  let usd = 0;
  let metered = false;
  for (const line of (sse ?? "").split("\n")) {
    if (!line.startsWith("data: ")) continue;
    let f: Record<string, unknown>;
    try { f = JSON.parse(line.slice(6)); } catch { continue; }
    if (f?.kind !== "usage") continue;
    const n = (k: string) => (typeof f[k] === "number" ? (f[k] as number) : 0);
    const cached = n("cachedInputTokens");
    usd += (Math.max(n("inputTokens") - cached, 0) * RATES.inputPerMTok + cached * RATES.cachedInputPerMTok + n("outputTokens") * RATES.outputPerMTok) / 1e6;
    metered = true;
  }
  return metered ? { usd: usd + UNMETERED_USD_PER_TURN, metered } : { usd: BUDGET.usdCeilingPerTurn, metered };
}

export class BudgetMeter {
  spent = 0;
  turns = 0;
  unmetered = 0;
  private worst = BUDGET.usdCeilingPerTurn;
  constructor(readonly budget = BUDGET.usdPerRun) {}
  /** May the next paid turn go out without risking the budget? */
  canAfford(): boolean { return this.spent + this.worst <= this.budget + 1e-9; }
  charge(sse: string | null): number {
    const c = turnCostUsd(sse);
    this.spent += c.usd;
    this.turns++;
    if (!c.metered) this.unmetered++;
    this.worst = Math.max(this.worst, c.usd);
    return c.usd;
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
