/**
 * Verbatim on-screen text from a LOOK photo (spec 2026-10-12-alarm-reasoning-design.md §4).
 * Stored in the photo's own evidence_item.capture_meta as `screen_text_lines` — the
 * same JSONB where LOOK's hazards live — so a later turn reads it without re-sending
 * the photo to a model (materialized-evidence rules 1, 3, 14). Server-written only;
 * never accepted from a client. src/lib is frozen, so this lives here and merges
 * into the row recordLookObservation just inserted.
 */
import { withTenantContext } from "@/lib/tenant-context";

// Structural, like visual-evidence-context.ts: a pg PoolClient satisfies it.
type QueryClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

export const MAX_SCREEN_LINES = 80;
export const MAX_SCREEN_LINE_CHARS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeScreenTextLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const clean = item.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    // A line cut by our own cap ends in "…" so it reads as cut off, never as complete
    // (review #4389 r5) — the parser treats a trailing "…" as could-not-read.
    const line = clean.length > MAX_SCREEN_LINE_CHARS ? `${clean.slice(0, MAX_SCREEN_LINE_CHARS - 1)}…` : clean;
    if (line) out.push(line);
    if (out.length >= MAX_SCREEN_LINES) break;
  }
  return out;
}

export async function attachScreenTextLines(
  tenantId: string,
  evidenceId: string,
  lines: readonly string[],
): Promise<boolean> {
  if (lines.length === 0 || !UUID_RE.test(evidenceId)) return false;
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `UPDATE evidence_item
          SET capture_meta = coalesce(capture_meta, '{}'::jsonb) || jsonb_build_object('screen_text_lines', $3::jsonb)
        WHERE tenant_id = $1 AND evidence_id = $2::uuid`,
      [tenantId, evidenceId, JSON.stringify(lines)],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

/**
 * The lines stored for ONE photo: the verified LOOK row's session AND the photo's file id.
 * Binding to the file id means another photo's text can never be read as this photo's
 * (review #4389 r6), even if a session ever held more than one evidence row.
 */
export async function loadScreenTextLines(
  c: QueryClient,
  tenantId: string,
  sessionId: string,
  fileId: string,
): Promise<string[] | null> {
  if (!UUID_RE.test(sessionId) || !UUID_RE.test(fileId)) return null;
  const res = await c.query(
    `SELECT capture_meta->'screen_text_lines' AS lines
       FROM evidence_item
      WHERE tenant_id = $1 AND session_id = $2::uuid
        AND capture_meta->>'file_id' = $3
        AND capture_meta ? 'screen_text_lines'
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, sessionId, fileId],
  );
  const lines = normalizeScreenTextLines(res.rows[0]?.lines);
  return lines.length > 0 ? lines : null;
}
