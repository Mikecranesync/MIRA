// mira-hub/src/lib/upload-buffer.ts
//
// Persists local-upload bytes to disk keyed by upload id so a FAILED local
// upload can be retried without the user re-picking the file (2026-06-06).
//
// Lifecycle: handleLocalUpload writes the buffer before the ingest attempt,
// deletes it on success, and KEEPS it on failure. /api/uploads/:id/retry reads
// it back. A best-effort sweep prunes buffers older than MAX_AGE so terminal
// failures the user never retries don't accumulate.
//
// Cloud (Google/Dropbox) uploads do NOT use this — they re-fetch from source.

import { mkdir, writeFile, readFile, unlink, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUFFER_DIR =
  process.env.UPLOAD_BUFFER_DIR && process.env.UPLOAD_BUFFER_DIR.length > 0
    ? process.env.UPLOAD_BUFFER_DIR
    : join(tmpdir(), "mira-upload-buffers");

// Prune buffers older than this on the next sweep. Generous so a user has time
// to come back and retry a failed upload, but bounded so disk doesn't grow.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// uploadId is a UUID from gen_random_uuid(); validate before using it in a path.
const ID_RE = /^[0-9a-f-]{36}$/i;

function safePath(uploadId: string): string {
  if (!ID_RE.test(uploadId)) throw new Error(`invalid upload id for buffer path: ${uploadId}`);
  return join(BUFFER_DIR, `${uploadId}.bin`);
}

/** Persist the upload bytes. Best-effort: a write failure must not fail the
 *  upload itself (the ingest attempt proceeds from the in-memory buffer). */
export async function saveUploadBuffer(uploadId: string, bytes: Uint8Array): Promise<void> {
  try {
    await mkdir(BUFFER_DIR, { recursive: true });
    await writeFile(safePath(uploadId), bytes);
    void sweepOldBuffers();
  } catch (err) {
    console.warn("[upload-buffer] save failed (retry will be unavailable)", {
      uploadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Read a persisted buffer, or null if it doesn't exist (already cleaned up,
 *  or never saved — e.g. cloud upload or an older row predating this feature). */
export async function readUploadBuffer(uploadId: string): Promise<Uint8Array | null> {
  try {
    const p = safePath(uploadId);
    if (!existsSync(p)) return null;
    return new Uint8Array(await readFile(p));
  } catch {
    return null;
  }
}

/** Delete a persisted buffer. Best-effort — missing file is fine. */
export async function deleteUploadBuffer(uploadId: string): Promise<void> {
  try {
    await unlink(safePath(uploadId));
  } catch {
    // already gone / never existed — fine
  }
}

let sweeping = false;
/** Best-effort prune of buffers older than MAX_AGE_MS. Runs at most once at a
 *  time; never throws. */
async function sweepOldBuffers(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const entries = await readdir(BUFFER_DIR).catch(() => [] as string[]);
    const now = Date.now();
    for (const name of entries) {
      if (!name.endsWith(".bin")) continue;
      const p = join(BUFFER_DIR, name);
      try {
        const s = await stat(p);
        if (now - s.mtimeMs > MAX_AGE_MS) await unlink(p);
      } catch {
        // race with another delete — ignore
      }
    }
  } finally {
    sweeping = false;
  }
}
