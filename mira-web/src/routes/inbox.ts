// mira-web/src/routes/inbox.ts
//
// Magic email inbox (Unit 3): customer forwards an email with PDF attachments
// to kb+<slug>@inbox.factorylm.com; Postmark Inbound POSTs JSON here. We
// resolve the tenant by inbox_slug, stream each PDF to mira-ingest's
// /ingest/document-kb endpoint, and fire a receipt email back to the sender.
//
// Always returns 200 to Postmark on parse-able payloads (Postmark retries
// non-2xx, which would cause storms on real customer issues like an unknown
// slug). Auth failures and bad payloads are 401/400 — Postmark handles those.

import { Hono } from "hono";
import { findTenantByInboxSlug, type Tenant } from "../lib/quota.js";
import { sendInboxReceiptEmail, type InboxReceiptResult } from "../lib/mailer.js";

export const inbox = new Hono();

const MIRA_INGEST_URL = () =>
  process.env.MIRA_INGEST_URL || "http://mira-ingest:8001";
const POSTMARK_INBOUND_TOKEN = () => process.env.POSTMARK_INBOUND_TOKEN || "";

const MAX_PDF_BYTES = 20 * 1024 * 1024; // matches mira-ingest enforcement

// Postmark Inbound webhook schema (subset we use)
interface PostmarkAttachment {
  Name?: string;
  Content?: string; // base64
  ContentType?: string;
  ContentLength?: number;
}
interface PostmarkInboundPayload {
  MessageID?: string;
  To?: string;
  ToFull?: { Email?: string }[];
  From?: string;
  Subject?: string;
  Attachments?: PostmarkAttachment[];
}

// Extract the slug from kb+<slug>@inbox.factorylm.com (or any host).
// Returns null when address shape doesn't match.
export function extractSlug(toAddress: string | undefined | null): string | null {
  if (!toAddress) return null;
  // Local-part may be inside angle brackets ("Inbox <kb+abc@...>")
  const angle = toAddress.match(/<([^>]+)>/);
  const addr = angle ? angle[1] : toAddress;
  const m = addr.match(/^kb\+([a-z0-9]{6,32})@/i);
  return m ? m[1].toLowerCase() : null;
}

// Pull the To address from either the canonical To string or ToFull[0].Email.
function resolveToAddress(payload: PostmarkInboundPayload): string | null {
  if (payload.To && payload.To.trim()) return payload.To;
  const first = payload.ToFull?.[0]?.Email;
  return first || null;
}

function base64ToBytes(b64: string): Uint8Array {
  // atob is available in Bun runtime
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

interface ProcessAttachmentResult {
  filename: string;
  outcome: "ingested" | "skipped" | "too_large" | "error";
  reason?: string;
  status?: number | string;
}

async function forwardAttachment(
  att: PostmarkAttachment,
  tenant: Tenant,
): Promise<ProcessAttachmentResult> {
  const filename = att.Name || "attachment.pdf";
  const ct = (att.ContentType || "").toLowerCase();
  const isPdfMime = ct === "application/pdf";
  const isPdfExt = filename.toLowerCase().endsWith(".pdf");

  if (!isPdfMime && !isPdfExt) {
    return {
      filename,
      outcome: "skipped",
      reason: "I only accept PDFs for now",
    };
  }

  if (typeof att.ContentLength === "number" && att.ContentLength > MAX_PDF_BYTES) {
    return {
      filename,
      outcome: "too_large",
      reason: `${Math.round(att.ContentLength / (1024 * 1024))} MB`,
    };
  }

  if (!att.Content) {
    return { filename, outcome: "error", status: "empty" };
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(att.Content);
  } catch {
    return { filename, outcome: "error", status: "bad-base64" };
  }
  if (bytes.length === 0) return { filename, outcome: "error", status: "empty" };
  if (bytes.length > MAX_PDF_BYTES) {
    return {
      filename,
      outcome: "too_large",
      reason: `${Math.round(bytes.length / (1024 * 1024))} MB`,
    };
  }

  const blob = new Blob([bytes], { type: "application/pdf" });
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("filename", filename);
  form.append("tenant_id", tenant.id);

  try {
    const resp = await fetch(`${MIRA_INGEST_URL()}/ingest/document-kb`, {
      method: "POST",
      body: form,
    });
    if (resp.ok) {
      return { filename, outcome: "ingested", status: resp.status };
    }
    return { filename, outcome: "error", status: resp.status };
  } catch (err) {
    console.error("[inbox] forward failed:", filename, err);
    return { filename, outcome: "error", status: "upstream-unreachable" };
  }
}

inbox.post("/postmark", async (c) => {
  // 1. Auth
  const expectedToken = POSTMARK_INBOUND_TOKEN();
  const presentedToken = c.req.header("X-Auth-Token") || "";
  if (!expectedToken) {
    console.error("[inbox] POSTMARK_INBOUND_TOKEN not set; refusing all webhooks");
    return c.json({ error: "Webhook not configured" }, 500);
  }
  if (presentedToken !== expectedToken) {
    console.warn("[inbox] auth failure: bad X-Auth-Token");
    return c.json({ error: "Unauthorized" }, 401);
  }

  // 2. Parse JSON
  let payload: PostmarkInboundPayload;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // 3. Resolve slug
  const toAddress = resolveToAddress(payload);
  const slug = extractSlug(toAddress);
  if (!slug) {
    console.warn("[inbox] malformed To address:", toAddress);
    return c.json({ error: "Bad recipient address" }, 400);
  }

  // 4. Look up tenant
  const tenant = await findTenantByInboxSlug(slug);
  if (!tenant) {
    // Don't reveal slug-existence to outsiders. Log and 200.
    console.warn("[inbox] unknown slug:", slug, "from", payload.From);
    return c.json({ ok: true, ignored: "unknown-recipient" }, 200);
  }

  console.log(
    "[inbox] received message=%s tenant=%s from=%s attachments=%d",
    payload.MessageID || "(none)",
    tenant.id,
    payload.From || "(none)",
    payload.Attachments?.length || 0,
  );

  // 5. Process attachments (sequential — keeps mira-ingest load bounded per email)
  const result: InboxReceiptResult = {
    ingested: [],
    skipped: [],
    too_large: [],
    errors: [],
  };
  for (const att of payload.Attachments || []) {
    const r = await forwardAttachment(att, tenant);
    if (r.outcome === "ingested") result.ingested.push({ filename: r.filename });
    else if (r.outcome === "skipped")
      result.skipped.push({ filename: r.filename, reason: r.reason || "not a PDF" });
    else if (r.outcome === "too_large")
      result.too_large.push({
        filename: r.filename,
        size_mb: Number((r.reason || "0").replace(/[^0-9.]/g, "")) || 0,
      });
    else
      result.errors.push({
        filename: r.filename,
        status: r.status ?? "unknown",
      });
  }

  // 6. Receipt email — fire and forget; don't block the 200 to Postmark
  sendInboxReceiptEmail(tenant.email, tenant.first_name || "", result).catch((err) =>
    console.error("[inbox] receipt email send error:", err),
  );

  return c.json({ ok: true, summary: result }, 200);
});

export default inbox;
