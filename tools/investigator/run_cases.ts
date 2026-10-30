/**
 * run_cases.ts — the bench runner for all three harness arms (H0/H1/H2).
 *
 *   npx vite-node --config vitest.config.ts ../tools/investigator/run_cases.ts \
 *     -- <H0|H1|H2> <cases.json> <out.jsonl> [--labels labels.json] [--ledger path] [--cap 5]
 *
 * Owns (this lane, BENCH-A): the CLI wiring, `createBenchTools`
 * (`InvestigatorTools` for the bench DB + drive packs), the manual→loaded-
 * tenant resolver, and the drive-pack loader. H0 is implemented entirely in
 * `./single_pass.ts` (also this lane). H1/H2 call LOOP's `investigate()` —
 * NOT yet landed in this worktree as of this build (`src/capabilities/
 * investigator/` has CORE's `plan.ts`/`hazard-gate.ts`/`grounding.ts`/
 * `budget.ts` + `types.ts`, but no `tools.ts`/`evaluate.ts`/`synthesize.ts`/
 * `runner.ts`/`index.ts` yet); see "Pending LOOP integration" below.
 *
 * `FileSpendLedger` is CORE's real implementation
 * (`@/capabilities/investigator/budget`, landed mid-build) — this lane does
 * NOT define its own; an earlier draft did, before CORE's landed, and was
 * removed to avoid two competing ledgers (PREREGISTRATION.md §7 names one
 * ledger). Likewise the worst-case cost estimate (`worstCaseUsd`) and the
 * post-check (`ungroundedNumbers`/`unsafeInstructionPhrases`) are CORE's real
 * `grounding.ts`/`budget.ts` exports, reused via `./single_pass.ts`.
 *
 * ## Arms
 * H1/H2 call the capability's `investigate(input, { tools, model, ledger, limits, arm })`
 * (`@/capabilities/investigator/runner.ts`). `--no-model` passes model = null: evidence + trace only, $0.
 * Bench question rows get the manual's product as a confirmed identity (`benchIdentity`); scenario cases
 * keep their own `equipment.identityStatus`.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_LIMITS } from "@/capabilities/investigator/types";
import { investigate } from "@/capabilities/investigator";
import type {
  EvidenceItem,
  InvestigationInput,
  InvestigationMode,
  InvestigationResult,
  InvestigatorLimits,
  InvestigatorTools,
  SpendLedger,
  SynthesisModel,
} from "@/capabilities/investigator/types";
import { FileSpendLedger } from "@/capabilities/investigator/budget";
import { retrieveNodeChunks, type ManualChunk } from "@/lib/manual-rag";

import { OpenAiSynthesisModel } from "./openai-model";
import { chunksToEvidenceItems, defaultPostCheck, runSinglePassH0 } from "./single_pass";
import { docIdFor, RESERVED_SETS, tenantIdFor, uuidOf } from "./ingest";

// `pg` is loaded dynamically, not via a top-level `import` — see ingest.ts's
// header doc for why (tools/investigator/ lives outside mira-hub/, so tsc's
// bare-specifier resolution can't reach mira-hub/node_modules from here, even
// though vite-node resolves it fine at runtime). Same fix: a minimal
// structural type the real `pg.Client` satisfies, loaded via a dynamic
// `import()` with a non-literal specifier.
interface PgClientLike {
  connect(): Promise<void>;
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

async function loadPg(): Promise<new (opts: { connectionString: string }) => PgClientLike> {
  const specifier = "pg";
  const mod = (await import(specifier)) as { Client: new (opts: { connectionString: string }) => PgClientLike };
  return mod.Client;
}

export type Arm = "H0" | "H1" | "H2";

/** Union of bench question rows (forum/fault sets) and scenario cases
 *  (equipment/observations/drive-pack). All fields optional except `id` so
 *  one loader handles both shapes. */
export interface BenchCase {
  id: string;
  set?: string;
  manual?: string;
  /** Bench rows use `question`; scenario cases use `message`. */
  question?: string;
  message?: string;
  accepted?: number[];
  equipment?: {
    manufacturer?: string | null;
    model?: string | null;
    drivePackId?: string | null;
    identityStatus?: "unknown" | "candidate" | "user_confirmed" | "verified" | null;
  };
  observations?: Array<{ name: string; value: number | string; unit?: string | null }>;
  drive_pack?: string;
  role?: "technician" | "supervisor";
}

/** Bench question rows name only a manual key; the notebook they are asked in is that product's.
 *  Product names follow the 19 IMIB bench manuals (`.planning/2026-10-29-t1-fix/rewrite/audit_fresh3.py` PDF map). */
const BENCH_PRODUCTS: Record<string, { manufacturer: string; model: string }> = {
  pf40: { manufacturer: "Allen-Bradley", model: "PowerFlex 40" },
  pf4m: { manufacturer: "Allen-Bradley", model: "PowerFlex 4M" },
  acs355: { manufacturer: "ABB", model: "ACS355" },
  "micro820-um": { manufacturer: "Allen-Bradley", model: "Micro820" },
  "micro820-in": { manufacturer: "Allen-Bradley", model: "Micro820" },
  ml1100: { manufacturer: "Allen-Bradley", model: "MicroLogix 1100" },
  smcflex: { manufacturer: "Allen-Bradley", model: "SMC Flex" },
  e3plus: { manufacturer: "Allen-Bradley", model: "E3 Plus" },
  smc50: { manufacturer: "Allen-Bradley", model: "SMC-50" },
  micro810: { manufacturer: "Allen-Bradley", model: "Micro810" },
  "gs4-ch2": { manufacturer: "AutomationDirect", model: "DURApulse GS4" },
  "gs4-ch6": { manufacturer: "AutomationDirect", model: "DURApulse GS4" },
  "gs10-ch6": { manufacturer: "AutomationDirect", model: "DURApulse GS10" },
  "se-canopen-hw": { manufacturer: "Schneider Electric", model: "CANopen" },
  "se-lxm32a-canopen": { manufacturer: "Schneider Electric", model: "Lexium 32A" },
  "se-m171": { manufacturer: "Schneider Electric", model: "Modicon M171" },
  "se-m172": { manufacturer: "Schneider Electric", model: "Modicon M172" },
  "se-premium-serial": { manufacturer: "Schneider Electric", model: "Modicon Premium" },
  "se-x80-analog": { manufacturer: "Schneider Electric", model: "Modicon X80" },
};

/** Identity for a bench question row (no `equipment` field); null for scenario cases and unknown manuals. */
export function benchIdentity(c: BenchCase): { manufacturer: string; model: string } | null {
  if (c.equipment || !c.question || !c.manual) return null;
  return BENCH_PRODUCTS[c.manual] ?? null;
}

/** The run_cases.ts output row shape, per this lane's task brief. */
export interface RunCaseRow {
  id: string;
  arm: Arm;
  mode: InvestigationMode | null;
  hypothesis: string | null;
  next_check: { action: string; expected: Array<{ observation: string; implies: string }> } | null;
  follow_up: string | null;
  stop_reason: string;
  cited_pages: Array<number | null>;
  /** Evidence pages IN ORDER, as actually placed in front of the model. */
  evidence_pages: Array<number | null>;
  ungrounded_numbers: string[];
  unsafe_phrases: string[];
  latency_ms: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  trace: unknown;
  /** Passthrough-only join from `--labels`; NEVER fed into the question/
   *  evidence pipeline (see header doc). Absent when `--labels` is not given
   *  or the id has no label. */
  label?: unknown;
}

/** Fixed bench node id — SAME value + SAME derivation the pinned harness uses
 *  (`uuidOf("bench-node")`, tools/investigator/bench/retrieval_dev.ts: `const
 *  nodeId = uuidOf("bench-node");`), kept separate from the tenant/doc ids
 *  (which depend on set/manual) so every bench run addresses the same
 *  synthetic "node" regardless of arm. Computed, never hand-copied, so it is
 *  byte-identical to the pinned harness's value by construction. */
const BENCH_NODE_ID = uuidOf("bench-node");

// ---------------------------------------------------------------------------
// Drive packs — loaded read-only from `origin/main` via `git show` (never
// `git checkout`/`pull`; per this lane's hard rules, no new worktree, no
// write to ~/MIRA). Only the three known-shipped packs (safety/retrieval-
// tools inventory §2d) are attempted; an unknown id returns `null`, never throws.
// ---------------------------------------------------------------------------
const KNOWN_DRIVE_PACK_IDS = ["durapulse_gs10", "powerflex_40", "powerflex_525"] as const;

interface DrivePackSourceCitation {
  doc?: string;
  page?: string;
  excerpt?: string;
}
interface DrivePackParameter {
  parameter_id: string;
  name: string;
  purpose?: string;
  source_citation?: DrivePackSourceCitation;
}
export interface DrivePackJson {
  pack_id: string;
  live_decode?: { fault_codes?: Record<string, string> };
  parameters?: DrivePackParameter[];
  provenance?: { sources?: DrivePackSourceCitation[] };
}

/** Loads a drive pack's `pack.json` via `git -C ~/MIRA show origin/main:...`
 *  (read-only, `execFileSync`). `os.homedir()` is used because `execFileSync`
 *  does not expand `~`. Also records the pack file's own sha256 (via `git
 *  show` blob hash below) so a run's trace can prove exactly which pack
 *  content it used — a `~/MIRA` fetch between a dev run and the sealed run
 *  would otherwise silently change pack inputs with no record of it. */
export function loadDrivePack(packId: string): { pack: DrivePackJson; blobSha: string } | null {
  if (!(KNOWN_DRIVE_PACK_IDS as readonly string[]).includes(packId)) return null;
  const miraRoot = path.join(homedir(), "MIRA");
  const relPath = `mira-bots/shared/drive_packs/packs/${packId}/pack.json`;
  try {
    const json = execFileSync("git", ["-C", miraRoot, "show", `origin/main:${relPath}`], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const blobSha = execFileSync("git", ["-C", miraRoot, "rev-parse", `origin/main:${relPath}`], {
      encoding: "utf8",
    }).trim();
    return { pack: JSON.parse(json) as DrivePackJson, blobSha };
  } catch (err) {
    console.error(`[run_cases] drive pack "${packId}" unavailable:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function pageFromCitation(c?: DrivePackSourceCitation): number | null {
  if (!c?.page) return null;
  const n = Number(c.page);
  return Number.isFinite(n) ? n : null;
}

function evidenceFromDrivePack(
  pack: DrivePackJson,
  q: { code?: string; parameter?: string },
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  if (q.code) {
    const desc = pack.live_decode?.fault_codes?.[q.code];
    if (desc) {
      const src = pack.provenance?.sources?.[0];
      items.push({
        id: `drive_pack:${pack.pack_id}:fault:${q.code}`,
        source: "drive_pack",
        docId: null,
        title: src?.doc ?? `${pack.pack_id} drive pack`,
        page: pageFromCitation(src),
        text: `Fault ${q.code}: ${desc}`,
        toolCallIndex: 0,
      });
    }
  }
  if (q.parameter) {
    const needle = q.parameter.trim().toLowerCase();
    const match = pack.parameters?.find(
      (p) => p.parameter_id.toLowerCase() === needle || p.name.toLowerCase().includes(needle),
    );
    if (match) {
      const sc = match.source_citation;
      const pageLabel = sc?.page ? ` [p.${sc.page}]` : "";
      items.push({
        id: `drive_pack:${pack.pack_id}:param:${match.parameter_id}`,
        source: "drive_pack",
        docId: null,
        title: sc?.doc ?? `${pack.pack_id} drive pack`,
        page: pageFromCitation(sc),
        text: `${match.parameter_id} ${match.name}${pageLabel}: ${sc?.excerpt ?? match.purpose ?? ""}`,
        toolCallIndex: 0,
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// createBenchTools — InvestigatorTools (types.ts) backed by the bench
// Postgres DB (`retrieveNodeChunks`, the SAME production retrieval function
// H0 uses) plus the drive packs above. `equipmentHistory`/`liveData` report
// `unavailable` unconditionally — this is BENCH-A offline; per this lane's
// hard rules, history/live data must never be stubbed as fabricated data.
// ---------------------------------------------------------------------------
export interface BenchToolsOptions {
  db: unknown; // pg.Client — cast `as never` at the retrieveNodeChunks call site, same as single_pass.ts
  tenantId: string;
  nodeId: string;
  docIds: string[];
  identity?: { manufacturer: string | null; model: string | null } | null;
  drivePacks: Map<string, DrivePackJson>;
}

export function createBenchTools(opts: BenchToolsOptions): InvestigatorTools {
  const scopedDocIds = (requested: string[]) => (requested.length > 0 ? requested : opts.docIds);
  return {
    async searchManual(q) {
      const chunks: ManualChunk[] = await retrieveNodeChunks(opts.db as never, opts.tenantId, q.query, {
        nodeId: opts.nodeId,
        unsPath: null,
        topK: q.topK,
        docIds: scopedDocIds(q.docIds),
        rawQuery: q.rawQuery,
        ...(opts.identity ? { identity: opts.identity } : {}),
        validatedDocScope: true,
        approvedSourceDocIds: opts.docIds,
      });
      return chunksToEvidenceItems(chunks);
    },
    async lookupCode(q) {
      // No separate bench-side exact-code lane is built in this lane — the
      // production exact-code lane lives INSIDE `retrieveNodeChunks` itself
      // (manual-rag.ts:533 `extractFaultCodes`, per the retrieval-tools
      // inventory §1) and fires automatically on a query containing the code
      // token, so reusing `retrieveNodeChunks` with the code as the query
      // already gets the production exact-code admission behavior for free.
      const chunks: ManualChunk[] = await retrieveNodeChunks(opts.db as never, opts.tenantId, q.code, {
        nodeId: opts.nodeId,
        unsPath: null,
        topK: 8,
        docIds: scopedDocIds(q.docIds),
        rawQuery: q.code,
        validatedDocScope: true,
        approvedSourceDocIds: opts.docIds,
      });
      return chunksToEvidenceItems(chunks);
    },
    async lookupParameter(q) {
      const chunks: ManualChunk[] = await retrieveNodeChunks(opts.db as never, opts.tenantId, q.parameter, {
        nodeId: opts.nodeId,
        unsPath: null,
        topK: 8,
        docIds: scopedDocIds(q.docIds),
        rawQuery: q.parameter,
        validatedDocScope: true,
        approvedSourceDocIds: opts.docIds,
      });
      return chunksToEvidenceItems(chunks);
    },
    async drivePackLookup(q) {
      const pack = opts.drivePacks.get(q.packId);
      if (!pack) return [];
      return evidenceFromDrivePack(pack, { code: q.code, parameter: q.parameter });
    },
    async equipmentHistory() {
      return { status: "unavailable" as const, items: [] };
    },
    async liveData() {
      return { status: "unavailable" as const, items: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Manual -> loaded-tenant resolution (one SELECT per reserved set).
// ---------------------------------------------------------------------------
async function buildManualTenantMap(db: PgClientLike): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const set of RESERVED_SETS) {
    const tenant = tenantIdFor(set);
    let rows: Array<{ source_url: string | null }>;
    try {
      ({ rows } = await db.query<{ source_url: string | null }>(
        `SELECT DISTINCT source_url FROM knowledge_entries WHERE tenant_id = $1`,
        [tenant],
      ));
    } catch (err) {
      console.error(`[run_cases] manual-tenant map: query failed for set "${set}":`, err instanceof Error ? err.message : err);
      continue;
    }
    for (const row of rows) {
      const m = /^node-doc\/[^/]+\/(.+)\.pdf$/.exec(row.source_url ?? "");
      if (m && !map.has(m[1])) map.set(m[1], tenant); // first reserved set (in RESERVED_SETS order) wins
    }
  }
  return map;
}

export function resolveCaseTenant(
  c: BenchCase,
  manualTenantMap: Map<string, string>,
): { tenantId: string; docIds: string[] } {
  if (c.set) {
    return { tenantId: tenantIdFor(c.set), docIds: c.manual ? [docIdFor(c.manual)] : [] };
  }
  if (c.manual && manualTenantMap.has(c.manual)) {
    return { tenantId: manualTenantMap.get(c.manual)!, docIds: [docIdFor(c.manual)] };
  }
  // Documented fallback (task brief: "default set 'forum-fresh' tenant if the
  // manual is loaded there"). Logged, never silent, since a miss here means
  // the case will retrieve against an empty/wrong tenant.
  console.error(
    `[run_cases] case ${c.id}: no "set" and manual "${c.manual ?? "<none>"}" not found in any reserved set — ` +
      `defaulting to the "forum-fresh" tenant.`,
  );
  return { tenantId: tenantIdFor("forum-fresh"), docIds: c.manual ? [docIdFor(c.manual)] : [] };
}

// ---------------------------------------------------------------------------
// Pending LOOP integration — see header doc for why the specifier is a
// variable, not a literal.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
interface Cli {
  arm: Arm;
  casesPath: string;
  outPath: string;
  labelsPath: string | null;
  ledgerPath: string;
  capUsd: number;
  /** --no-model: H1/H2 run with model = null (evidence + trace only, $0). */
  noModel: boolean;
}

export function parseArgs(argv: string[]): Cli {
  const positional: string[] = [];
  let labelsPath: string | null = null;
  let ledgerPath: string | null = null;
  let capUsd: number | null = null;
  let noModel = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--labels") labelsPath = argv[++i] ?? null;
    else if (a === "--ledger") ledgerPath = argv[++i] ?? null;
    else if (a === "--cap") capUsd = Number(argv[++i]);
    else if (a === "--no-model") noModel = true;
    else positional.push(a);
  }
  const [arm, casesPath, outPath] = positional;
  if (arm !== "H0" && arm !== "H1" && arm !== "H2") {
    throw new Error(`usage: run_cases.ts <H0|H1|H2> <cases.json> <out.jsonl> [--labels f] [--ledger f] [--cap n]`);
  }
  if (!casesPath || !outPath) {
    throw new Error("usage: run_cases.ts <H0|H1|H2> <cases.json> <out.jsonl> [--labels f] [--ledger f] [--cap n]");
  }
  if (capUsd === null || !Number.isFinite(capUsd) || capUsd <= 0) {
    // Spend law (PREREGISTRATION.md §7 / zero-token-architecture.md): every
    // paid lane declares its dollar budget BEFORE it runs. No silent default.
    throw new Error("run_cases.ts: --cap <usd> is required (every paid call reserves worst-case cost against it)");
  }
  return {
    arm,
    casesPath,
    outPath,
    labelsPath,
    ledgerPath: ledgerPath ?? `${outPath}.ledger.jsonl`,
    capUsd,
    noModel,
  };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const connectionString = process.env.BENCH_PG;
  if (!connectionString) throw new Error("run_cases.ts: BENCH_PG required");

  const cases: BenchCase[] = JSON.parse(readFileSync(cli.casesPath, "utf8"));
  const labels: Record<string, unknown> = cli.labelsPath
    ? JSON.parse(readFileSync(cli.labelsPath, "utf8"))
    : {};

  const PgClient = await loadPg();
  const db = new PgClient({ connectionString });
  await db.connect();

  const ledger = new FileSpendLedger(cli.ledgerPath, cli.capUsd);
  const model = new OpenAiSynthesisModel({ responseFormat: cli.arm === "H0" ? "text" : "json_object" });

  const drivePackCache = new Map<string, DrivePackJson>();
  const drivePackBlobShas: Record<string, string> = {};
  const loadPackCached = (packId: string): DrivePackJson | null => {
    if (drivePackCache.has(packId)) return drivePackCache.get(packId)!;
    const loaded = loadDrivePack(packId);
    if (!loaded) return null;
    drivePackCache.set(packId, loaded.pack);
    drivePackBlobShas[packId] = loaded.blobSha;
    return loaded.pack;
  };
  // Preload every drive pack any scenario case names, so blob shas are fixed
  // at the START of the run (task brief: "record each pack's sha256... a
  // fetch between dev and sealed runs would silently change pack inputs").
  for (const c of cases) {
    const packId = c.drive_pack ?? c.equipment?.drivePackId ?? null;
    if (packId) loadPackCached(packId);
  }


  const manualTenantMap = await buildManualTenantMap(db);

  try {
    for (const c of cases) {
      const { tenantId, docIds } = resolveCaseTenant(c, manualTenantMap);
      const message = c.message ?? c.question ?? "";
      const packId = c.drive_pack ?? c.equipment?.drivePackId ?? null;
      const drivePacks = new Map<string, DrivePackJson>();
      if (packId) {
        const pack = loadPackCached(packId);
        if (pack) drivePacks.set(packId, pack);
      }

      let row: RunCaseRow;
      if (cli.arm === "H0") {
        const result = await runSinglePassH0(
          { message },
          {
            dbClient: db,
            tenantId,
            nodeId: BENCH_NODE_ID,
            docIds,
            identity: c.equipment ? { manufacturer: c.equipment.manufacturer ?? null, model: c.equipment.model ?? null } : null,
            model,
            ledger,
            postCheck: defaultPostCheck,
          },
        );
        row = {
          id: c.id,
          arm: "H0",
          mode: result.mode,
          hypothesis: result.hypothesis,
          next_check: result.nextCheck,
          follow_up: result.followUp,
          stop_reason: result.stopReason,
          cited_pages: result.citedPages,
          evidence_pages: result.evidencePages,
          ungrounded_numbers: result.ungroundedNumbers,
          unsafe_phrases: result.unsafePhrases,
          latency_ms: result.latencyMs,
          cost_usd: result.costUsd,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          trace: { ...result.trace, drive_pack_blob_shas: drivePackBlobShas },
        };
      } else {
        const tools = createBenchTools({
          db,
          tenantId,
          nodeId: BENCH_NODE_ID,
          docIds,
          identity: c.equipment ? { manufacturer: c.equipment.manufacturer ?? null, model: c.equipment.model ?? null } : null,
          drivePacks,
        });
        const input: InvestigationInput = {
          message,
          role: c.role ?? "technician",
          tenantId,
          nodeId: BENCH_NODE_ID,
          docIds,
          equipment: {
            manufacturer: c.equipment?.manufacturer ?? benchIdentity(c)?.manufacturer ?? null,
            model: c.equipment?.model ?? benchIdentity(c)?.model ?? null,
            // Scenario cases carry their own identity status (some test an UNconfirmed identity on purpose).
            // Bench question rows are asked inside the manual's own notebook, so the identity is that product, confirmed.
            identityStatus: c.equipment ? (c.equipment.identityStatus ?? "user_confirmed") : benchIdentity(c) ? "user_confirmed" : "unknown",
            drivePackId: packId,
          },
          observations: c.observations ?? [],
        };
        const limits: InvestigatorLimits = { ...DEFAULT_LIMITS, maxRounds: cli.arm === "H1" ? 1 : 2 };
        const result = await investigate(input, { tools, model: cli.noModel ? null : model, ledger, limits, arm: cli.arm });
        row = {
          id: c.id,
          arm: cli.arm,
          mode: result.mode,
          hypothesis: result.hypothesis,
          next_check: result.nextCheck,
          follow_up: result.followUpQuestion,
          stop_reason: result.trace.stopReason,
          cited_pages: result.citedEvidenceIds
            .map((eid) => result.evidence.find((e) => e.id === eid)?.page ?? null),
          // Evidence pages IN ORDER as actually placed in front of the model —
          // `result.evidence` per types.ts IS that set (post any
          // `maxEvidenceItems` cap LOOP's runner applies internally; this file
          // trusts that array rather than re-deriving it from raw tool calls).
          evidence_pages: result.evidence.map((e) => e.page),
          ungrounded_numbers: result.trace.postCheck.ungroundedNumbers,
          unsafe_phrases: result.trace.postCheck.unsafePhrases,
          latency_ms: result.trace.latencyMs,
          cost_usd: result.trace.model.costUsd,
          input_tokens: result.trace.model.inputTokens,
          output_tokens: result.trace.model.outputTokens,
          trace: { ...result.trace, drive_pack_blob_shas: drivePackBlobShas },
        };
      }

      if (c.id in labels) row.label = labels[c.id];

      // Append as each row finishes (not buffered to the end) — a sealed run
      // that crashes or hits the ledger cap mid-way must not lose the paid
      // rows it already produced.
      appendFileSync(cli.outPath, `${JSON.stringify(row)}\n`);
      console.log(`[run_cases] ${c.id} (${cli.arm}): stop_reason=${row.stop_reason} cost_usd=${row.cost_usd.toFixed(5)}`);

      if (row.stop_reason === "budget_exhausted") {
        console.error(`[run_cases] ledger refused a reservation — stopping cleanly (spent $${ledger.spentUsd().toFixed(4)} of $${ledger.capUsd().toFixed(2)}).`);
        break;
      }
    }
  } finally {
    await db.end();
  }
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
