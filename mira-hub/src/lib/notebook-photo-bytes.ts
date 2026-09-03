/**
 * NOTEBOOK PHOTO BYTES — the missing primitive between "this notebook has a
 * picture attached" (proved by `photo-source-honesty.ts`) and "a vision model
 * may look at it right now".
 *
 * The chat route already knows how to VERIFY a photo (Sensor LOOK calls
 * `photoLinkedToTarget`), and the byte-serving viewer already knows how to READ
 * a photo's bytes (`/api/namespace/files/[id]`). Nothing joined the two: there
 * was no way to say "authorize this file for this notebook, then hand me its
 * bytes". This module is exactly that join and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS SIX GATES AND NOT ONE QUERY
 *
 * These bytes leave the building. They are base64'd into a request body sent to
 * a third-party inference provider. An authorization mistake here does not leak
 * a row — it ships one customer's photograph of their control panel into
 * another customer's answer. So every gate below returns `null` SILENTLY: no
 * throw, no 4xx, no distinguishable branch a caller could turn into an
 * existence oracle for another tenant's file ids.
 *
 * 1. `photoLinkedToTarget` — REUSED VERBATIM from `workspace-files.ts`, never
 *    forked, never inlined, never widened. It is the SOLE authorization path:
 *    tenant ∧ link-to-this-target ∧ `role='photo'` ∧ viewable-raster MIME ∧
 *    UUID shape. A second predicate written here would be a second thing to
 *    keep correct, and the one that drifts is the one that leaks.
 *
 * 2. A SEPARATE byte query, with its OWN explicit tenant predicate and a SQL
 *    size rejection. Two queries rather than one, deliberately:
 *      · Widening `photoLinkedToTarget`'s SELECT to carry `content` would drag
 *        up to 8 MB out of Postgres on every Sensor-LOOK membership check,
 *        which needs no bytes at all.
 *      · Its own `tenant_id = $2::uuid` because A RESOLVED FILE ID IS NEVER A
 *        TENANT PROOF here: `equipment_notebook_sources.origin_file_id` is
 *        `REFERENCES namespace_direct_uploads(id)` with no tenant component,
 *        and `listSources`' doc join runs on the raw owner pool. The id that
 *        reaches this function came through those paths.
 *      · `octet_length(content) <= $3` rejects in SQL, so oversized bytes never
 *        cross the wire into Node's heap. The stored `size_bytes` column is NOT
 *        trusted for this — it is what the uploader claimed, not what is stored.
 *
 * 3. `fileCapability` re-asserted on the BYTE row (the row that actually
 *    produced the buffer), not only on the link row.
 *
 * 4. MAGIC BYTES, and the SNIFF WINS. This is load-bearing, not belt-and-braces:
 *    `role` on an attach request (`api/files/route.ts`) is client-supplied and
 *    unvalidated, so "this is a photograph" is an ASSERTION MADE BY A CLIENT
 *    within its own tenant. Declared MIME is another such assertion. The bytes
 *    are the only thing nobody merely claimed. A file whose header is not one
 *    of the four safelisted rasters is refused however it is labelled.
 *
 *    DELIBERATE DIVERGENCE FROM `effectiveImageMime`: that helper lets a
 *    DECLARED safelisted type win without sniffing, which is correct for its
 *    job (an intake door that must not 415 a real JPEG a mobile picker
 *    mislabelled). Here the risk runs the other way — a declared `image/jpeg`
 *    whose bytes are a PDF must be REFUSED, not forwarded to a provider. So
 *    this module sniffs first and requires the SNIFFED type to be on the
 *    safelist. Never relax this to a declared-MIME check.
 *
 * 5. `capturedAt` comes from `linked.capturedAt` — server-derived from the
 *    stored file row, never from a client.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE LEG THIS MODULE CANNOT PROVE — READ BEFORE CALLING
 *
 * `photoLinkedToTarget` never reads `equipment_notebooks`. It proves the FILE
 * belongs to the tenant and is linked to `targetId` as a photo; it does NOT
 * prove that `targetId` (the notebook) belongs to the caller. Callers MUST have
 * established notebook ownership upstream. On the notebook chat route that is
 * `validateChatSources` (tenant_id AND notebook_id AND match_state IN
 * ('user_confirmed','verified') AND enabled_by_default AND superseded_at IS
 * NULL) — which is precisely why the re-read trigger requires `validated.ok`.
 */
import { withTenantContext } from "@/lib/tenant-context";
import {
  fileCapability,
  photoLinkedToTarget,
  VIEWABLE_IMAGE_MIMES,
  type LinkTargetType,
} from "@/lib/workspace-files";
import { sniffImageMime } from "@/lib/nameplate/image-mime";

export type LinkedPhotoBytes = {
  fileId: string;
  buffer: Buffer;
  /** The SNIFFED mime — what the bytes actually are, not what they claimed. */
  mimeType: string;
  filename: string | null;
  /** Server-derived from the stored file row (never a client's timestamp). */
  capturedAt: string;
};

type ByteRow = { filename: string | null; mime_type: string | null; content: unknown };

/**
 * Authorize ONE file for ONE target, then return its bytes — or `null`.
 *
 * Every failure mode is the same `null`: foreign tenant, wrong link role, wrong
 * target, non-raster MIME, mislabelled bytes, missing bytes, oversized bytes,
 * malformed id. Callers must treat `null` as "no photo to read" and degrade to
 * their honest text-only behaviour; they must never surface it as an error that
 * distinguishes "not yours" from "too big".
 */
export async function readLinkedPhotoBytes(
  tenantId: string,
  fileId: string,
  targetType: LinkTargetType,
  targetId: string,
  maxBytes: number,
): Promise<LinkedPhotoBytes | null> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return null;

  // GATE 1 — the sole authorization path. Not forked, not inlined, not widened.
  // It runs FIRST, so an unauthorized id never reaches the byte query at all.
  const linked = await photoLinkedToTarget(tenantId, fileId, targetType, targetId);
  if (!linked) return null;

  // GATE 2 — separate byte read, own tenant predicate, SQL-side size rejection.
  const row = await withTenantContext(tenantId, async (c) => {
    const r = await c.query<ByteRow>(
      `SELECT filename, mime_type, content
         FROM namespace_direct_uploads
        WHERE id = $1::uuid AND tenant_id = $2::uuid
          AND octet_length(content) <= $3`,
      [linked.fileId, tenantId, Math.floor(maxBytes)],
    );
    return r.rows[0] ?? null;
  });
  if (!row || row.content == null) return null;

  // GATE 3 — capability re-asserted on the row that produced the buffer.
  if (fileCapability(row.mime_type, row.filename) !== "viewable") return null;

  const buffer = Buffer.isBuffer(row.content)
    ? row.content
    : Buffer.from(row.content as ArrayLike<number>);
  if (buffer.length === 0 || buffer.length > maxBytes) return null;

  // GATE 4 — the bytes are the only claim nobody made. The sniff wins.
  const sniffed = sniffImageMime(buffer);
  if (!sniffed || !VIEWABLE_IMAGE_MIMES.includes(sniffed)) return null;

  return {
    fileId: linked.fileId,
    buffer,
    mimeType: sniffed,
    filename: row.filename,
    // GATE 5 — server-derived capture time.
    capturedAt: linked.capturedAt,
  };
}
