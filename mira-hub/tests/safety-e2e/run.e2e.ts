/**
 * End-to-end safety eval driver (#4372, Mike decision 5).
 *
 * Drives each case through the REAL notebook-chat POST handler — pre-LLM
 * triggers, prompt assembly, generation, the answer gate, validateAnswer, the
 * prompt-leak check and the semantic judge — exactly as the build under test
 * ships them. Only the I/O edges are replaced: session, notebook rows, the DB,
 * and the retrieval SQL (which returns the case's own sources as chunks). The
 * prompt builders in manual-rag are the real ones (vi.importActual).
 *
 * Generation: the canonical seam is forced on and `canonicalProviders()` is
 * pinned to ONE provider so no silent fallback can swap the model mid-run:
 *   SAFETY_E2E_MODE=ollama  → Ollama's OpenAI-compatible endpoint (free; plumbing only)
 *   SAFETY_E2E_MODE=openai  → the real OpenAI entry only (needs OPENAI_API_KEY and a
 *                             spend GO; OPENAI_MODEL pins the model id)
 * The in-pipeline semantic judge uses the same registry, so it is pinned too.
 *
 * Spend guard (fails closed): every fetch goes through a host allowlist, and
 * every provider response's `usage` is metered. Before each case the driver
 * checks spent + SAFETY_E2E_CASE_WORST_USD against SAFETY_E2E_BUDGET_USD and
 * aborts the run (exit non-zero, partial results kept) when it would exceed it.
 * OPENAI_RUN_BUDGET_USD is also set to the same cap as a second floor.
 * Usage is priced from GEN_PRICE_PER_MTOK (or SAFETY_E2E_PRICE_IN/OUT_PER_MTOK);
 * a capped run on a model with no valid price is refused, never metered at $0.
 *
 * Inputs never live in the repo: SAFETY_E2E_CASES (blind jsonl from
 * tools/safety_e2e/prepare_cases.py) and SAFETY_E2E_OUT must both resolve
 * outside the repository.
 *
 * Run (from mira-hub/):
 *   SAFETY_E2E_CASES=/abs/cases.blind.jsonl SAFETY_E2E_OUT=/abs/outdir \
 *   SAFETY_E2E_MODE=ollama SAFETY_E2E_OLLAMA_URL=http://100.86.236.11:11434 \
 *   SAFETY_E2E_GEN_MODEL=mira:latest \
 *   npx vitest run --config tests/safety-e2e/vitest.config.ts
 */
import { it, vi } from "vitest";
import { NextRequest } from "next/server";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

type CaseSource = { id: string; text: string; applies: boolean };
type Case = { id: string; question: string; bound_machine: string | null; sources: CaseSource[] };

// ── env + guards ────────────────────────────────────────────────────────────
const env = (k: string, d = ""): string => (process.env[k] ?? "").trim() || d;
const MODE = env("SAFETY_E2E_MODE", "ollama");
const BUDGET_USD = Number(env("SAFETY_E2E_BUDGET_USD", MODE === "ollama" ? "0" : ""));
const CASE_WORST_USD = Number(env("SAFETY_E2E_CASE_WORST_USD", "0.05"));
const OLLAMA_URL = env("SAFETY_E2E_OLLAMA_URL", "http://127.0.0.1:11434").replace(/\/$/, "");
const GEN_MODEL = env("SAFETY_E2E_GEN_MODEL", MODE === "ollama" ? "mira:latest" : env("OPENAI_MODEL", "gpt-5.4-mini"));

// ── generator price (fails closed) ──────────────────────────────────────────
// The $ cap is only as good as the price it multiplies. A model with no list
// price, or a price that is not a finite number > 0 ("abc" → NaN made every cap
// comparison false; "0" metered every call at $0), refuses a capped run instead
// of being metered at a flat default or at $0.
// List prices, USD per 1M tokens, standard tier:
//   gpt-5.4-mini  https://developers.openai.com/api/docs/pricing (fetched 2026-10-29;
//                 equal to tools/review_router/prices.json and the openai-run-budget defaults)
const GEN_PRICE_PER_MTOK: Readonly<Record<string, { in: number; out: number }>> = {
  "gpt-5.4-mini": { in: 0.75, out: 4.5 },
};
/** A listed model id, or a dated snapshot of one (gpt-5.4-mini-2026-03-17). */
function listPrice(model: string): { in: number; out: number } | null {
  return GEN_PRICE_PER_MTOK[model] ?? GEN_PRICE_PER_MTOK[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")] ?? null;
}
function resolvePrice(model: string): { in: number; out: number } | string {
  const rawIn = env("SAFETY_E2E_PRICE_IN_PER_MTOK");
  const rawOut = env("SAFETY_E2E_PRICE_OUT_PER_MTOK");
  if (rawIn || rawOut) {
    const pIn = Number(rawIn);
    const pOut = Number(rawOut);
    const ok = (p: number) => Number.isFinite(p) && p > 0;
    if (!ok(pIn) || !ok(pOut)) return `SAFETY_E2E_PRICE_IN/OUT_PER_MTOK must both be finite numbers > 0 (got "${rawIn}", "${rawOut}")`;
    return { in: pIn, out: pOut };
  }
  return listPrice(model) ?? `no list price for generator model "${model}": add it to GEN_PRICE_PER_MTOK (source + date) or set SAFETY_E2E_PRICE_IN/OUT_PER_MTOK`;
}
// Set in the test body once the price resolves; 0 only on an uncapped (free, local) run.
let PRICE_IN = 0;
let PRICE_OUT = 0;
const LIMIT = Number(env("SAFETY_E2E_LIMIT", "0"));

function repoRoot(): string {
  return execSync("git rev-parse --show-toplevel", { cwd: HERE }).toString().trim();
}
function outsideRepo(p: string): string {
  const abs = path.resolve(p);
  const root = repoRoot();
  if (abs === root || abs.startsWith(root + path.sep)) throw new Error(`refusing: ${abs} is inside the repo`);
  return abs;
}

const allowedHosts = new Set<string>(
  MODE === "ollama" ? [new URL(OLLAMA_URL).host] : MODE === "openai" ? ["api.openai.com"] : [],
);
const meter = { inTok: 0, outTok: 0, calls: 0, usd: 0, unmetered: 0, blockedFetches: [] as string[], servedModels: [] as string[] };

// ── mocks: I/O edges only ───────────────────────────────────────────────────
let currentCase: Case | null = null;
const persisted: { turns: unknown[]; usage: unknown[] } = { turns: [], usage: [] };

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })) }));
vi.mock("@/lib/equipment-notebooks", () => ({
  validateChatSources: vi.fn(async (_t: string, _n: string, ids: string[]) =>
    ids.length ? { ok: true, docIds: ids, nodeId: "node-1" } : { ok: false, error: "no_sources_selected" },
  ),
  claimNotebookTurnRequest: vi.fn(async () => ({ status: "claimed", claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  recordTurn: vi.fn(async (...a: unknown[]) => {
    persisted.turns.push(a[2]);
  }),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({
    id: NB,
    displayName: currentCase?.bound_machine || "Equipment notebook",
    manufacturer: "",
    model: "",
  })),
  listSources: vi.fn(async () => []),
  listTurns: vi.fn(async () => []),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/manual-rag", async () => {
  const actual = await vi.importActual<typeof import("@/lib/manual-rag")>("@/lib/manual-rag");
  const toChunks = () =>
    (currentCase?.sources ?? []).map((s, i) => ({
      content: s.text,
      docId: DOC,
      manufacturer: "",
      modelNumber: "",
      sourceUrl: `node-doc/u1/source-${i + 1}.pdf`,
      sourcePage: i + 1,
      pageLabel: String(i + 1),
      chunkIndex: null,
      title: `Source ${i + 1}`,
      rank: 0.5 - i * 0.01,
      verified: true,
      // Route-faithful: a source that does not apply to the bound machine is a
      // sibling-model hit, which retrieval labels vendor_fallback.
      ...(s.applies ? {} : { retrievalScope: "vendor_fallback" as const }),
    }));
  return { ...actual, retrieveNodeChunks: vi.fn(async () => toChunks()), retrieveManualChunks: vi.fn(async () => toChunks()) };
});
vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: vi.fn(async () => null) }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({
  persistTurnUsage: vi.fn(async (...a: unknown[]) => {
    persisted.usage.push(a[2] ?? null);
    return { ok: true };
  }),
}));
vi.mock("@/lib/inference/canonical-cascade", async () => {
  const actual = await vi.importActual<typeof import("@/lib/inference/canonical-cascade")>("@/lib/inference/canonical-cascade");
  return {
    ...actual,
    canonicalSeamEnabled: () => true,
    canonicalProviders: () => {
      if (MODE === "ollama") {
        return [{ name: "Ollama", url: `${OLLAMA_URL}/v1/chat/completions`, key: "ollama", model: GEN_MODEL }];
      }
      const openai = actual.canonicalProviders().filter((p) => p.name === "OpenAI");
      if (openai.length !== 1) throw new Error("SAFETY_E2E_MODE=openai needs OPENAI_API_KEY");
      return openai;
    },
  };
});

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

// ── metered, allowlisted fetch ──────────────────────────────────────────────
const realFetch = globalThis.fetch;
const pending: Promise<void>[] = [];
function meterBody(text: string, worstUsd: number) {
  // Streams carry usage on the last data frame; JSON responses at the top level.
  let booked = false;
  // The model id the provider says actually served (a dated snapshot when the
  // request named an alias) — recorded per run, not assumed from the request.
  const served = text.match(/"model"\s*:\s*"([^"]+)"/);
  if (served && !meter.servedModels.includes(served[1])) meter.servedModels.push(served[1]);
  for (const m of text.matchAll(/"usage"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g)) {
    try {
      const u = JSON.parse(m[1]) as { prompt_tokens?: number; completion_tokens?: number };
      if (typeof u.prompt_tokens === "number") {
        meter.inTok += u.prompt_tokens;
        meter.outTok += u.completion_tokens ?? 0;
        meter.usd += ((u.prompt_tokens ?? 0) * PRICE_IN + (u.completion_tokens ?? 0) * PRICE_OUT) / 1e6;
        booked = true;
      }
    } catch {
      /* not a usage object */
    }
  }
  // Fail closed: a call whose usage we could not read (timeout, truncated
  // stream, provider omitted it) is booked at its worst case, never at $0.
  if (!booked) {
    meter.usd += worstUsd;
    meter.unmetered += 1;
  }
}
function worstCaseUsd(body: string | undefined): number {
  let maxOut = 4000;
  try {
    const b = JSON.parse(body ?? "{}") as { max_tokens?: number; max_completion_tokens?: number };
    maxOut = b.max_completion_tokens ?? b.max_tokens ?? maxOut;
  } catch {
    /* default */
  }
  return (((body ?? "").length / 4) * PRICE_IN + maxOut * PRICE_OUT) / 1e6;
}
let requestLog: string | null = null;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!allowedHosts.has(url.host)) {
    meter.blockedFetches.push(url.host);
    throw new Error(`safety-e2e: fetch to ${url.host} is not allowlisted`);
  }
  meter.calls += 1;
  if (requestLog && typeof init?.body === "string") {
    appendFileSync(requestLog, JSON.stringify({ case: currentCase?.id, url: url.pathname, body: JSON.parse(init.body) }) + "\n");
  }
  const worst = worstCaseUsd(typeof init?.body === "string" ? init.body : undefined);
  let res: Response;
  try {
    res = await realFetch(input as RequestInfo, init);
  } catch (e) {
    meterBody("", worst); // the request may have been billed before the abort
    throw e;
  }
  pending.push(res.clone().text().then((t) => meterBody(t, worst), () => meterBody("", worst)));
  return res;
}) as typeof fetch;

// ── layer telemetry the route only logs (semantic verdict, floor rejections) ─
const layerLog: string[] = [];
for (const level of ["log", "warn", "error", "info"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    const m = line.match(/semantic(?:-check| BLOCKED| UNVERIFIED| FLAGGED)[^\n]*|pre-display REJECTED [^\n]*|"event":"turn\.anomaly"[^\n]*/);
    if (m) layerLog.push(m[0].slice(0, 300));
    if (process.env.SAFETY_E2E_QUIET !== "1") orig(...args);
  };
}

// ── frame parsing ───────────────────────────────────────────────────────────
function parseFrames(text: string): Record<string, unknown>[] {
  return text
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

it(
  "safety-e2e run",
  async () => {
    const casesPath = outsideRepo(env("SAFETY_E2E_CASES"));
    const outDir = outsideRepo(env("SAFETY_E2E_OUT"));
    mkdirSync(outDir, { recursive: true });
    if (MODE !== "ollama" && MODE !== "openai") throw new Error(`unknown SAFETY_E2E_MODE=${MODE}`);
    if (MODE === "openai" && !(BUDGET_USD > 0)) throw new Error("SAFETY_E2E_BUDGET_USD must be set > 0 for a paid run");
    if (MODE === "openai" && !env("OPENAI_API_KEY")) throw new Error("SAFETY_E2E_MODE=openai needs OPENAI_API_KEY");
    if (MODE === "openai" && !env("OPENAI_MODEL")) throw new Error("SAFETY_E2E_MODE=openai needs OPENAI_MODEL pinned (e.g. a dated snapshot)");
    if (!(Number.isFinite(BUDGET_USD) && BUDGET_USD >= 0)) throw new Error("refusing: SAFETY_E2E_BUDGET_USD must be a finite number >= 0");
    if (!(Number.isFinite(CASE_WORST_USD) && CASE_WORST_USD >= 0)) throw new Error("refusing: SAFETY_E2E_CASE_WORST_USD must be a finite number >= 0");
    // Price the model the provider is actually asked for: in openai mode that is
    // OPENAI_MODEL (what canonicalProviders() sends), not a display label.
    const price = resolvePrice(MODE === "openai" ? env("OPENAI_MODEL") : GEN_MODEL);
    if (typeof price === "string") {
      if (BUDGET_USD > 0) throw new Error(`refusing: ${price}`);
    } else {
      PRICE_IN = price.in;
      PRICE_OUT = price.out;
    }
    // The in-process OpenAI budget sits ABOVE the driver cap: if it refused first,
    // the judge's refusal would surface as a semantic-unverified fallback BLOCK
    // and be scored as a safety outcome. The driver cap is the hard stop.
    if (BUDGET_USD > 0) process.env.OPENAI_RUN_BUDGET_USD = String(BUDGET_USD + 1);
    // Free providers must not join the registry as fallbacks.
    for (const k of ["OPENROUTER_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "TOGETHERAI_API_KEY", "GEMINI_API_KEY"]) delete process.env[k];
    if (env("SAFETY_E2E_LOG_REQUESTS") === "1") requestLog = path.join(outDir, "requests.jsonl");

    let cases = readFileSync(casesPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Case);
    if (LIMIT > 0) cases = cases.slice(0, LIMIT);
    const git = (a: string) => execSync(`git ${a}`, { cwd: HERE }).toString().trim();
    // A merge build's commit sha depends on its timestamp; the tree sha and the
    // parents identify the code under test reproducibly.
    const build = git("rev-parse HEAD");
    const buildTree = git("rev-parse HEAD^{tree}");
    const buildParents = git("log -1 --format=%P HEAD").split(" ");
    const genOut = path.join(outDir, "generations.jsonl");
    writeFileSync(genOut, "");
    let aborted: string | null = null;

    for (const c of cases) {
      if (BUDGET_USD > 0 && meter.usd + CASE_WORST_USD > BUDGET_USD) {
        aborted = `budget: spent ${meter.usd.toFixed(4)} + worst ${CASE_WORST_USD} > cap ${BUDGET_USD}`;
        break;
      }
      currentCase = c;
      persisted.turns = [];
      persisted.usage = [];
      layerLog.length = 0;
      const grounded = c.sources.length > 0;
      const body = grounded ? { message: c.question, sourceDocIds: [DOC] } : { message: c.question, sourceDocIds: [], mode: "general" };
      const t0 = Date.now();
      let frames: Record<string, unknown>[] = [];
      let httpStatus = 0;
      let error: string | null = null;
      try {
        const res = await POST(
          new NextRequest(`http://test/api/equipment-notebooks/${NB}/chat`, {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }),
          { params: Promise.resolve({ id: NB }) },
        );
        httpStatus = res.status;
        frames = parseFrames(await res.text());
      } catch (e) {
        error = String(e);
      }
      // The turn record is persisted after the stream closes; wait for it.
      for (let i = 0; i < 60 && persisted.usage.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
      await Promise.all(pending.splice(0));
      const turn = (persisted.turns[0] ?? {}) as { answerStatus?: string; answerText?: string; evidence?: Array<{ kind?: string; trigger?: string }> };
      const evidence = (turn.evidence ?? []).map((e) => ({ kind: e.kind, trigger: e.trigger ?? null }));
      const stop = evidence.find((e) => e.kind === "safety_stop") ?? null;
      const usageFrame = frames.find((f) => f.kind === "usage") as { provider?: string; model?: string } | undefined;
      const row = {
        id: c.id,
        build,
        build_tree: buildTree,
        mode: grounded ? "grounded" : "general",
        generator: { mode: MODE, provider: usageFrame?.provider ?? null, model: usageFrame?.model ?? null, requested: GEN_MODEL },
        http_status: httpStatus,
        error,
        latency_ms: Date.now() - t0,
        answer_status: turn.answerStatus ?? null,
        served_text: frames.filter((f) => f.kind === "content").map((f) => String(f.content)).join(""),
        blocked: Boolean(stop),
        block_trigger: stop?.trigger ?? null,
        notices: evidence.filter((e) => e.kind === "safety_notice").map((e) => e.trigger),
        frame_kinds: frames.map((f) => String(f.kind)),
        safety_frames: frames.filter((f) => f.kind === "safety"),
        // answer_gate.decision "blocked" without a safety_stop = the answer was
        // REPLACED (e.g. unsupported-specificity) — G4 counts it as an over-block.
        gate_decision: (persisted.usage[0] as { packet?: { answer_gate?: { decision?: string } } } | undefined)?.packet?.answer_gate?.decision ?? null,
        gate_reason: (persisted.usage[0] as { packet?: { answer_gate?: { reason?: string } } } | undefined)?.packet?.answer_gate?.reason ?? null,
        gate_packet: persisted.usage[0] ?? null,
        layer_log: [...layerLog],
        meter_after: { usd: Number(meter.usd.toFixed(6)), in_tok: meter.inTok, out_tok: meter.outTok, calls: meter.calls },
      };
      appendFileSync(genOut, JSON.stringify(row) + "\n");
      // Non-allowlisted fetches were refused (never sent); they are counted in
      // meter.blockedFetches and the run summary, not treated as an abort.
      if (BUDGET_USD > 0 && meter.usd > BUDGET_USD) {
        aborted = `budget: spent ${meter.usd.toFixed(4)} > cap ${BUDGET_USD}`;
        break;
      }
    }
    const summary = { build, build_tree: buildTree, build_parents: buildParents, mode: MODE, gen_model: GEN_MODEL, n_cases: cases.length, aborted, meter, budget_usd: BUDGET_USD, price_per_mtok: { in: PRICE_IN, out: PRICE_OUT } };
    writeFileSync(path.join(outDir, "run.summary.json"), JSON.stringify(summary, null, 1) + "\n");
    if (aborted) throw new Error(`safety-e2e ABORTED (${aborted}); partial results in ${genOut}`);
  },
  6 * 60 * 60 * 1000,
);
