// mira-hub/src/lib/upload-pipeline.ts
//
// Background ingest pipeline shared by the cloud upload route (#697 #698 #699
// #700 etc.) and the manual retry endpoint (#704).
//
// Used to be wrapped in `after()` from "next/server", but Next.js 16
// standalone throws ENVIRONMENT_FALLBACK and the callback never runs.
// mira-hub runs as a long-lived standalone server, so a plain
// fire-and-forget Promise stays alive until it resolves.

import { ensureFreshAccessToken } from "@/lib/token-refresh";
import {
  streamFromGoogleDrive,
  streamFromSignedUrl,
} from "@/lib/fetch-adapters";
import {
  forwardToIngest,
  forwardToPhotoIngest,
} from "@/lib/mira-ingest-client";
import { makeUploadLogger } from "@/lib/upload-log";
import { setUploadContentSha256, updateUploadStatus, type Upload, type UploadKind } from "@/lib/uploads";
import { isMimeCompatible, sniffMime } from "@/lib/sniff-mime";
import { runWorkflow } from "@/lib/workflow";
import { createHash } from "node:crypto";
import { isV2Document, writeDocumentToInbox } from "@/lib/local-upload";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { WORKFLOW_VERSIONS } from "@/lib/workflow-versions";

export interface PipelineInput {
  uploadId: string;
  tenantId: string;
  requestId: string;
  provider: "google" | "dropbox";
  externalFileId: string | null;
  externalDownloadUrl: string | null;
  filename: string;
  mimeType: string;
  kind: UploadKind;
  assetTag: string | null;
}

/**
 * Build a PipelineInput from a stored Upload row — used by the retry path
 * (#704) where we don't have the original CreatePayload.
 */
export function pipelineInputFromRow(row: Upload, requestId: string): PipelineInput {
  if (row.provider === "local") {
    throw new Error("local uploads cannot be retried server-side — buffer is gone");
  }
  return {
    uploadId: row.id,
    tenantId: row.tenantId,
    requestId,
    provider: row.provider,
    externalFileId: row.externalFileId,
    externalDownloadUrl: row.externalDownloadUrl,
    filename: row.filename,
    mimeType: row.mimeType ?? "application/pdf",
    kind: row.kind,
    assetTag: row.assetTag,
  };
}

export async function runIngestPipeline(input: PipelineInput): Promise<void> {
  const { uploadId, tenantId, requestId, provider, kind, filename, mimeType, assetTag } = input;
  const log = makeUploadLogger({ requestId, uploadId, tenantId });

  // Wrap the existing pipeline in a durable run record (migration 044) without
  // changing any of its hub_uploads transitions or its fire-and-forget contract.
  // idempotencyKey ties a retry (#704) to the same run row (bumps retry_count)
  // instead of creating a second row. The workflow_runs write is fail-open: if
  // NeonDB is down the wrapper degrades to a log line and ingest still runs.
  try {
    await runWorkflow(
      {
        workflowName: "document_ingest",
        version: WORKFLOW_VERSIONS.document_ingest,
        tenantId,
        input: { uploadId, provider, kind, filename, mimeType, assetTag, requestId },
        idempotencyKey: `ingest:${uploadId}`,
      },
      async (run) => {
        try {
          const fetched = await run.step(
            "fetch",
            async () => {
              await updateUploadStatus(uploadId, tenantId, "fetching");
              log.log("fetching", { provider });
              if (provider === "google") {
                if (!input.externalFileId) throw new Error("google upload missing externalFileId");
                const { accessToken } = await ensureFreshAccessToken("google", tenantId);
                return streamFromGoogleDrive(input.externalFileId, accessToken);
              }
              if (!input.externalDownloadUrl)
                throw new Error("dropbox upload missing externalDownloadUrl");
              return streamFromSignedUrl(input.externalDownloadUrl);
            },
            { artifact: (f) => ({ contentType: f.contentType }) },
          );

          await run.step(
            "parse_store",
            async () => {
              await updateUploadStatus(uploadId, tenantId, "parsing");
              const mime = mimeType ?? fetched.contentType;
              log.log("parsing", { mimeType: mime });

              if (kind === "photo") {
                const result = await forwardToPhotoIngest(fetched.stream, filename, mime, {
                  assetTag,
                  requestId,
                });
                await updateUploadStatus(uploadId, tenantId, "parsed", result.description ?? null, {
                  kbFileId: result.photoId != null ? String(result.photoId) : undefined,
                });
                log.log("parsed", { photoId: result.photoId, kind });
                run.setOutput({ kind, photoId: result.photoId ?? null });
                return { kbFileId: result.photoId != null ? String(result.photoId) : null };
              }

              // #1806 — a Drive/Dropbox document becomes CITABLE the same way a
              // local one does: the v2 Inbox writer (knowledge_entries,
              // is_private=true). This path used to forward to the Open WebUI KB
              // only, which chat never reads and prod no longer runs.
              if (isV2Document(kind, mime)) {
                const buffer = await readAllCapped(fetched.stream, MAX_UPLOAD_BYTES);
                // The declared MIME must match the fetched bytes — the same check
                // the legacy forward and the local door make (#4088 review F3).
                if (!isMimeCompatible(mime, sniffMime(buffer.subarray(0, 16)))) {
                  throw new Error(`file content does not match its declared type (${mime})`);
                }
                const contentSha256 = createHash("sha256").update(buffer).digest("hex");
                // Persist the hash so a later identical upload is recognised (F4).
                await setUploadContentSha256(uploadId, tenantId, contentSha256);
                // No legacy fallback (F2): the Open WebUI store is not citable, so
                // "parsed" there would be a false success that blocks re-pick and
                // retry. A writer failure fails the upload; the retry endpoint and
                // a re-pick (#4085) can then run the v2 write again.
                await writeDocumentToInbox({ tenantId, uploadId, filename, mime, buffer, contentSha256, log });
                run.setOutput({ kind, route: "v2" });
                return { kbFileId: null, kbChunkCount: null };
              }

              const result = await forwardToIngest(fetched.stream, filename, mime, { requestId });
              await updateUploadStatus(uploadId, tenantId, "parsed", null, {
                kbFileId: result.fileId ?? undefined,
                kbChunkCount: result.chunkCount ?? undefined,
              });
              log.log("parsed", { kind, kbFileId: result.fileId, kbChunkCount: result.chunkCount });
              run.setOutput({
                kind,
                kbFileId: result.fileId ?? null,
                kbChunkCount: result.chunkCount ?? null,
              });
              return { kbFileId: result.fileId ?? null, kbChunkCount: result.chunkCount ?? null };
            },
            { artifact: (r) => r },
          );
        } catch (err) {
          // Preserve the original failure handling (hub_uploads → failed), then
          // re-throw so the run record is marked failed too.
          log.error("failed", err);
          await updateUploadStatus(uploadId, tenantId, "failed", (err as Error).message);
          throw err;
        }
      },
    );
  } catch {
    // The failure was already surfaced (hub_uploads + workflow_runs + logs)
    // inside the body. Swallow here so the fire-and-forget Promise never rejects.
  }
}

/** Read a fetched body fully, refusing one larger than the upload cap. */
export async function readAllCapped(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`file exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit`);
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}
