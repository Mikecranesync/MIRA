import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { isUndefinedRelationOrColumn } from "@/lib/machine-memory";

// Unified review-queue aggregator. Each source contributes ReviewItem rows that
// the /hub/admin/review page renders. Read-only — no approve/publish workflow
// in this PR; the page is for visibility while we decide next steps.

export type ReviewItemType = "proposal" | "cartoon" | "screenshot" | "audit";

export interface ReviewItem {
  id: string; // type-prefixed: "prop:<uuid>" | "cartoon:<rel-path>" | "screenshot:<rel-path>" | "audit:<rel-path>"
  type: ReviewItemType;
  title: string;
  previewUrl: string | null;
  body?: string | null;
  source: string;
  createdAt: string;
  meta?: Record<string, string>;
}

export type ReviewQueueNotice = {
  code: "schema_behind";
  message: string;
  sqlstate?: string;
};

export interface ReviewQueueResponse {
  items: ReviewItem[];
  counts: Record<ReviewItemType | "total", number>;
  notice?: ReviewQueueNotice;
}

const NOT_IN_TRANSACTION = "25P01";
const EPOCH_ISO = new Date(0).toISOString();

function sqlstateOf(err: unknown): string | undefined {
  const code = (err as { code?: string } | null | undefined)?.code;
  return typeof code === "string" && code ? code : undefined;
}

// Same law as machine-memory.ts / GET /api/work-orders: only undefined_table
// (42P01) and undefined_column (42703) mean "migration not applied". An aborted
// transaction (25P02), GRANT miss (42501), or missing role (42704) must not be
// reported as #3355/#3952 — those are recovery or tenant-preamble failures.
export function isReviewQueueSchemaBehind(err: unknown): boolean {
  return isUndefinedRelationOrColumn(err);
}

export function schemaBehindNotice(sqlstate?: string): ReviewQueueNotice {
  return {
    code: "schema_behind",
    message:
      "Review queue cannot load proposals because the database schema is behind (unapplied migrations). See #3355 (staging) and #3952 (prod).",
    ...(sqlstate ? { sqlstate } : {}),
  };
}

// pg returns Date objects for timestamptz (no setTypeParser override here) —
// same class as uploads.ts toIsoString. localeCompare must never see a Date.
// Invalid Date is epoch, not a throw after RELEASE that would abort the txn.
function toIsoString(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : EPOCH_ISO;
  }
  if (typeof value === "string" && value) return value;
  return EPOCH_ISO;
}

// Where to find on-disk assets. Container deploy bind-mounts the repo root
// at /app; local dev runs from mira-hub/ so the parent dir is the repo root.
function repoRoot(): string {
  if (process.env.REVIEW_REPO_ROOT) return process.env.REVIEW_REPO_ROOT;
  if (process.env.NODE_ENV === "production") return "/app";
  // PWD, not process.cwd(): Next's file tracer follows a literal process.cwd()
  // path and copied the WHOLE REPO (docs, marketing, mira-bridge's DB) into
  // .next/standalone on every local build. Same value at runtime: `npm run dev`
  // runs from mira-hub/, and path.resolve falls back to the cwd if PWD is unset.
  return path.resolve(process.env.PWD ?? "", "..");
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

// Admin-email allowlist. Comma-separated env var; defaults to the two seats
// Mike currently uses. Keep this tight — the review surface bypasses normal
// tenant scoping for filesystem reads. NOT an authority on its own (#4591):
// registration does not verify email ownership, so capabilities.ts requires the
// DB platform-admin flag (hub_users.status='admin') AND this match.
const ADMIN_EMAILS = (
  process.env.ADMIN_EMAILS ??
  "harperhousebuyers@gmail.com,mike@cranesync.com"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isReviewAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// ── proposal source ─────────────────────────────

interface ProposalRow {
  id: string;
  source_name: string | null;
  source_entity_type: string;
  target_name: string | null;
  target_entity_type: string;
  relationship_type: string;
  confidence: number;
  status: string;
  created_by: string;
  reasoning: string | null;
  created_at: Date | string | null;
}

function mapProposalRows(rows: ProposalRow[]): ReviewItem[] {
  return rows.map((r) => ({
    id: `prop:${r.id}`,
    type: "proposal" as const,
    title: `${r.source_name ?? r.source_entity_type} ─ ${r.relationship_type} ─ ${
      r.target_name ?? r.target_entity_type
    }`,
    previewUrl: null,
    body: r.reasoning ?? null,
    source: `relationship_proposals`,
    createdAt: toIsoString(r.created_at),
    meta: {
      confidence: `${Math.round(r.confidence * 100)}%`,
      createdBy: r.created_by,
    },
  }));
}

export async function fetchProposals(
  client: PoolClient,
  tenantId: string,
): Promise<{ items: ReviewItem[]; notice?: ReviewQueueNotice }> {
  // Same class as manual-rag.ts hybrid_vector_lane (#4487): a failing SELECT
  // inside withTenantContext's transaction aborts it, so the later COMMIT
  // raises 25P02. Fence the optional proposals query in a SAVEPOINT.
  // 25P01 is the only SAVEPOINT miss that means "no transaction to recover".
  // Any other SAVEPOINT error (including 25P02 already-aborted) propagates so
  // withTenantContext rolls back instead of reporting schema_behind.
  let savepoint = false;
  try {
    await client.query("SAVEPOINT review_queue_proposals");
    savepoint = true;
  } catch (err) {
    if (sqlstateOf(err) !== NOT_IN_TRANSACTION) throw err;
  }
  try {
    const { rows } = await client.query<ProposalRow>(
      `SELECT
        p.id,
        p.source_entity_type,
        p.target_entity_type,
        p.relationship_type,
        p.confidence,
        p.status,
        p.created_by,
        p.reasoning,
        p.created_at,
        (SELECT name FROM kg_entities WHERE id = p.source_entity_id) AS source_name,
        (SELECT name FROM kg_entities WHERE id = p.target_entity_id) AS target_name
       FROM relationship_proposals p
      WHERE p.tenant_id = $1::uuid
        AND p.status = 'proposed'
      ORDER BY p.created_at DESC
      LIMIT 200`,
      [tenantId],
    );
    // Map before RELEASE so a mapping throw still has a savepoint to roll back to.
    const items = mapProposalRows(rows);
    if (savepoint) await client.query("RELEASE SAVEPOINT review_queue_proposals");
    return { items };
  } catch (err) {
    // Do not swallow ROLLBACK TO — same as pg-unique-retry.ts. A failed
    // rollback leaves the caller transaction aborted; getReviewQueue must not
    // turn that into a successful empty page + schema_behind notice.
    if (savepoint) await client.query("ROLLBACK TO SAVEPOINT review_queue_proposals");
    if (isReviewQueueSchemaBehind(err)) {
      const sqlstate = sqlstateOf(err);
      console.warn("[review-queue] fetchProposals failed (schema behind)", sqlstate, err);
      return { items: [], notice: schemaBehindNotice(sqlstate) };
    }
    // Same law as machine-memory.ts: permission / timeout / connection after a
    // recovered savepoint must rethrow. Only undefined relation/column degrades.
    console.error("[review-queue] fetchProposals failed", err);
    throw err;
  }
}

// ── filesystem image sources ───────────────

async function* walkImages(absDir: string, base: string): AsyncGenerator<{
  absPath: string;
  relPath: string;
  mtime: Date;
}> {
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(absDir, ent.name);
    const rel = path.posix.join(base, ent.name);
    if (ent.isDirectory()) {
      yield* walkImages(full, rel);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!IMAGE_EXT.has(path.extname(ent.name).toLowerCase())) continue;
    // Filename suffixes that mean "already triaged" — skip from the queue.
    if (/-rejected[-.]/i.test(ent.name)) continue;
    let mtime = new Date(0);
    try {
      const st = await stat(full);
      mtime = st.mtime;
    } catch {
      // ignore
    }
    yield { absPath: full, relPath: rel, mtime };
  }
}

async function fetchImageQueue(
  type: "cartoon" | "screenshot",
  relRoot: string,
): Promise<ReviewItem[]> {
  const absRoot = path.join(repoRoot(), relRoot);
  const items: ReviewItem[] = [];
  for await (const f of walkImages(absRoot, relRoot)) {
    items.push({
      id: `${type}:${f.relPath}`,
      type,
      title: path.basename(f.relPath),
      previewUrl: `/api/admin/review/asset/${encodeURIComponent(f.relPath)}`,
      source: f.relPath,
      createdAt: f.mtime.toISOString(),
    });
  }
  return items.sort((a, b) => toIsoString(b.createdAt).localeCompare(toIsoString(a.createdAt)));
}

export const fetchCartoons = () => fetchImageQueue("cartoon", "marketing/cartoons");
export const fetchScreenshots = () =>
  fetchImageQueue("screenshot", "docs/promo-screenshots");

// ── web-review audit source ──────────────────

interface AuditFinding {
  url?: string;
  severity?: string;
  summary?: string;
  evidence?: string;
}

export async function fetchWebReviewFindings(): Promise<ReviewItem[]> {
  const auditRoot = path.join(repoRoot(), "tools/web-review-runs");
  let runs: string[];
  try {
    runs = await readdir(auditRoot);
  } catch {
    return [];
  }
  // Sort lexicographically — folder names start with date, so newest last.
  runs.sort();
  const latest = runs.at(-1);
  if (!latest) return [];
  const summary = path.join(auditRoot, latest, "summary.json");
  let findings: AuditFinding[] = [];
  try {
    const raw = await readFile(summary, "utf8");
    const parsed = JSON.parse(raw) as { findings?: AuditFinding[] };
    findings = parsed.findings ?? [];
  } catch {
    return [];
  }
  let createdAt = new Date(0).toISOString();
  try {
    const st = await stat(summary);
    createdAt = st.mtime.toISOString();
  } catch {
    // ignore
  }
  return findings.slice(0, 50).map((f, idx) => ({
    id: `audit:${latest}/${idx}`,
    type: "audit" as const,
    title: f.summary ?? `Finding #${idx}`,
    previewUrl: null,
    body: f.evidence ?? f.url ?? null,
    source: `tools/web-review-runs/${latest}/summary.json`,
    createdAt,
    meta: {
      severity: f.severity ?? "P3",
      url: f.url ?? "",
    },
  }));
}

// ── orchestrator ───────────────────────

export async function getReviewQueue(
  client: PoolClient,
  tenantId: string,
): Promise<ReviewQueueResponse> {
  // Proposals are fenced by SAVEPOINT and must not be swallowed: a failed
  // rollback leaves the caller transaction aborted, and withTenantContext's
  // COMMIT would then raise 25P02. Filesystem sources do not use the client.
  const [proposalFetch, cartoons, screenshots, audits] = await Promise.all([
    fetchProposals(client, tenantId),
    fetchCartoons().catch((e) => {
      console.error("[review-queue] fetchCartoons failed", e);
      return [] as ReviewItem[];
    }),
    fetchScreenshots().catch((e) => {
      console.error("[review-queue] fetchScreenshots failed", e);
      return [] as ReviewItem[];
    }),
    fetchWebReviewFindings().catch((e) => {
      console.error("[review-queue] fetchWebReviewFindings failed", e);
      return [] as ReviewItem[];
    }),
  ]);
  const proposals = proposalFetch.items;
  const items = [...proposals, ...cartoons, ...screenshots, ...audits].sort((a, b) =>
    toIsoString(b.createdAt).localeCompare(toIsoString(a.createdAt)),
  );
  const counts = {
    proposal: proposals.length,
    cartoon: cartoons.length,
    screenshot: screenshots.length,
    audit: audits.length,
    total: items.length,
  };
  return proposalFetch.notice
    ? { items, counts, notice: proposalFetch.notice }
    : { items, counts };
}

// Helper used by the asset route. Anchors a relative path inside one of the
// allow-listed source dirs; rejects traversal attempts.
const ALLOWED_REL_ROOTS = ["marketing/cartoons", "docs/promo-screenshots"];

export function resolveAssetPath(relPath: string): string | null {
  const cleaned = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.includes("..")) return null;
  if (!ALLOWED_REL_ROOTS.some((root) => cleaned.startsWith(`${root}/`))) {
    return null;
  }
  const full = path.resolve(repoRoot(), cleaned);
  const root = path.resolve(repoRoot());
  if (!full.startsWith(`${root}${path.sep}`) && full !== root) return null;
  return full;
}
