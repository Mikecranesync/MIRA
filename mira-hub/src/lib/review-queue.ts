import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";

// Unified review-queue aggregator. Each source contributes ReviewItem rows that
// the /hub/admin/review page renders. New source = new fetcher exported below.

export type ReviewItemType = "proposal" | "cartoon" | "screenshot" | "audit";

export interface ReviewItem {
  id: string; // type-prefixed: "prop:<uuid>" | "cartoon:<rel-path>" | "screenshot:<rel-path>" | "audit:<rel-path>"
  type: ReviewItemType;
  title: string;
  previewUrl: string | null;
  body?: string | null;
  source: string;
  createdAt: string;
  actions: { id: "approve" | "reject" | "edit"; label: string }[];
  meta?: Record<string, string>;
}

export interface ReviewQueueResponse {
  items: ReviewItem[];
  counts: Record<ReviewItemType | "total", number>;
}

// Where to find on-disk assets. Container deploy bind-mounts the repo root
// at /app; local dev runs from mira-hub/ so the parent dir is the repo root.
function repoRoot(): string {
  if (process.env.REVIEW_REPO_ROOT) return process.env.REVIEW_REPO_ROOT;
  if (process.env.NODE_ENV === "production") return "/app";
  return path.resolve(process.cwd(), "..");
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

// Admin-email allowlist. Comma-separated env var; defaults to the two seats
// Mike currently uses. Keep this tight — the review surface bypasses the
// normal tenant scoping for filesystem reads.
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

// ── proposal source ────────────────────────────────────────────────────────

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
  created_at: string;
}

export async function fetchProposals(
  client: PoolClient,
  tenantId: string,
): Promise<ReviewItem[]> {
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
  return rows.map((r) => ({
    id: `prop:${r.id}`,
    type: "proposal" as const,
    title: `${r.source_name ?? r.source_entity_type} ─ ${r.relationship_type} ─ ${
      r.target_name ?? r.target_entity_type
    }`,
    previewUrl: null,
    body: r.reasoning ?? null,
    source: `relationship_proposals`,
    createdAt: r.created_at,
    actions: [
      { id: "approve", label: "Verify" },
      { id: "reject", label: "Reject" },
    ],
    meta: {
      confidence: `${Math.round(r.confidence * 100)}%`,
      createdBy: r.created_by,
    },
  }));
}

// ── filesystem image sources ───────────────────────────────────────────────

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
    // Skip already-approved or rejected variants — convention: filename suffix.
    if (/-rejected[-.]/i.test(ent.name)) continue;
    if (/\.published\./i.test(ent.name)) continue;
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
    // Skip if a sidecar marks it approved or rejected already.
    const sidecar = `${f.absPath}.review.json`;
    let sidecarStatus: string | null = null;
    try {
      const raw = await readFile(sidecar, "utf8");
      const j = JSON.parse(raw) as { status?: string };
      sidecarStatus = j.status ?? null;
    } catch {
      // no sidecar — pending
    }
    if (sidecarStatus === "approved" || sidecarStatus === "rejected") continue;
    const filename = path.basename(f.relPath);
    items.push({
      id: `${type}:${f.relPath}`,
      type,
      title: filename,
      previewUrl: `/api/admin/review/asset/${encodeURIComponent(f.relPath)}`,
      source: f.relPath,
      createdAt: f.mtime.toISOString(),
      actions: [
        { id: "approve", label: "Approve & publish" },
        { id: "reject", label: "Reject" },
      ],
    });
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const fetchCartoons = () => fetchImageQueue("cartoon", "marketing/cartoons");
export const fetchScreenshots = () =>
  fetchImageQueue("screenshot", "docs/promo-screenshots");

// ── web-review audit source ────────────────────────────────────────────────

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
    actions: [
      { id: "approve", label: "File as issue" },
      { id: "reject", label: "Dismiss" },
    ],
    meta: {
      severity: f.severity ?? "P3",
      url: f.url ?? "",
    },
  }));
}

// ── orchestrator ───────────────────────────────────────────────────────────

export async function getReviewQueue(
  client: PoolClient,
  tenantId: string,
): Promise<ReviewQueueResponse> {
  // Fan-out fetch. Each source isolated so one failure doesn't bury the rest.
  const [proposals, cartoons, screenshots, audits] = await Promise.all([
    fetchProposals(client, tenantId).catch((e) => {
      console.error("[review-queue] fetchProposals failed", e);
      return [] as ReviewItem[];
    }),
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
  const items = [...proposals, ...cartoons, ...screenshots, ...audits].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const counts = {
    proposal: proposals.length,
    cartoon: cartoons.length,
    screenshot: screenshots.length,
    audit: audits.length,
    total: items.length,
  };
  return { items, counts };
}

// Helper used by the asset route + approve route. Anchors a relative path
// inside one of the allow-listed source dirs; rejects traversal attempts.
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

export function sidecarPathFor(absPath: string): string {
  return `${absPath}.review.json`;
}
