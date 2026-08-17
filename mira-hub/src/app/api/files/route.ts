/**
 * GET /api/files — the tenant's canonical file list ("Files").
 *
 * Spec: Component Nameplate → Manual + Centralized Multi-Asset Files (Part 1).
 * All relationship/file SQL lives in @/lib/workspace-files — this route only
 * validates input, delegates, and maps status codes.
 *
 * Query params:
 *   q          filename search (ILIKE, substring)
 *   capability indexable | viewable | stored
 *   unfiled    "true" → only files with zero relationships
 *   limit      1..200 (service clamps; default 50)
 *   offset     >= 0
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode, ingestTextToNode, deleteOrphanNodeIngest } from "@/lib/node-knowledge-ingest";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/config";
import {
  listFiles,
  parkOrReuseFile,
  linkFileToUpload,
  attachFileToTargets,
  fileCapability,
  isLinkTargetType,
  claimIngest,
  releaseIngestClaim,
  type AttachTarget,
  type FileCapability,
} from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

const CAPABILITIES: FileCapability[] = ["indexable", "viewable", "stored"];

function intParam(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  return n;
}

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const capabilityRaw = url.searchParams.get("capability");
  if (capabilityRaw && !CAPABILITIES.includes(capabilityRaw as FileCapability)) {
    return NextResponse.json({ error: "invalid_capability" }, { status: 422 });
  }

  try {
    const files = await listFiles(ctx.tenantId, {
      q: q && q.trim() ? q.trim() : null,
      capability: (capabilityRaw as FileCapability | null) ?? null,
      unfiled: url.searchParams.get("unfiled") === "true",
      limit: intParam(url.searchParams.get("limit")),
      offset: intParam(url.searchParams.get("offset")),
    });
    return NextResponse.json({ files });
  } catch (err) {
    console.error("[api/files GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

/**
 * POST /api/files — the target-agnostic upload door.
 *
 * The node door (`/api/namespace/node/[id]/files`) can only file at a namespace
 * node, so "Add file" from an asset or work order had nowhere to post. This is
 * the same canonical pipeline with the destination supplied as a link target
 * instead of a path segment: park-or-reuse the bytes, attach every requested
 * target, and index only when the destination resolves to a namespace node
 * (chunks must carry a node id — a CMMS asset or work order has none, so such a
 * file is retained as "stored" until it is also filed at a node).
 *
 * Multipart fields:
 *   file     required
 *   targets  optional JSON array of {targetType,targetId,role?,displayLabel?,isPrimary?}
 *
 * Unknown MIME types are retained (normalized to application/octet-stream), never
 * executed, never indexed. The only hard rejections are a missing file field and
 * the size limit — a maintenance workspace must be able to keep a PLC backup.
 */
const KNOWN_MIME_PREFIXES = [
  "application/pdf",
  "image/",
  "text/",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.",
];

export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field is required" }, { status: 422 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `file exceeds ${MAX_UPLOAD_MB} MB limit` },
      { status: 413 },
    );
  }

  let targets: AttachTarget[] = [];
  const rawTargets = form.get("targets");
  if (typeof rawTargets === "string" && rawTargets.trim()) {
    try {
      const parsed = JSON.parse(rawTargets);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      // Trust is SERVER-owned (Codex P1, 2026-08-16): rebuild each target from
      // only the fields a client may set. matchState / matchEvidence are
      // DROPPED — a public attach is a user action, so upsertNotebookSourceTx's
      // "user_confirmed" default stands; a client can never mint "verified"
      // (server-earned) or inject provenance evidence.
      targets = [];
      for (const raw of parsed as Record<string, unknown>[]) {
        if (!raw || !isLinkTargetType(raw.targetType) || typeof raw.targetId !== "string") {
          return NextResponse.json({ error: "invalid_target_type" }, { status: 422 });
        }
        targets.push({
          targetType: raw.targetType,
          targetId: raw.targetId,
          role: typeof raw.role === "string" ? raw.role : null,
          displayLabel: typeof raw.displayLabel === "string" ? raw.displayLabel : null,
          isPrimary: raw.isPrimary === true,
        });
      }
    } catch {
      return NextResponse.json({ error: "invalid_targets" }, { status: 422 });
    }
  }

  const declaredMime = file.type || "application/octet-stream";
  const mimeRaw = KNOWN_MIME_PREFIXES.some((p) => declaredMime.startsWith(p))
    ? declaredMime
    : "application/octet-stream";
  const lower = file.name.toLowerCase();
  const isPdf = mimeRaw === "application/pdf" || lower.endsWith(".pdf");
  const isText =
    mimeRaw.startsWith("text/plain") || lower.endsWith(".txt") || lower.endsWith(".md");

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    // Park FIRST — the workspace never loses a file it accepted, even if the
    // attach or the indexing below fails.
    const park = await parkOrReuseFile({
      tenantId: ctx.tenantId,
      filename: file.name,
      mimeType: mimeRaw,
      sizeBytes: file.size,
      buffer,
      createdBy: ctx.userId,
    });

    if (targets.length > 0) {
      const attached = await attachFileToTargets(ctx.tenantId, park.fileId, targets, {
        createdBy: ctx.userId,
      });
      if (!attached.ok) {
        // The bytes are already safe; report the destination problem honestly.
        return NextResponse.json(
          { ok: true, indexed: false, fileId: park.fileId, error: attached.error },
          { status: 404 },
        );
      }
    }

    // Exact-byte reuse of an already-parsed file: return the existing document.
    // Never re-parse, re-chunk, or re-embed.
    if (park.reused && park.uploadId) {
      return NextResponse.json(
        {
          ok: true,
          indexed: true,
          duplicate: true,
          fileId: park.fileId,
          uploadId: park.uploadId,
          file: { id: park.fileId, filename: file.name, size_bytes: file.size },
        },
        { status: 200 },
      );
    }

    // Indexing needs a node to stamp chunks with. Resolve one from the requested
    // destinations: a namespace node directly, or a notebook's backing node.
    let nodeId: string | null = null;
    const nodeTarget = targets.find((t) => t.targetType === "namespace_node");
    const notebookTarget = targets.find((t) => t.targetType === "equipment_notebook");
    if (nodeTarget) {
      nodeId = nodeTarget.targetId;
    } else if (notebookTarget) {
      nodeId = await withTenantContext(ctx.tenantId, async (c) => {
        const r = await c.query<{ node_id: string }>(
          `SELECT node_id::text AS node_id FROM equipment_notebooks
            WHERE tenant_id = $1::uuid AND id = $2::uuid`,
          [ctx.tenantId, notebookTarget.targetId],
        );
        return r.rows[0]?.node_id ?? null;
      });
    }

    const capability = fileCapability(mimeRaw, file.name);
    if (nodeId && (isPdf || isText)) {
      // Atomic ingestion claim (Codex round 2, 2026-08-16): the same
      // check-then-ingest race the confirm route had — a concurrent identical
      // upload could double-ingest into hub_uploads + knowledge_entries. One
      // writer claims; a loser reuses the finished doc or reports in-progress.
      const claim = await claimIngest(ctx.tenantId, park.fileId);
      if (!claim.claimed) {
        if (claim.reason === "already_ingested" && claim.uploadId) {
          return NextResponse.json(
            { ok: true, indexed: true, duplicate: true, fileId: park.fileId, uploadId: claim.uploadId },
            { status: 200 },
          );
        }
        return NextResponse.json(
          { ok: true, indexed: false, fileId: park.fileId, indexing: true },
          { status: 202 },
        );
      }
      try {
        const unsPath = await withTenantContext(ctx.tenantId, async (c) => {
          const r = await c.query<{ uns_path: string | null }>(
            `SELECT uns_path::text AS uns_path FROM kg_entities
              WHERE id = $1::uuid AND tenant_id = $2::uuid`,
            [nodeId, ctx.tenantId],
          );
          return r.rows[0]?.uns_path ?? null;
        });
        const ingest = isPdf ? ingestPdfToNode : ingestTextToNode;
        const { uploadId, chunkCount } = await ingest({
          tenantId: ctx.tenantId,
          nodeId,
          unsPath,
          filename: file.name,
          mimeType: mimeRaw,
          sizeBytes: file.size,
          buffer,
        });
        const won = await linkFileToUpload(ctx.tenantId, park.fileId, uploadId, claim.claimToken);
        if (!won) {
          // Claim stolen mid-ingest — our doc is orphaned; remove its duplicate
          // chunk set (best-effort) and report indexing so the client
          // re-fetches the winner's result rather than a duplicate.
          await deleteOrphanNodeIngest(ctx.tenantId, uploadId);
          return NextResponse.json(
            { ok: true, indexed: false, fileId: park.fileId, indexing: true },
            { status: 202 },
          );
        }
        return NextResponse.json(
          {
            ok: true,
            indexed: true,
            fileId: park.fileId,
            uploadId,
            chunkCount,
            file: { id: park.fileId, filename: file.name, size_bytes: file.size, capability },
          },
          { status: 201 },
        );
      } catch (err) {
        await releaseIngestClaim(ctx.tenantId, park.fileId, claim.claimToken).catch(() => {});
        // The original is parked and filed — an indexing failure must not lose it.
        console.error("[api/files POST] ingest failed (file kept)", err);
        return NextResponse.json(
          {
            ok: true,
            indexed: false,
            fileId: park.fileId,
            warning:
              /no extractable text/i.test((err as Error)?.message ?? "")
                ? "This PDF has no extractable text — it appears to be scanned or image-only. It's kept and viewable, but can't be searched in chat."
                : "Saved, but this file couldn't be indexed for chat.",
            file: { id: park.fileId, filename: file.name, size_bytes: file.size, capability },
          },
          { status: 201 },
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        indexed: false,
        fileId: park.fileId,
        file: { id: park.fileId, filename: file.name, size_bytes: file.size, capability },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/files POST]", err);
    return NextResponse.json({ error: "Couldn't save this file." }, { status: 500 });
  }
}
