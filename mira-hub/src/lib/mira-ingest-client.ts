// mira-hub/src/lib/mira-ingest-client.ts
export interface IngestResult {
  status: string;
  fileId: string | null;
  chunkCount: number | null;
  processingStatus: string | null;
}

export async function forwardToIngest(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<IngestResult> {
  const base = process.env.INGEST_URL;
  if (!base) throw new Error("INGEST_URL not set");

  // Consume the stream into a Blob for multipart upload. mira-ingest's
  // /ingest/document-kb endpoint expects multipart/form-data with a
  // single `file` field (+ optional `filename`).
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let total = 0;
  const MAX = 20 * 1024 * 1024;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX) {
      throw new Error(`file exceeds 20 MB limit (${(total / 1024 / 1024).toFixed(1)} MB)`);
    }
    chunks.push(value);
  }
  const blob = new Blob(chunks as BlobPart[], { type: mimeType });

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("filename", filename);

  const res = await fetch(`${base}/ingest/document-kb`, {
    method: "POST",
    body: form,
    signal,
  });
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
