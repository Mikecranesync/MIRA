/**
 * Hub integration marketplace routes.
 *
 * Pages:
 *   GET  /hub                           → Integration marketplace (active users)
 *
 * OAuth:
 *   GET  /api/oauth/google/authorize    → Start PKCE flow, redirect to Google
 *   GET  /api/oauth/google/callback     → Exchange code, store tokens, redirect to /hub
 *
 * Connectors API:
 *   GET  /api/connectors                → List connected providers + metadata
 *   DELETE /api/connectors/google       → Revoke Google connection
 *
 * Google Drive:
 *   GET  /api/google/drive/files        → List Drive files (PDF / image / DOCX)
 *   POST /api/google/drive/import       → Download file from Drive, send to mira-ingest
 *
 * Ingest proxy (extended):
 *   POST /api/ingest/photo              → Forward image to mira-ingest /ingest/photo
 */

import { Hono } from "hono";
import { requireActive, type MiraTokenPayload } from "../lib/auth.js";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateNonce,
  signStateJwt,
  verifyStateJwt,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  upsertConnectorToken,
  getConnectorToken,
  listConnectors,
  deleteConnectorToken,
  type ConnectorToken,
  type ConnectorMeta,
} from "../lib/oauth.js";

export const hubPages = new Hono();
export const hubApi = new Hono();

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function publicUrl(): string {
  return (process.env.PUBLIC_URL ?? "http://localhost:3200").replace(/\/$/, "");
}

function googleRedirectUri(): string {
  return `${publicUrl()}/api/oauth/google/callback`;
}

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

// Drive MIME types we surface in the file browser
const DRIVE_QUERY = [
  "mimeType = 'application/pdf'",
  "mimeType contains 'image/'",
  "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
  "trashed = false",
].join(" or ").replace(/^(.+)$/, "($1) and trashed = false")
  // The trashed=false ends up duplicated — build it cleanly:
  .replace(/\) and trashed = false$/, ")");

// Correct query: filter by MIME, exclude trash
const DRIVE_FILE_QUERY =
  "((mimeType = 'application/pdf') or (mimeType contains 'image/') or " +
  "(mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')) " +
  "and trashed = false";

const MIRA_INGEST_URL = () =>
  process.env.MIRA_INGEST_URL || "http://mira-ingest:8001";
const INGEST_MAX_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Hub page
// ---------------------------------------------------------------------------

hubPages.get("/hub", async (c) => {
  const file = Bun.file("./public/hub.html");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

// ---------------------------------------------------------------------------
// OAuth — Google authorize
// ---------------------------------------------------------------------------

hubApi.get("/api/oauth/google/authorize", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const nonce = generateNonce();

  const stateJwt = await signStateJwt({
    codeVerifier,
    nonce,
    tenantId: user.sub,
    provider: "google",
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: stateJwt,
  });

  return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`, 302);
});

// ---------------------------------------------------------------------------
// OAuth — Google callback
// ---------------------------------------------------------------------------

hubApi.get("/api/oauth/google/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    console.warn("[oauth/google] Provider error:", error);
    return c.redirect("/hub?error=access_denied", 302);
  }
  if (!code || !stateParam) {
    return c.redirect("/hub?error=missing_params", 302);
  }

  const state = await verifyStateJwt(stateParam);
  if (!state || state.provider !== "google") {
    return c.redirect("/hub?error=invalid_state", 302);
  }

  let tokens;
  try {
    tokens = await exchangeGoogleCode(code, state.codeVerifier, googleRedirectUri());
  } catch (err) {
    console.error("[oauth/google] Token exchange failed:", err);
    return c.redirect("/hub?error=token_exchange", 302);
  }

  let userInfo;
  try {
    userInfo = await fetchGoogleUserInfo(tokens.accessToken);
  } catch (err) {
    console.error("[oauth/google] Userinfo fetch failed:", err);
    return c.redirect("/hub?error=userinfo", 302);
  }

  const meta: ConnectorMeta = {
    email: userInfo.email,
    display_name: userInfo.name,
    avatar_url: userInfo.picture ?? undefined,
  };

  try {
    await upsertConnectorToken(
      state.tenantId,
      "google",
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiresAt,
      tokens.scope,
      meta,
    );
  } catch (err) {
    console.error("[oauth/google] Token storage failed:", err);
    return c.redirect("/hub?error=db", 302);
  }

  console.log("[oauth/google] Connected tenant=%s email=%s", state.tenantId, userInfo.email);
  return c.redirect("/hub?connected=google", 302);
});

// ---------------------------------------------------------------------------
// Connectors list
// ---------------------------------------------------------------------------

hubApi.get("/api/connectors", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const rows = await listConnectors(user.sub);

  const result = rows.map((row: ConnectorToken) => {
    let meta: ConnectorMeta | null = null;
    try {
      meta = row.metadata_json ? JSON.parse(row.metadata_json) : null;
    } catch {
      /* ignore */
    }
    return {
      provider: row.provider,
      connected: true,
      email: meta?.email ?? null,
      display_name: meta?.display_name ?? null,
      avatar_url: meta?.avatar_url ?? null,
      scope: row.scope,
      expires_at: row.expires_at,
      connected_at: row.created_at,
    };
  });

  return c.json({ connectors: result });
});

// ---------------------------------------------------------------------------
// Disconnect Google
// ---------------------------------------------------------------------------

hubApi.delete("/api/connectors/google", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;

  const existing = await getConnectorToken(user.sub, "google");
  if (!existing) {
    return c.json({ ok: true, message: "Not connected" });
  }

  // Best-effort token revocation with Google
  try {
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(existing.access_token)}`,
      { method: "POST" },
    );
  } catch {
    /* log only — still delete locally */
    console.warn("[oauth/google] Revocation request failed (will delete locally)");
  }

  await deleteConnectorToken(user.sub, "google");
  console.log("[oauth/google] Disconnected tenant=%s", user.sub);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Google Drive — list files
// ---------------------------------------------------------------------------

hubApi.get("/api/google/drive/files", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;

  const token = await getConnectorToken(user.sub, "google");
  if (!token) {
    return c.json({ error: "Google not connected" }, 403);
  }

  const params = new URLSearchParams({
    q: DRIVE_FILE_QUERY,
    fields: "files(id,name,mimeType,size,modifiedTime,iconLink)",
    orderBy: "modifiedTime desc",
    pageSize: "50",
  });

  const resp = await fetch(`${GOOGLE_DRIVE_API}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error("[drive/files] Google API error %d: %s", resp.status, body);
    if (resp.status === 401) {
      return c.json({ error: "Google token expired. Please reconnect." }, 401);
    }
    return c.json({ error: "Drive API error" }, 502);
  }

  const data = (await resp.json()) as { files?: unknown[] };
  return c.json({ files: data.files ?? [] });
});

// ---------------------------------------------------------------------------
// Google Drive — import a file into MIRA KB
// ---------------------------------------------------------------------------

hubApi.post("/api/google/drive/import", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;

  let body: { fileId?: string; mimeType?: string; fileName?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const { fileId, mimeType, fileName } = body;
  if (!fileId || !mimeType || !fileName) {
    return c.json({ error: "fileId, mimeType, and fileName are required" }, 400);
  }

  const token = await getConnectorToken(user.sub, "google");
  if (!token) {
    return c.json({ error: "Google not connected" }, 403);
  }

  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";
  const isDocx =
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  if (!isImage && !isPdf && !isDocx) {
    return c.json({ error: `Unsupported file type: ${mimeType}` }, 415);
  }

  // Download from Google Drive (DOCX → export as PDF via Google's converter)
  let downloadUrl: string;
  let finalMime: string;
  let finalName: string;

  if (isDocx) {
    downloadUrl = `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=application%2Fpdf`;
    finalMime = "application/pdf";
    finalName = fileName.replace(/\.docx?$/i, ".pdf");
  } else {
    downloadUrl = `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
    finalMime = mimeType;
    finalName = fileName;
  }

  const driveResp = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  if (!driveResp.ok) {
    console.error("[drive/import] Download failed %d for %s", driveResp.status, fileId);
    return c.json({ error: "Failed to download file from Google Drive" }, 502);
  }

  const fileBytes = await driveResp.arrayBuffer();
  if (fileBytes.byteLength === 0) {
    return c.json({ error: "Downloaded file is empty" }, 400);
  }
  if (fileBytes.byteLength > INGEST_MAX_BYTES) {
    return c.json({ error: "File exceeds 50 MB limit" }, 413);
  }

  const forwarded = new FormData();

  if (isImage) {
    // Route to mira-ingest photo endpoint
    forwarded.append("file", new Blob([fileBytes], { type: finalMime }), finalName);
    forwarded.append("asset_tag", fileName.replace(/\.[^.]+$/, "").slice(0, 64));
    forwarded.append("location", "Google Drive");
    forwarded.append("notes", `Imported from Google Drive — ${fileName}`);
    forwarded.append("tenant_id", user.sub);

    const ingestResp = await fetch(`${MIRA_INGEST_URL()}/ingest/photo`, {
      method: "POST",
      body: forwarded,
    });
    const resultText = await ingestResp.text();
    console.log(
      "[drive/import] photo tenant=%s file=%s status=%d",
      user.sub,
      fileName,
      ingestResp.status,
    );
    return new Response(resultText, {
      status: ingestResp.status,
      headers: { "Content-Type": ingestResp.headers.get("content-type") ?? "application/json" },
    });
  } else {
    // Route PDF (or DOCX-as-PDF) to document-kb
    forwarded.append(
      "file",
      new Blob([fileBytes], { type: "application/pdf" }),
      finalName,
    );
    forwarded.append("tenant_id", user.sub);

    const ingestResp = await fetch(`${MIRA_INGEST_URL()}/ingest/document-kb`, {
      method: "POST",
      body: forwarded,
    });
    const resultText = await ingestResp.text();
    console.log(
      "[drive/import] doc tenant=%s file=%s status=%d",
      user.sub,
      finalName,
      ingestResp.status,
    );
    return new Response(resultText, {
      status: ingestResp.status,
      headers: { "Content-Type": ingestResp.headers.get("content-type") ?? "application/json" },
    });
  }
});

// ---------------------------------------------------------------------------
// Photo ingest proxy (extends existing /api/ingest/manual for images)
// ---------------------------------------------------------------------------

hubApi.post("/api/ingest/photo", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Invalid multipart body" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "Missing 'file' field" }, 400);
  }
  if (!file.type.startsWith("image/")) {
    return c.json({ error: "Only image uploads are accepted" }, 415);
  }
  if (file.size > INGEST_MAX_BYTES) {
    return c.json({ error: "File exceeds 50 MB limit" }, 413);
  }
  if (file.size === 0) {
    return c.json({ error: "Empty file" }, 400);
  }

  const forwarded = new FormData();
  forwarded.append("file", file, file.name || "photo.jpg");
  forwarded.append("tenant_id", user.sub);

  const assetTag = form.get("asset_tag");
  const location = form.get("location");
  const notes = form.get("notes");
  if (typeof assetTag === "string" && assetTag.trim())
    forwarded.append("asset_tag", assetTag.trim());
  if (typeof location === "string" && location.trim())
    forwarded.append("location", location.trim());
  if (typeof notes === "string" && notes.trim())
    forwarded.append("notes", notes.trim());

  try {
    const resp = await fetch(`${MIRA_INGEST_URL()}/ingest/photo`, {
      method: "POST",
      body: forwarded,
    });
    const bodyText = await resp.text();
    console.log(
      "[ingest-photo] tenant=%s size=%d status=%d",
      user.sub,
      file.size,
      resp.status,
    );
    return new Response(bodyText, {
      status: resp.status,
      headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    console.error("[ingest-photo] Proxy failed:", err);
    return c.json({ error: "Ingest upstream unreachable" }, 502);
  }
});
