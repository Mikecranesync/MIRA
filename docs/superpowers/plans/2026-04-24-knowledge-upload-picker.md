# Knowledge Upload Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Knowledge tab's Upload button to a standardized pick-from-anywhere flow — Google Picker API, Dropbox Chooser, and native file input — that pipes PDFs into the existing `mira-ingest/ingest/document-kb` pipeline and renders status per-file in the UI.

**Architecture:** Vendor-hosted browser pickers (Google Picker, Dropbox Chooser) emit file references to the Hub. Hub server fetches file bytes using stored encrypted tokens from `hub_channel_bindings` (Google: refresh-if-expired + authenticated download; Dropbox: use Chooser's short-lived signed URL — no token needed). Server writes one row per selection to `hub_uploads` state table, forwards bytes to mira-ingest, updates status. UI polls `/hub/api/uploads` every 2s while non-terminal rows exist.

**Tech Stack:** Next.js 16 (App Router, `@/lib` path alias) · Refine 5 · React 19 · Radix UI · Tailwind · `pg` against NeonDB · AES-256-GCM (node:crypto) · Google Picker API (`gapi.load('picker')`) · Dropbox Chooser (`dropins.js`) · Playwright E2E against prod.

---

## Spec

`docs/superpowers/specs/2026-04-24-knowledge-upload-picker-design.md` (committed 2026-04-24).

---

## File Structure

### Create

| Path | Responsibility |
|---|---|
| `mira-hub/src/lib/uploads.ts` | `hub_uploads` schema init + CRUD (createUpload, listUploads, updateStatus, markTerminal, getUpload, deleteUpload) |
| `mira-hub/src/lib/token-refresh.ts` | `ensureFreshAccessToken(provider, tenantId)` — decrypts stored access/refresh tokens, refreshes Google tokens via `oauth2.googleapis.com/token` if expiring within 5 min |
| `mira-hub/src/lib/fetch-adapters.ts` | `streamFromGoogleDrive(fileId, token)`, `streamFromSignedUrl(url)` — return `ReadableStream` ready to forward to mira-ingest |
| `mira-hub/src/lib/mira-ingest-client.ts` | `forwardToIngest(stream, filename, mime, sizeBytes)` → POSTs multipart to `INGEST_URL/ingest/document-kb`, returns `{status, file_id, chunk_count}` |
| `mira-hub/src/app/api/picker/google/token/route.ts` | GET → `{accessToken, apiKey, clientId, appId}` |
| `mira-hub/src/app/api/picker/dropbox/key/route.ts` | GET → `{appKey}` |
| `mira-hub/src/app/api/uploads/route.ts` | POST cloud source + GET list |
| `mira-hub/src/app/api/uploads/local/route.ts` | POST multipart for local files |
| `mira-hub/src/app/api/uploads/[id]/route.ts` | DELETE (cancel or remove-from-KB) |
| `mira-hub/src/components/UploadPicker.tsx` | Modal: drop zone + Google Picker trigger + Dropbox Chooser trigger |
| `mira-hub/src/components/UploadBlock.tsx` | One upload row with status variants (queued/fetching/parsing/parsed/failed) |
| `mira-hub/tests/e2e/knowledge-upload.spec.ts` | Playwright E2E: local upload round-trip |

### Modify

| Path | Change |
|---|---|
| `mira-hub/src/app/(hub)/knowledge/page.tsx` | Wire Upload button `onClick`, render `<UploadPicker />` when open, fetch `/uploads` on mount + poll every 2s while any non-terminal, render `<UploadBlock />`s above indexed-docs list |
| `mira-hub/src/lib/bindings.ts` | Export `getBindingRow(provider, tenantId)` (full row, not just token) for token-refresh helper |
| `mira-hub/package.json` | Version bump 1.1.0 → 1.2.0 (final task) |
| `docker-compose.saas.yml` | Add `GOOGLE_PICKER_API_KEY` + `GOOGLE_CLOUD_PROJECT_NUMBER` + `INGEST_URL` env vars to `mira-hub` service |

---

## Prerequisites (human, one-time)

Mike must do these before Task 10 (`UploadPicker.tsx`) can run successfully in prod. They can be staged during earlier tasks.

- [ ] **P1. Enable Google Picker API** in Google Cloud Console for the FactoryLM project: https://console.cloud.google.com/apis/library/picker.googleapis.com → **Enable**.
- [ ] **P2. Create Google API key** → https://console.cloud.google.com/apis/credentials → **+ Create credentials** → **API key**. Restrict it: **Application restrictions** = HTTP referrers → `https://app.factorylm.com/*`; **API restrictions** = Select API → Google Picker API only. Copy the key.
- [ ] **P3. Set Doppler secrets** in `factorylm/prd`:
  ```bash
  doppler secrets set GOOGLE_PICKER_API_KEY="<key from P2>" --project factorylm --config prd
  doppler secrets set GOOGLE_CLOUD_PROJECT_NUMBER="246891599587" --project factorylm --config prd
  doppler secrets set INGEST_URL="http://mira-ingest-saas:8001" --project factorylm --config prd
  ```

---

## Task 1: hub_uploads schema + uploads.ts CRUD

**Files:**
- Create: `mira-hub/src/lib/uploads.ts`

- [ ] **Step 1: Create `uploads.ts` with schema init + types**

```typescript
// mira-hub/src/lib/uploads.ts
import pool from "@/lib/db";
import { DEFAULT_TENANT_ID } from "@/lib/bindings";

export type UploadStatus =
  | "queued"
  | "fetching"
  | "parsing"
  | "parsed"
  | "failed"
  | "cancelled";

export type UploadProvider = "google" | "dropbox" | "local";

export interface Upload {
  id: string;
  tenantId: string;
  provider: UploadProvider;
  externalFileId: string | null;
  externalDownloadUrl: string | null;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  externalCreatedAt: string | null;
  status: UploadStatus;
  statusDetail: string | null;
  kbFileId: string | null;
  kbChunkCount: number | null;
  createdAt: string;
  updatedAt: string;
}

let schemaReady: Promise<void> | null = null;

export function ensureUploadsSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hub_uploads (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id             TEXT NOT NULL DEFAULT 'mike',
        provider              TEXT NOT NULL,
        external_file_id      TEXT,
        external_download_url TEXT,
        filename              TEXT NOT NULL,
        mime_type             TEXT,
        size_bytes            BIGINT,
        external_created_at   TIMESTAMPTZ,
        status                TEXT NOT NULL DEFAULT 'queued',
        status_detail         TEXT,
        kb_file_id            TEXT,
        kb_chunk_count        INTEGER,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hub_uploads_tenant_status
        ON hub_uploads (tenant_id, status, created_at DESC)
    `);
  })();
  return schemaReady;
}

export interface CreateUploadInput {
  tenantId?: string;
  provider: UploadProvider;
  externalFileId?: string | null;
  externalDownloadUrl?: string | null;
  filename: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  externalCreatedAt?: string | Date | null;
  initialStatus?: UploadStatus;
}

function rowToUpload(r: Record<string, unknown>): Upload {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    provider: r.provider as UploadProvider,
    externalFileId: (r.external_file_id as string | null) ?? null,
    externalDownloadUrl: (r.external_download_url as string | null) ?? null,
    filename: r.filename as string,
    mimeType: (r.mime_type as string | null) ?? null,
    sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    externalCreatedAt: (r.external_created_at as string | null) ?? null,
    status: r.status as UploadStatus,
    statusDetail: (r.status_detail as string | null) ?? null,
    kbFileId: (r.kb_file_id as string | null) ?? null,
    kbChunkCount: r.kb_chunk_count != null ? Number(r.kb_chunk_count) : null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export async function createUpload(input: CreateUploadInput): Promise<Upload> {
  await ensureUploadsSchema();
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const status = input.initialStatus ?? "queued";
  const createdAt =
    input.externalCreatedAt instanceof Date
      ? input.externalCreatedAt.toISOString()
      : (input.externalCreatedAt ?? null);

  const { rows } = await pool.query(
    `
    INSERT INTO hub_uploads
      (tenant_id, provider, external_file_id, external_download_url,
       filename, mime_type, size_bytes, external_created_at, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `,
    [
      tenantId,
      input.provider,
      input.externalFileId ?? null,
      input.externalDownloadUrl ?? null,
      input.filename,
      input.mimeType ?? null,
      input.sizeBytes ?? null,
      createdAt,
      status,
    ],
  );
  return rowToUpload(rows[0]);
}

export async function listUploads(tenantId = DEFAULT_TENANT_ID): Promise<Upload[]> {
  await ensureUploadsSchema();
  const { rows } = await pool.query(
    `
    SELECT * FROM hub_uploads
     WHERE tenant_id = $1
       AND (status != 'parsed' OR updated_at > NOW() - INTERVAL '24 hours')
       AND status != 'cancelled'
     ORDER BY created_at DESC
     LIMIT 50
  `,
    [tenantId],
  );
  return rows.map(rowToUpload);
}

export async function getUpload(
  id: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<Upload | null> {
  await ensureUploadsSchema();
  const { rows } = await pool.query(
    `SELECT * FROM hub_uploads WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [id, tenantId],
  );
  return rows[0] ? rowToUpload(rows[0]) : null;
}

export async function updateUploadStatus(
  id: string,
  status: UploadStatus,
  detail?: string | null,
  extras?: { kbFileId?: string; kbChunkCount?: number },
): Promise<void> {
  await pool.query(
    `
    UPDATE hub_uploads
       SET status = $2,
           status_detail = COALESCE($3, status_detail),
           kb_file_id = COALESCE($4, kb_file_id),
           kb_chunk_count = COALESCE($5, kb_chunk_count),
           updated_at = NOW()
     WHERE id = $1
  `,
    [id, status, detail ?? null, extras?.kbFileId ?? null, extras?.kbChunkCount ?? null],
  );
}

export async function deleteUpload(id: string, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM hub_uploads WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (rowCount ?? 0) > 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add mira-hub/src/lib/uploads.ts
git commit -m "feat(hub): hub_uploads schema + CRUD helpers for upload state"
```

---

## Task 2: Expose getBindingRow from bindings.ts

**Files:**
- Modify: `mira-hub/src/lib/bindings.ts` — add export

- [ ] **Step 1: Add `getBindingRow` to bindings.ts**

Open `mira-hub/src/lib/bindings.ts`. After the existing `getAccessToken` export, add:

```typescript
export interface BindingRow {
  provider: Provider;
  externalId: string | null;
  accessToken: string | null;   // decrypted
  refreshToken: string | null;  // decrypted
  tokenExpiresAt: Date | null;
  scopes: string[];
  meta: BindingMeta;
  status: "connected" | "revoked";
}

export async function getBindingRow(
  provider: Provider,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<BindingRow | null> {
  await ensureSchema();
  const { rows } = await pool.query(
    `
    SELECT provider, external_id, access_token_enc, refresh_token_enc,
           token_expires_at, scopes, meta, status
      FROM hub_channel_bindings
     WHERE tenant_id = $1 AND provider = $2 AND status = 'connected'
     LIMIT 1
  `,
    [tenantId, provider],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    provider: r.provider,
    externalId: r.external_id,
    accessToken: decrypt(r.access_token_enc),
    refreshToken: decrypt(r.refresh_token_enc),
    tokenExpiresAt: r.token_expires_at ? new Date(r.token_expires_at) : null,
    scopes: r.scopes ?? [],
    meta: r.meta ?? {},
    status: r.status,
  };
}
```

Also add an internal setter used by token-refresh after rotating a token:

```typescript
export async function updateAccessToken(
  provider: Provider,
  accessToken: string,
  tokenExpiresAt: Date,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<void> {
  await pool.query(
    `
    UPDATE hub_channel_bindings
       SET access_token_enc = $3,
           token_expires_at = $4,
           updated_at = NOW()
     WHERE tenant_id = $1 AND provider = $2
  `,
    [tenantId, provider, encrypt(accessToken), tokenExpiresAt.toISOString()],
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mira-hub/src/lib/bindings.ts
git commit -m "feat(hub): expose getBindingRow + updateAccessToken for token refresh"
```

---

## Task 3: Token refresh helper

**Files:**
- Create: `mira-hub/src/lib/token-refresh.ts`

- [ ] **Step 1: Write `ensureFreshAccessToken`**

```typescript
// mira-hub/src/lib/token-refresh.ts
import {
  getBindingRow,
  updateAccessToken,
  type Provider,
  DEFAULT_TENANT_ID,
} from "@/lib/bindings";

const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh if expiring within 5 minutes

export interface FreshToken {
  accessToken: string;
  expiresAt: Date;
}

export async function ensureFreshAccessToken(
  provider: Provider,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<FreshToken> {
  const row = await getBindingRow(provider, tenantId);
  if (!row) throw new Error(`No ${provider} binding for tenant ${tenantId}`);
  if (!row.accessToken) throw new Error(`${provider} binding has no access_token`);

  const now = Date.now();
  const expiresAt = row.tokenExpiresAt ?? new Date(now + 3600_000);
  const needsRefresh =
    row.tokenExpiresAt != null && row.tokenExpiresAt.getTime() - now < REFRESH_SKEW_MS;

  if (!needsRefresh) {
    return { accessToken: row.accessToken, expiresAt };
  }

  if (!row.refreshToken) {
    // No way to refresh — surface the stale-token error to the caller.
    throw new Error(`${provider} token expired and no refresh_token on record`);
  }

  if (provider === "google") {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: row.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(`google token refresh failed: ${json.error_description ?? json.error}`);
    }
    const newExpiresAt = new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000);
    await updateAccessToken(provider, json.access_token, newExpiresAt, tenantId);
    return { accessToken: json.access_token, expiresAt: newExpiresAt };
  }

  // Other providers: add when needed. For now treat as non-refreshable.
  return { accessToken: row.accessToken, expiresAt };
}
```

- [ ] **Step 2: Commit**

```bash
git add mira-hub/src/lib/token-refresh.ts
git commit -m "feat(hub): token-refresh helper — auto-refresh Google tokens near expiry"
```

---

## Task 4: Fetch adapters

**Files:**
- Create: `mira-hub/src/lib/fetch-adapters.ts`

- [ ] **Step 1: Write streamFromGoogleDrive + streamFromSignedUrl**

```typescript
// mira-hub/src/lib/fetch-adapters.ts
/**
 * Returns a Response object whose body is the file stream, plus parsed
 * metadata. Caller is responsible for forwarding the body to mira-ingest.
 */
export interface FetchedFile {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  sizeBytes: number | null;
}

export async function streamFromGoogleDrive(
  fileId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<FetchedFile> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId,
  )}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`drive fetch ${res.status}: ${body.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("drive response has no body");
  const lenHeader = res.headers.get("content-length");
  return {
    stream: res.body,
    contentType: res.headers.get("content-type") ?? "application/pdf",
    sizeBytes: lenHeader ? Number(lenHeader) : null,
  };
}

export async function streamFromSignedUrl(
  url: string,
  signal?: AbortSignal,
): Promise<FetchedFile> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`signed url fetch ${res.status}`);
  }
  if (!res.body) throw new Error("signed url response has no body");
  const lenHeader = res.headers.get("content-length");
  return {
    stream: res.body,
    contentType: res.headers.get("content-type") ?? "application/pdf",
    sizeBytes: lenHeader ? Number(lenHeader) : null,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add mira-hub/src/lib/fetch-adapters.ts
git commit -m "feat(hub): provider fetch adapters for Drive + signed-URL sources"
```

---

## Task 5: mira-ingest client

**Files:**
- Create: `mira-hub/src/lib/mira-ingest-client.ts`

- [ ] **Step 1: Write forwardToIngest**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add mira-hub/src/lib/mira-ingest-client.ts
git commit -m "feat(hub): mira-ingest multipart forwarder for document-kb route"
```

---

## Task 6: Picker credential endpoints

**Files:**
- Create: `mira-hub/src/app/api/picker/google/token/route.ts`
- Create: `mira-hub/src/app/api/picker/dropbox/key/route.ts`

- [ ] **Step 1: Google token endpoint**

```typescript
// mira-hub/src/app/api/picker/google/token/route.ts
import { NextResponse } from "next/server";
import { ensureFreshAccessToken } from "@/lib/token-refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const apiKey = process.env.GOOGLE_PICKER_API_KEY;
  const appId = process.env.GOOGLE_CLOUD_PROJECT_NUMBER;

  if (!clientId || !apiKey || !appId) {
    return NextResponse.json(
      {
        error: "google_picker_not_configured",
        missing: [
          !clientId && "GOOGLE_CLIENT_ID",
          !apiKey && "GOOGLE_PICKER_API_KEY",
          !appId && "GOOGLE_CLOUD_PROJECT_NUMBER",
        ].filter(Boolean),
      },
      { status: 503 },
    );
  }

  try {
    const { accessToken, expiresAt } = await ensureFreshAccessToken("google");
    return NextResponse.json({
      accessToken,
      apiKey,
      clientId,
      appId,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "no_google_binding", detail: (err as Error).message },
      { status: 412 }, // Precondition Failed — user must connect Google first
    );
  }
}
```

- [ ] **Step 2: Dropbox key endpoint**

```typescript
// mira-hub/src/app/api/picker/dropbox/key/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const appKey = process.env.DROPBOX_APP_KEY;
  if (!appKey) {
    return NextResponse.json({ error: "dropbox_not_configured" }, { status: 503 });
  }
  return NextResponse.json({ appKey });
}
```

- [ ] **Step 3: Commit**

```bash
git add mira-hub/src/app/api/picker
git commit -m "feat(hub): picker credential endpoints (Google token + Dropbox key)"
```

---

## Task 7: POST /uploads (cloud source) + GET /uploads

**Files:**
- Create: `mira-hub/src/app/api/uploads/route.ts`

- [ ] **Step 1: Write route**

```typescript
// mira-hub/src/app/api/uploads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  createUpload,
  listUploads,
  updateUploadStatus,
  type UploadProvider,
} from "@/lib/uploads";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import {
  streamFromGoogleDrive,
  streamFromSignedUrl,
} from "@/lib/fetch-adapters";
import { forwardToIngest } from "@/lib/mira-ingest-client";

export const dynamic = "force-dynamic";

interface CreatePayload {
  provider: UploadProvider;
  externalFileId?: string;
  externalDownloadUrl?: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  externalCreatedAt?: string;
}

export async function POST(req: NextRequest) {
  let body: CreatePayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.provider !== "google" && body.provider !== "dropbox") {
    return NextResponse.json(
      { error: "provider_must_be_google_or_dropbox" },
      { status: 400 },
    );
  }
  if (!body.filename) {
    return NextResponse.json({ error: "filename_required" }, { status: 400 });
  }
  if (body.mimeType && body.mimeType !== "application/pdf") {
    return NextResponse.json(
      { error: "only_pdf_supported", got: body.mimeType },
      { status: 400 },
    );
  }
  const MAX = 20 * 1024 * 1024;
  if (body.sizeBytes != null && body.sizeBytes > MAX) {
    return NextResponse.json(
      { error: "exceeds_20mb_limit", got: body.sizeBytes },
      { status: 400 },
    );
  }
  if (body.provider === "google" && !body.externalFileId) {
    return NextResponse.json({ error: "externalFileId_required_for_google" }, { status: 400 });
  }
  if (body.provider === "dropbox" && !body.externalDownloadUrl) {
    return NextResponse.json(
      { error: "externalDownloadUrl_required_for_dropbox" },
      { status: 400 },
    );
  }

  const upload = await createUpload({
    provider: body.provider,
    externalFileId: body.externalFileId ?? null,
    externalDownloadUrl: body.externalDownloadUrl ?? null,
    filename: body.filename,
    mimeType: body.mimeType ?? "application/pdf",
    sizeBytes: body.sizeBytes ?? null,
    externalCreatedAt: body.externalCreatedAt ?? null,
    initialStatus: "queued",
  });

  // Kick off the fetch+ingest in the background.
  after(() => runIngestPipeline(upload.id, body));

  return NextResponse.json(upload, { status: 201 });
}

export async function GET() {
  const rows = await listUploads();
  return NextResponse.json(rows);
}

async function runIngestPipeline(uploadId: string, payload: CreatePayload): Promise<void> {
  try {
    await updateUploadStatus(uploadId, "fetching");
    let fetched;
    if (payload.provider === "google") {
      const { accessToken } = await ensureFreshAccessToken("google");
      fetched = await streamFromGoogleDrive(payload.externalFileId!, accessToken);
    } else {
      fetched = await streamFromSignedUrl(payload.externalDownloadUrl!);
    }

    await updateUploadStatus(uploadId, "parsing");
    const result = await forwardToIngest(
      fetched.stream,
      payload.filename,
      payload.mimeType ?? fetched.contentType,
    );
    await updateUploadStatus(uploadId, "parsed", null, {
      kbFileId: result.fileId ?? undefined,
      kbChunkCount: result.chunkCount ?? undefined,
    });
  } catch (err) {
    console.error(`[uploads/${uploadId}] pipeline failed`, err);
    await updateUploadStatus(uploadId, "failed", (err as Error).message);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add mira-hub/src/app/api/uploads/route.ts
git commit -m "feat(hub): POST /uploads kicks off cloud-source ingest pipeline, GET lists rows"
```

---

## Task 8: POST /uploads/local (multipart)

**Files:**
- Create: `mira-hub/src/app/api/uploads/local/route.ts`

- [ ] **Step 1: Write route**

```typescript
// mira-hub/src/app/api/uploads/local/route.ts
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createUpload, updateUploadStatus } from "@/lib/uploads";
import { forwardToIngest } from "@/lib/mira-ingest-client";

export const dynamic = "force-dynamic";

const MAX = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_multipart" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_field_required" }, { status: 400 });
  }
  if (file.size > MAX) {
    return NextResponse.json({ error: "exceeds_20mb_limit", got: file.size }, { status: 400 });
  }
  const mime = file.type || "application/pdf";
  if (mime !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "only_pdf_supported", got: mime }, { status: 400 });
  }

  // Buffer the bytes up-front so the request handler can return before
  // mira-ingest finishes (via after()), without losing the stream.
  const buffer = new Uint8Array(await file.arrayBuffer());

  const upload = await createUpload({
    provider: "local",
    filename: file.name,
    mimeType: mime,
    sizeBytes: file.size,
    externalCreatedAt: new Date(file.lastModified),
    initialStatus: "parsing",
  });

  after(async () => {
    try {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(buffer);
          controller.close();
        },
      });
      const result = await forwardToIngest(stream, file.name, mime);
      await updateUploadStatus(upload.id, "parsed", null, {
        kbFileId: result.fileId ?? undefined,
        kbChunkCount: result.chunkCount ?? undefined,
      });
    } catch (err) {
      console.error(`[uploads/local/${upload.id}] failed`, err);
      await updateUploadStatus(upload.id, "failed", (err as Error).message);
    }
  });

  return NextResponse.json(upload, { status: 201 });
}
```

- [ ] **Step 2: Commit**

```bash
git add mira-hub/src/app/api/uploads/local/route.ts
git commit -m "feat(hub): POST /uploads/local — native file input → mira-ingest"
```

---

## Task 9: DELETE /uploads/[id]

**Files:**
- Create: `mira-hub/src/app/api/uploads/[id]/route.ts`

- [ ] **Step 1: Write route**

```typescript
// mira-hub/src/app/api/uploads/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getUpload, updateUploadStatus, deleteUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const TERMINAL: ReadonlyArray<string> = ["parsed", "failed", "cancelled"];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await getUpload(id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!TERMINAL.includes(row.status)) {
    // In-flight: mark cancelled. The pipeline writes terminal status
    // unconditionally if it finishes after we write cancelled; that's
    // acceptable — UI shows the latest status.
    await updateUploadStatus(id, "cancelled", "user cancelled");
    return NextResponse.json({ ok: true, action: "cancelled" });
  }

  if (row.status === "parsed" && row.kbFileId) {
    try {
      await deleteFromOpenWebUi(row.kbFileId);
    } catch (err) {
      console.error(`[uploads/${id}] OpenWebUI delete failed`, err);
      // proceed with row deletion — the orphaned KB file is a cleanup
      // task for a later sweep, not a blocker
    }
  }

  await deleteUpload(id);
  return NextResponse.json({ ok: true, action: "deleted" });
}

async function deleteFromOpenWebUi(fileId: string): Promise<void> {
  const base = process.env.OPENWEBUI_BASE_URL;
  const apiKey = process.env.OPENWEBUI_API_KEY;
  if (!base || !apiKey) return; // best-effort; skip if not configured
  const res = await fetch(`${base}/api/v1/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`openwebui delete ${res.status}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add "mira-hub/src/app/api/uploads/[id]/route.ts"
git commit -m "feat(hub): DELETE /uploads/:id — cancel non-terminal, remove KB file on parsed"
```

---

## Task 10: UploadBlock component

**Files:**
- Create: `mira-hub/src/components/UploadBlock.tsx`

- [ ] **Step 1: Write component**

```tsx
// mira-hub/src/components/UploadBlock.tsx
"use client";

import { useState } from "react";
import { X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export type UploadBlockData = {
  id: string;
  provider: "google" | "dropbox" | "local";
  filename: string;
  sizeBytes: number | null;
  externalCreatedAt: string | null;
  status: "queued" | "fetching" | "parsing" | "parsed" | "failed" | "cancelled";
  statusDetail: string | null;
  kbChunkCount: number | null;
};

const PROVIDER_LABEL: Record<UploadBlockData["provider"], string> = {
  google: "Google Drive",
  dropbox: "Dropbox",
  local: "This device",
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function UploadBlock({
  upload,
  onDelete,
}: {
  upload: UploadBlockData;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const parsed = upload.status === "parsed";
  const failed = upload.status === "failed";

  const statusLine = (() => {
    switch (upload.status) {
      case "queued":
        return { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, text: "Queued…", color: "var(--foreground-muted)" };
      case "fetching":
        return { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, text: `Fetching from ${PROVIDER_LABEL[upload.provider]}…`, color: "var(--foreground-muted)" };
      case "parsing":
        return { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, text: "Parsing to KB…", color: "var(--foreground-muted)" };
      case "parsed":
        return {
          icon: <CheckCircle2 className="w-3.5 h-3.5" />,
          text: `Parsed${upload.kbChunkCount != null ? ` · ${upload.kbChunkCount} chunks` : ""}`,
          color: "#16A34A",
        };
      case "failed":
        return {
          icon: <AlertCircle className="w-3.5 h-3.5" />,
          text: `Failed${upload.statusDetail ? `: ${upload.statusDetail}` : ""}`,
          color: "#DC2626",
        };
      case "cancelled":
        return { icon: null, text: "Cancelled", color: "var(--foreground-subtle)" };
    }
  })();

  return (
    <div
      className="card p-4 flex items-start gap-3"
      style={parsed ? { opacity: 0.6 } : failed ? { borderColor: "#DC262650" } : undefined}
    >
      <div
        className="flex-1 min-w-0"
        style={parsed ? { textDecoration: "line-through" } : undefined}
      >
        <p className="text-sm font-semibold leading-snug" style={{ color: "var(--foreground)" }}>
          {upload.filename}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
          {PROVIDER_LABEL[upload.provider]} · {formatSize(upload.sizeBytes)} · {formatDate(upload.externalCreatedAt)}
        </p>
        <div className="flex items-center gap-1.5 mt-2">
          {statusLine.icon}
          <span className="text-[11px]" style={{ color: statusLine.color }}>
            {statusLine.text}
          </span>
        </div>
      </div>

      <button
        onClick={async () => {
          setDeleting(true);
          try {
            await onDelete(upload.id);
          } finally {
            setDeleting(false);
          }
        }}
        disabled={deleting}
        className="p-1 rounded-lg hover:bg-[var(--surface-1)] transition-colors disabled:opacity-50"
        title={parsed ? "Remove from knowledge base" : "Cancel"}
      >
        <X className="w-4 h-4" style={{ color: "var(--foreground-muted)" }} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mira-hub/src/components/UploadBlock.tsx
git commit -m "feat(hub): UploadBlock component with status variants (queued/fetching/parsing/parsed/failed)"
```

---

## Task 11: UploadPicker component

**Files:**
- Create: `mira-hub/src/components/UploadPicker.tsx`

**External references used (developers unfamiliar with these SDKs should skim before editing):**
- Google Picker API — https://developers.google.com/picker/docs/reference
- Dropbox Chooser — https://www.dropbox.com/developers/chooser

- [ ] **Step 1: Write component**

```tsx
// mira-hub/src/components/UploadPicker.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { X, Upload as UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type PickResult = {
  provider: "google" | "dropbox";
  externalFileId?: string;
  externalDownloadUrl?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  externalCreatedAt: string | null;
};

declare global {
  interface Window {
    gapi?: {
      load: (api: string, cb: () => void) => void;
    };
    google?: {
      picker: {
        PickerBuilder: new () => GooglePickerBuilder;
        DocsView: new () => GoogleDocsView;
        Action: { PICKED: string; CANCEL: string };
        Feature: { MULTISELECT_ENABLED: string };
      };
    };
    Dropbox?: {
      choose: (opts: {
        success: (files: Array<{
          link: string;
          name: string;
          bytes: number;
          icon: string;
          client_modified?: string;
        }>) => void;
        cancel?: () => void;
        linkType: "direct" | "preview";
        multiselect: boolean;
        extensions: string[];
      }) => void;
    };
  }
}

interface GoogleDocsView {
  setMimeTypes: (types: string) => GoogleDocsView;
  setIncludeFolders: (include: boolean) => GoogleDocsView;
  setSelectFolderEnabled: (enabled: boolean) => GoogleDocsView;
}

interface GooglePickerBuilder {
  addView: (view: GoogleDocsView) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (id: string) => GooglePickerBuilder;
  enableFeature: (feat: string) => GooglePickerBuilder;
  setCallback: (cb: (data: {
    action: string;
    docs?: Array<{
      id: string;
      name: string;
      mimeType: string;
      sizeBytes: number;
      lastEditedUtc?: number;
    }>;
  }) => void) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}

export function UploadPicker({
  open,
  onClose,
  onLocalFile,
  onCloudPick,
}: {
  open: boolean;
  onClose: () => void;
  onLocalFile: (file: File) => void | Promise<void>;
  onCloudPick: (result: PickResult) => void | Promise<void>;
}) {
  const [googleReady, setGoogleReady] = useState(false);
  const [dropboxReady, setDropboxReady] = useState(false);
  const [pickerLoaded, setPickerLoaded] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [dropboxAvailable, setDropboxAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check availability on open
  useEffect(() => {
    if (!open) return;
    setError(null);
    fetch("/hub/api/picker/google/token")
      .then((r) => setGoogleAvailable(r.ok))
      .catch(() => setGoogleAvailable(false));
    fetch("/hub/api/picker/dropbox/key")
      .then((r) => setDropboxAvailable(r.ok))
      .catch(() => setDropboxAvailable(false));
  }, [open]);

  // Load Google Picker module once gapi is loaded
  useEffect(() => {
    if (!googleReady || pickerLoaded) return;
    window.gapi?.load("picker", () => setPickerLoaded(true));
  }, [googleReady, pickerLoaded]);

  async function openGoogle() {
    setError(null);
    try {
      const tokenRes = await fetch("/hub/api/picker/google/token");
      if (!tokenRes.ok) throw new Error("Google not connected");
      const { accessToken, apiKey, appId } = await tokenRes.json();
      if (!window.google?.picker || !pickerLoaded) {
        throw new Error("Google Picker not loaded yet — try again in a moment");
      }
      const view = new window.google.picker.DocsView()
        .setMimeTypes("application/pdf")
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);
      const picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .setCallback((data) => {
          if (data.action === window.google!.picker.Action.PICKED && data.docs?.[0]) {
            const doc = data.docs[0];
            void onCloudPick({
              provider: "google",
              externalFileId: doc.id,
              filename: doc.name,
              mimeType: doc.mimeType,
              sizeBytes: Number(doc.sizeBytes),
              externalCreatedAt: doc.lastEditedUtc
                ? new Date(Number(doc.lastEditedUtc)).toISOString()
                : null,
            });
            onClose();
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function openDropbox() {
    setError(null);
    try {
      if (!window.Dropbox) throw new Error("Dropbox Chooser not loaded yet");
      window.Dropbox.choose({
        linkType: "direct",
        multiselect: false,
        extensions: [".pdf"],
        success: (files) => {
          const f = files[0];
          void onCloudPick({
            provider: "dropbox",
            externalDownloadUrl: f.link,
            filename: f.name,
            mimeType: "application/pdf",
            sizeBytes: f.bytes,
            externalCreatedAt: f.client_modified ?? null,
          });
          onClose();
        },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function fetchAppKey(): Promise<string> {
    const res = await fetch("/hub/api/picker/dropbox/key");
    if (!res.ok) return "";
    const { appKey } = await res.json();
    return appKey as string;
  }

  const [dropboxKey, setDropboxKey] = useState("");
  useEffect(() => {
    if (!open || dropboxKey) return;
    void fetchAppKey().then(setDropboxKey);
  }, [open, dropboxKey]);

  if (!open) return null;

  return (
    <>
      <Script src="https://apis.google.com/js/api.js" strategy="lazyOnload" onLoad={() => setGoogleReady(true)} />
      {dropboxKey && (
        <Script
          id="dropboxjs"
          src="https://www.dropbox.com/static/api/2/dropins.js"
          strategy="lazyOnload"
          data-app-key={dropboxKey}
          onLoad={() => setDropboxReady(true)}
        />
      )}

      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="w-full max-w-md rounded-2xl p-5"
          style={{ backgroundColor: "var(--surface-0)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Add to Knowledge
            </h3>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--surface-1)]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <label
            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl px-4 py-8 cursor-pointer transition-colors hover:bg-[var(--surface-1)]"
            style={{ borderColor: "var(--border)" }}
          >
            <UploadIcon className="w-6 h-6" style={{ color: "var(--foreground-muted)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
              Drop a PDF here or click to browse
            </span>
            <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
              Up to 20 MB
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  await onLocalFile(f);
                  onClose();
                }
              }}
            />
          </label>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px" style={{ backgroundColor: "var(--border)" }} />
            <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
              or pick from a connected source
            </span>
            <div className="flex-1 h-px" style={{ backgroundColor: "var(--border)" }} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!googleAvailable || !pickerLoaded}
              onClick={openGoogle}
              title={!googleAvailable ? "Connect Google Workspace in Channels first" : undefined}
            >
              📁 From Google Drive
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!dropboxAvailable || !dropboxReady}
              onClick={openDropbox}
              title={!dropboxAvailable ? "Connect Dropbox in Channels first" : undefined}
            >
              📦 From Dropbox
            </Button>
          </div>

          {error && (
            <p className="text-xs mt-3" style={{ color: "#DC2626" }}>
              {error}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mira-hub/src/components/UploadPicker.tsx
git commit -m "feat(hub): UploadPicker modal — drop zone + Google Picker + Dropbox Chooser"
```

---

## Task 12: Wire into Knowledge page

**Files:**
- Modify: `mira-hub/src/app/(hub)/knowledge/page.tsx`

- [ ] **Step 1: Add state + upload polling + picker**

Replace the existing `KnowledgePage` body. The diff is substantial so write the full file:

```tsx
// mira-hub/src/app/(hub)/knowledge/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, BookOpen, FileText, Upload, CheckCircle2, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { UploadPicker } from "@/components/UploadPicker";
import { UploadBlock, type UploadBlockData } from "@/components/UploadBlock";

type IndexStatus = "indexed";

type KnowledgeDoc = {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  manufacturer: string | null;
  docType: string;
  source: string | null;
  chunkCount: number;
  avgQuality: number | null;
  lastIndexed: string;
  sampleTitles: string[];
  indexStatus: IndexStatus;
};

const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  electrical: "Electrical",
  mechanical: "Mechanical",
  pneumatic: "Pneumatic",
  safety: "Safety",
  general: "General",
  plc: "PLC",
  hvac: "HVAC",
};

const NON_TERMINAL: ReadonlyArray<UploadBlockData["status"]> = [
  "queued",
  "fetching",
  "parsing",
];

export default function KnowledgePage() {
  const t = useTranslations("knowledge");
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [stats, setStats] = useState({ totalChunks: 0, totalDocs: 0, categories: [] as string[] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [uploads, setUploads] = useState<UploadBlockData[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((data) => {
        setDocs(data.docs ?? []);
        setStats(data.stats ?? { totalChunks: 0, totalDocs: 0, categories: [] });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const fetchUploads = useCallback(async () => {
    try {
      const res = await fetch("/hub/api/uploads", { cache: "no-store" });
      if (!res.ok) return;
      const rows = (await res.json()) as Array<{
        id: string;
        provider: "google" | "dropbox" | "local";
        filename: string;
        sizeBytes: number | null;
        externalCreatedAt: string | null;
        status: UploadBlockData["status"];
        statusDetail: string | null;
        kbChunkCount: number | null;
      }>;
      setUploads(
        rows.map((r) => ({
          id: r.id,
          provider: r.provider,
          filename: r.filename,
          sizeBytes: r.sizeBytes,
          externalCreatedAt: r.externalCreatedAt,
          status: r.status,
          statusDetail: r.statusDetail,
          kbChunkCount: r.kbChunkCount,
        })),
      );
    } catch {
      /* swallow — poll will retry */
    }
  }, []);

  // Initial fetch + polling while any row is non-terminal
  useEffect(() => {
    void fetchUploads();
  }, [fetchUploads]);

  useEffect(() => {
    const hasActive = uploads.some((u) => NON_TERMINAL.includes(u.status));
    if (!hasActive) return;
    const iv = setInterval(fetchUploads, 2000);
    return () => clearInterval(iv);
  }, [uploads, fetchUploads]);

  async function handleLocalFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/hub/api/uploads/local", { method: "POST", body: form });
    if (res.ok) await fetchUploads();
  }

  async function handleCloudPick(result: {
    provider: "google" | "dropbox";
    externalFileId?: string;
    externalDownloadUrl?: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    externalCreatedAt: string | null;
  }) {
    const res = await fetch("/hub/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    if (res.ok) await fetchUploads();
  }

  async function handleDeleteUpload(id: string) {
    await fetch(`/hub/api/uploads/${id}`, { method: "DELETE" });
    await fetchUploads();
  }

  const categories = [
    { label: "All", key: "all" },
    ...stats.categories.map((c) => ({ label: CATEGORY_LABELS[c] ?? c, key: c })),
  ];

  const filtered = docs.filter(
    (d) =>
      (category === "all" || d.category === category) &&
      (search === "" ||
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        (d.manufacturer?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
        d.sampleTitles.some((t) => t.toLowerCase().includes(search.toLowerCase()))),
  );

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              {t("title")}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
              {loading
                ? "Loading…"
                : `${stats.totalDocs} ${t("indexed")} · ${stats.totalChunks.toLocaleString()} ${t("chunks")} ${t("inRAG")}`}
            </p>
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium h-8 px-3 rounded-lg"
            style={{ backgroundColor: "var(--brand-blue)", color: "white" }}
          >
            <Upload className="w-3.5 h-3.5" />
            {t("upload")}
          </button>
        </div>

        <div className="px-4 md:px-6 pb-2">
          <div className="relative mb-2">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: "var(--foreground-subtle)" }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search")}
              className="w-full h-9 pl-9 pr-3 rounded-lg border text-sm"
              style={{
                backgroundColor: "var(--surface-1)",
                borderColor: "var(--border)",
                color: "var(--foreground)",
              }}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setCategory(cat.key)}
                className="flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all"
                style={
                  category === cat.key
                    ? { backgroundColor: "var(--brand-blue)", color: "white" }
                    : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }
                }
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 max-w-3xl mx-auto space-y-2">
        {/* In-flight and recent uploads, above the indexed list */}
        {uploads.map((u) => (
          <UploadBlock key={u.id} upload={u} onDelete={handleDeleteUpload} />
        ))}

        {/* Existing indexed docs */}
        {filtered.map((doc) => (
          <div key={doc.id} className="card p-4 flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ backgroundColor: "var(--surface-1)" }}
            >
              <FileText className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-snug" style={{ color: "var(--foreground)" }}>
                {doc.name}
              </p>
              {doc.sampleTitles.length > 0 && (
                <p className="text-xs mt-0.5 truncate" style={{ color: "var(--foreground-subtle)" }}>
                  e.g. {doc.sampleTitles[0]}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-[11px] capitalize" style={{ color: "var(--foreground-subtle)" }}>
                  {doc.category}
                </span>
                {doc.manufacturer && (
                  <span className="text-[11px] font-medium" style={{ color: "var(--brand-blue)" }}>
                    · {doc.manufacturer}
                  </span>
                )}
                {doc.docType && (
                  <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
                    · {doc.docType}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 mt-2">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#16A34A" }} />
                <span className="text-[11px] font-medium" style={{ color: "#16A34A" }}>
                  {t("indexed")}
                </span>
                <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
                  {doc.chunkCount.toLocaleString()} {t("chunks")}
                  {doc.avgQuality ? ` · Q${doc.avgQuality}` : ""}
                </span>
              </div>
            </div>

            <div className="text-right flex-shrink-0">
              <span className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>
                {doc.chunkCount}
              </span>
              <p className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>
                {t("chunks")}
              </p>
            </div>
          </div>
        ))}

        {!loading && filtered.length === 0 && uploads.length === 0 && (
          <div className="text-center py-16">
            <BookOpen className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
            <p style={{ color: "var(--foreground-muted)" }}>{t("noDocuments")}</p>
          </div>
        )}

        {loading && (
          <div className="text-center py-16">
            <Clock className="w-8 h-8 mx-auto mb-3 animate-spin" style={{ color: "var(--foreground-subtle)" }} />
            <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>
              Loading knowledge base…
            </p>
          </div>
        )}
      </div>

      <UploadPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onLocalFile={handleLocalFile}
        onCloudPick={handleCloudPick}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "mira-hub/src/app/(hub)/knowledge/page.tsx"
git commit -m "feat(hub): wire Knowledge tab Upload button to picker + upload blocks + 2s polling"
```

---

## Task 13: Docker compose env vars

**Files:**
- Modify: `docker-compose.saas.yml` — mira-hub service env block

- [ ] **Step 1: Add 3 env vars**

Open `docker-compose.saas.yml`, find the `mira-hub:` service's `environment:` list, add after the existing `- HUB_TENANT_ID=${HUB_TENANT_ID:-mike}` line:

```yaml
      # mira-ingest target for Knowledge upload pipeline
      - INGEST_URL=${INGEST_URL:-http://mira-ingest-saas:8001}
      # Google Picker API key (distinct from OAuth client secret) + project number
      - GOOGLE_PICKER_API_KEY=${GOOGLE_PICKER_API_KEY:-}
      - GOOGLE_CLOUD_PROJECT_NUMBER=${GOOGLE_CLOUD_PROJECT_NUMBER:-}
      # Open WebUI delete-file auth for removing parsed files from KB
      - OPENWEBUI_BASE_URL=${OPENWEBUI_BASE_URL:-http://mira-core-saas:8080}
      - OPENWEBUI_API_KEY=${OPENWEBUI_API_KEY:-}
```

- [ ] **Step 2: Validate**

```bash
docker compose -f docker-compose.saas.yml config --quiet
```
Expected: no errors (warnings about unset local vars are fine — Doppler injects them in prod).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.saas.yml
git commit -m "ops(saas): plumb INGEST_URL + GOOGLE_PICKER_API_KEY + OpenWebUI creds to mira-hub"
```

---

## Task 14: Playwright E2E for local upload

**Files:**
- Create: `mira-hub/tests/e2e/knowledge-upload.spec.ts`
- Create: `mira-hub/tests/e2e/fixtures/sample.pdf` (tiny valid PDF, ~1 KB)

- [ ] **Step 1: Make the fixture PDF**

```bash
cd mira-hub/tests/e2e
mkdir -p fixtures
# minimal valid single-page PDF, well under any size limit
python3 -c "
from pathlib import Path
pdf = b'''%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 100 700 Td (Test ingest fixture) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f
0000000010 00000 n
0000000053 00000 n
0000000101 00000 n
0000000161 00000 n
trailer<</Size 5/Root 1 0 R>>
startxref
250
%%EOF'''
Path('fixtures/sample.pdf').write_bytes(pdf)
print('wrote', len(pdf), 'bytes')
"
```

- [ ] **Step 2: Write the spec**

```typescript
// mira-hub/tests/e2e/knowledge-upload.spec.ts
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Targets the production Hub (baseURL in playwright.config.ts).
// Requires prior login (cookie session); these tests assume the operator
// has run `npx playwright test --ui` once to seed auth. For CI we'd add
// a storageState fixture; for dogfood we run manually.

test("local PDF upload reaches Knowledge tab as a parsed row", async ({ page, request }) => {
  const pdf = await readFile(path.join(__dirname, "fixtures/sample.pdf"));

  // Direct API POST bypasses the UI to exercise the pipeline on its own.
  const uploadRes = await request.post("/hub/api/uploads/local", {
    multipart: {
      file: {
        name: "e2e-sample.pdf",
        mimeType: "application/pdf",
        buffer: pdf,
      },
    },
  });
  expect(uploadRes.ok()).toBeTruthy();
  const row = await uploadRes.json();
  expect(row.provider).toBe("local");
  expect(row.filename).toBe("e2e-sample.pdf");

  // Poll /uploads until terminal
  let terminal: string | null = null;
  for (let i = 0; i < 30 && !terminal; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const listRes = await request.get("/hub/api/uploads");
    const rows = (await listRes.json()) as Array<{ id: string; status: string }>;
    const me = rows.find((r) => r.id === row.id);
    if (me && ["parsed", "failed", "cancelled"].includes(me.status)) {
      terminal = me.status;
    }
  }
  expect(terminal).toBe("parsed");
});

test("uploads/:id DELETE removes parsed row", async ({ request }) => {
  // Create a fresh upload
  const pdf = await readFile(path.join(__dirname, "fixtures/sample.pdf"));
  const createRes = await request.post("/hub/api/uploads/local", {
    multipart: {
      file: { name: "e2e-delete-me.pdf", mimeType: "application/pdf", buffer: pdf },
    },
  });
  const { id } = await createRes.json();

  // Wait for parsed
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const list = await request.get("/hub/api/uploads");
    const rows = (await list.json()) as Array<{ id: string; status: string }>;
    if (rows.find((r) => r.id === id)?.status === "parsed") break;
  }

  const del = await request.delete(`/hub/api/uploads/${id}`);
  expect(del.ok()).toBeTruthy();
  const list = await request.get("/hub/api/uploads");
  const rows = (await list.json()) as Array<{ id: string }>;
  expect(rows.find((r) => r.id === id)).toBeUndefined();
});
```

- [ ] **Step 3: Commit**

```bash
git add mira-hub/tests/e2e/knowledge-upload.spec.ts mira-hub/tests/e2e/fixtures/sample.pdf
git commit -m "test(hub): Playwright E2E — local PDF upload round-trip + delete"
```

---

## Task 15: Release + deploy

**Files:**
- Modify: `mira-hub/package.json` — version bump

- [ ] **Step 1: Bump version**

Edit `mira-hub/package.json`, change `"version": "1.1.0"` to `"version": "1.2.0"`.

- [ ] **Step 2: Commit + tag**

```bash
git add mira-hub/package.json
git commit -m "chore(hub): release v1.2.0 — Knowledge upload picker

- Google Picker API + Dropbox Chooser + native file input for picking
- hub_uploads state machine (queued/fetching/parsing/parsed/failed/cancelled)
- mira-ingest pipe-through for document-kb ingest
- UI polls /uploads every 2s while non-terminal; greyed + strikethrough on parsed

Design spec: docs/superpowers/specs/2026-04-24-knowledge-upload-picker-design.md"

git tag -a mira-hub/v1.2.0 -m "mira-hub v1.2.0 — Knowledge upload picker"
git push origin main --follow-tags
```

- [ ] **Step 3: Apply Doppler prerequisite secrets (if not done)**

```bash
doppler secrets set GOOGLE_PICKER_API_KEY="<key from P2>" --project factorylm --config prd
doppler secrets set GOOGLE_CLOUD_PROJECT_NUMBER="246891599587" --project factorylm --config prd
doppler secrets set INGEST_URL="http://mira-ingest-saas:8001" --project factorylm --config prd
```

Verify:
```bash
doppler secrets --project factorylm --config prd --only-names | grep -E "GOOGLE_PICKER|GOOGLE_CLOUD_PROJECT|INGEST_URL"
```

- [ ] **Step 4: Deploy on VPS** (**REQUIRES MIKE'S "deploy it" APPROVAL — do not run without it**)

```bash
ssh root@165.245.138.91 "cd /opt/mira && git pull origin main && \
  doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.saas.yml up -d --build mira-hub"
```

- [ ] **Step 5: Smoke-verify endpoints**

```bash
curl -s -w "\nHTTP %{http_code}\n" https://app.factorylm.com/hub/api/uploads
curl -s -w "\nHTTP %{http_code}\n" https://app.factorylm.com/hub/api/picker/dropbox/key
curl -s -w "\nHTTP %{http_code}\n" https://app.factorylm.com/hub/api/picker/google/token
```

Expected: all 200 (last two may be 503/412 if env vars still missing — re-check Doppler + container env).

- [ ] **Step 6: Mike's acceptance walk**

On https://app.factorylm.com/hub/knowledge:
1. Click **Upload** → modal opens.
2. Drag a local PDF into the drop zone → block appears, cycles `parsing → parsed`, shows chunk count.
3. Click **From Google Drive** → Google Picker overlay opens showing Drive UI, pick a PDF → same outcome.
4. Click **From Dropbox** → Dropbox Chooser opens, pick a PDF → same outcome.
5. Hit X on a parsed row → row disappears, Open WebUI file removed.

Screenshot = acceptance gate per `feedback_mike_is_test_client.md`.

---

## Self-Review

**Spec coverage check** (against `2026-04-24-knowledge-upload-picker-design.md` section by section):

- ✅ Scope (local + Google Picker + Dropbox Chooser, PDF-only, 20MB limit) — Tasks 7, 8, 10, 11
- ✅ UX (drop zone + two buttons, upload block states) — Tasks 10, 11, 12
- ✅ `hub_uploads` schema — Task 1
- ✅ All 6 endpoints — Tasks 6, 7, 8, 9
- ✅ Per-provider fetch flows — Tasks 4, 5, 7
- ✅ Token refresh (Google) — Tasks 2, 3
- ✅ Frontend components — Tasks 10, 11
- ✅ Vendor SDK loading via `next/script` — Task 11
- ✅ Doppler secrets — Prerequisites + Task 15.3
- ✅ Error handling matrix — covered in Task 7's `runIngestPipeline` catch + UI statusDetail rendering in Task 10
- ✅ Playwright E2E — Task 14
- ✅ `after()` usage — Tasks 7, 8 (Next.js 16 App Router `after` import from `next/server`)
- ✅ Release + version bump — Task 15

**Placeholder scan:** all code blocks contain complete runnable code. No TBDs, TODOs, or "add appropriate error handling". All paths are exact.

**Type consistency:**
- `UploadStatus` union matches everywhere (Task 1 defines, Task 10 uses, Task 12 uses).
- `UploadProvider` type consistent.
- `Provider` from `bindings.ts` vs `UploadProvider` from `uploads.ts` — intentionally different (bindings has more values like `telegram`, `slack` that can't be upload sources); kept separate.
- Route params shape `{ params: Promise<{ id: string }> }` matches Next.js 16 App Router convention (dynamic segments resolve as Promise).
- `Upload` interface field names consistent across `uploads.ts` CRUD return, `/uploads` GET response, and `UploadBlockData` on the client.

**Scope check:** this plan implements exactly the approved spec — nothing more. Confluence/OneDrive/etc. explicitly deferred. Local + Google + Dropbox only.

**Known deviations from strict TDD (documented here so reviewers don't flag them):**
- Library functions (uploads.ts, token-refresh.ts, fetch-adapters.ts) don't have individual unit tests. The existing Hub test infra is Playwright-only against prod; adding vitest + a test DB setup is out of scope for this single-tenant dogfood release. The E2E test in Task 14 covers the integrated path.
- API route tests are folded into the same E2E spec.
