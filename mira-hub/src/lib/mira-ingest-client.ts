// mira-hub/src/lib/mira-ingest-client.ts
import { sniffMime, isMimeCompatible } from "./sniff-mime";
import { composeTimeout, isAbortError } from "./abort-helpers";

const INGEST_TIMEOUT_MS = 120_000; // mira-ingest can poll OpenWebUI for ~40s+ on large PDFs

export class MimeMismatchError extends Error {
  declared: string;
  sniffed: string | null;
  constructor(declared: string, sniffed: string | null) {
    super(`content_does_not_match_declared_mime: declared=${declared} sniffed=${sniffed}`);
    this.name = "MimeMismatchError";
    this.declared = declared;
    this.sniffed = sniffed;
  }
}

export interface IngestResult {
  status: string;
  fileId: string | null;
  chunkCount: number | null;
  processingStatus: string | null;
}

export interface PhotoIngestResult {
  status: string;
  photoId: number | null;
  description: string | null;
  assetTag: string | null;
  photoPath: string | null;
}

const MAX_BYTES = 20 * 1024 * 1024;

async function streamToBlob(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      throw new Error(`file exceeds 20 MB limit (${(total / 1024 / 1024).toFixed(1)} MB)`);
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], { type: mimeType });
}

/**
 * Read the first bytes of a Blob and reject if they don't match the
 * declared MIME's general category. Throws MimeMismatchError on rejection
 * so the upload pipeline can mark the row failed with a clear reason.
 */
async function assertMimeMatchesBlob(blob: Blob, declared: string): Promise<void> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const sniffed = sniffMime(head);
  if (!isMimeCompatible(declared, sniffed)) {
    throw new MimeMismatchError(declared, sniffed);
  }
}

/**
 * PDF / document path — POSTs to mira-ingest `/ingest/document-kb`.
 *
 * `requestId` is propagated as `X-Request-Id` so mira-ingest logs the same
 * id and the full upload can be correlated across hub → ingest → OpenWebUI.
 */
export async function forwardToIngest(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  mimeType: string,
  opts: { requestId?: string; signal?: AbortSignal } = {},
): Promise<IngestResult> {
  const base = process.env.INGEST_URL;
  if (!base) throw new Error("INGEST_URL not set");

  const blob = await streamToBlob(stream, mimeType);
  await assertMimeMatchesBlob(blob, mimeType);

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("filename", filename);

  const headers: Record<string, string> = {};
  if (opts.requestId) headers["X-Request-Id"] = opts.requestId;

  let res: Response;
  try {
    res = await fetch(`${base}/ingest/document-kb`, {
      method: "POST",
      body: form,
      headers,
      signal: composeTimeout(opts.signal, INGEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (isAbortError(err)) throw new Error(`timeout: mira-ingest document-kb (${INGEST_TIMEOUT_MS}ms)`);
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`ingest ${res.status}: ${json.detail ?? res.statusText}`);
  }
  return {
    status: json.status ?? "ok",
    fileId: json.file_id ?? null,
    chunkCount: typeof json.chunk_count === "number" ? json.chunk_count : null,
    processingStatus: json.processing_status ?? null,
  };
}

/**
 * Photo path — POSTs to mira-ingest `/ingest/photo`. Field name is `image`
 * (not `file`), and `asset_tag` is required — when the user didn't pick an
 * asset we send "unassigned" so the photo still gets sanitized, captioned,
 * and embedded, and can be linked to an asset later from the asset page.
 */
export async function forwardToPhotoIngest(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  mimeType: string,
  opts: {
    assetTag?: string | null;
    notes?: string;
    location?: string;
    requestId?: string;
    signal?: AbortSignal;
  } = {},
): Promise<PhotoIngestResult> {
  const base = process.env.INGEST_URL;
  if (!base) throw new Error("INGEST_URL not set");

  const blob = await streamToBlob(stream, mimeType);
  await assertMimeMatchesBlob(blob, mimeType);

  const form = new FormData();
  form.append("image", blob, filename);
  form.append(
    "asset_tag",
    opts.assetTag && opts.assetTag.length > 0 ? opts.assetTag : "unassigned",
  );
  form.append("location", opts.location ?? "");
  form.append("notes", opts.notes ?? "");

  const headers: Record<string, string> = {};
  if (opts.requestId) headers["X-Request-Id"] = opts.requestId;

  let res: Response;
  try {
    res = await fetch(`${base}/ingest/photo`, {
      method: "POST",
      body: form,
      headers,
      signal: composeTimeout(opts.signal, INGEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (isAbortError(err)) throw new Error(`timeout: mira-ingest photo (${INGEST_TIMEOUT_MS}ms)`);
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`photo ingest ${res.status}: ${json.detail ?? res.statusText}`);
  }
  return {
    status: "ok",
    photoId: typeof json.id === "number" ? json.id : null,
    description: json.description ?? null,
    assetTag: json.asset_tag ?? null,
    photoPath: json.photo_path ?? null,
  };
}

export function inferKindFromMime(mime: string | null | undefined): "document" | "photo" {
  if (!mime) return "document";
  if (mime.startsWith("image/")) return "photo";
  return "document";
}

export const SUPPORTED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const SUPPORTED_MIMES = new Set<string>([
  "application/pdf",
  ...SUPPORTED_IMAGE_MIMES,
]);
