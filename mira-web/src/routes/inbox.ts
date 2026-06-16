// mira-web/src/routes/inbox.ts
//
// Magic email inbox (Unit 3 + 3.5): customers forward email to
// kb+<slug>@factorylm.com. A Google Apps Script running on the owner's
// Workspace mailbox polls Gmail every minute, finds unread `kb+*`
// messages, packages them up, signs the body with HMAC-SHA256, and
// POSTs here.
//
// Why Apps Script instead of Resend/Postmark/SES inbound?
//   • $0/month — no new vendor, uses existing Workspace
//   • No DNS changes — Gmail's plus-addressing routes kb+* into the
//     existing apex mailbox automatically
//   • No risk to apex MX (Google Workspace stays untouched)
//   • Modern HMAC auth, ours-end-to-end
//
// The script source lives at tools/apps-script/inbox-poller.gs.
//
// Payload shape (Apps Script controls this — we picked Postmark-style
// for ease of inline attachment handling):
//   {
//     MessageID, From, To, Subject,
//     Attachments: [ { Name, Content (base64), ContentType, ContentLength } ]
//   }
//
// Always returns 200 on parse-able payloads (Apps Script retries the
// next minute if it leaves a message unread; we don't want to cause
// retry storms with non-2xx). Auth failures and bad payloads are 401/400.

import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { findTenantByInboxSlug, type Tenant } from "../lib/quota.js";
import { sendInboxReceiptEmail, type InboxReceiptResult } from "../lib/mailer.js";
import { recordAuditEvent, requestMetadata } from "../lib/audit.js";

export const inbox = new Hono();

const MIRA_INGEST_URL = () =>
  process.env.MIRA_INGEST_URL || "http://mira-ingest:8001";
const HMAC_SECRET = () => process.env.INBOUND_HMAC_SECRET || "";

const MAX_PDF_BYTES = 20 * 1024 * 1024; // matches mira-ingest enforcement
const MAX_TIMESTAMP_SKEW_SECONDS = 300; // ±5 min replay window

// Webhook payload shape (Apps Script emits this — Postmark-style for ease)
interface InboundAttachment {
  Name?: string;
  Content?: string; // base64
  ContentType?: string;
  ContentLength?: number;
}
interface InboundPayload {
  MessageID?: string;
  To?: string;
  From?: string;
  Subject?: string;
  Attachments?: InboundAttachment[];
}

// Verify HMAC-SHA256 hex signature over `<unix-timestamp>.<rawBody>`.
// Constant-time compare via crypto.timingSafeEqual. Rejects requests with a
// timestamp more than MAX_TIMESTAMP_SKEW_SECONDS off from server time —
// blocks replay of captured signatures.
function verifySignedRequest(
  rawBody: string,
  signature: string,
  timestampHeader: string,
  secret: string,
): boolean {
  if (!signature || !secret || !timestampHeader) return false;

  const ts = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const signingPayload = `${ts}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signingPayload).digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// Extract slug from kb+<slug>@<host>. Returns null on no-match.
export function extractSlug(toAddress: string | undefined | null): string | null {
  if (!toAddress) return null;
  const angle = toAddress.match(/<([^>]+)>/);
  const addr = angle ? angle[1] : toAddress;
  const m = addr.match(/^kb\+([a-z0-9]{6,32})@/i);
  return m ? m[1].toLowerCase() : null;
}

// Apps Script joins To+Cc+Bcc into one comma-separated string. Find the
// first kb+ address in any of them.
function findInboxRecipient(toFlat: string | undefined): string | null {
  if (!toFlat) return null;
  for (const part of toFlat.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const slug = extractSlug(trimmed);
    if (slug) return trimmed;
  }
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

interface ProcessAttachmentResult {
  filename: string;
  outcome: "ingested" | "skipped" | "too_large" | "duplicate" | "rejected" | "error";
  reason?: string;
  status?: number | string;
  original_filename?: string;
  original_uploaded_at?: string;
}

async function forwardAttachment(
  att: InboundAttachment,
  tenant: Tenant,
  relevanceGate: "on" | "off",
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
  form.append("source", "inbox");
  form.append("relevance_gate", relevanceGate);

  try {
    const resp = await fetch(`${MIRA_INGEST_URL()}/ingest/document-kb`, {
      method: "POST",
      body: form,
    });

    let body: any = null;
    try {
      body = await resp.json();
    } catch {
      // body stays null on non-JSON
    }

    if (!resp.ok) {
      return {
        filename,
        outcome: "error",
        status: resp.status,
        reason: body?.detail || undefined,
      };
    }

    const ingestStatus = body?.status as string | undefined;
    if (ingestStatus === "duplicate") {
      return {
        filename,
        outcome: "duplicate",
        original_filename: body?.original_filename || filename,
        original_uploaded_at: body?.original_uploaded_at || "",
      };
    }
    if (ingestStatus === "rejected") {
      return {
        filename,
        outcome: "rejected",
        reason: body?.reason || "didn't look like a manual",
      };
    }
    return { filename, outcome: "ingested", status: resp.status };
  } catch (err) {
    console.error("[inbox] forward failed:", filename, err);
    return { filename, outcome: "error", status: "upstream-unreachable" };
  }
}

inbox.post("/email", async (c) => {
  // 1. Auth — HMAC-SHA256 over raw body.
  const secret = HMAC_SECRET();
  if (!secret) {
    console.error("[inbox] INBOUND_HMAC_SECRET not set; refusing all webhooks");
    return c.json({ error: "Webhook not configured" }, 500);
  }

  const rawBody = await c.req.text();
  const signature = (c.req.header("x-hmac-signature") || "").trim();
  const timestamp = (c.req.header("x-hmac-timestamp") || "").trim();
  if (!verifySignedRequest(rawBody, signature, timestamp, secret)) {
    console.warn("[inbox] HMAC verify failed");
    return c.json({ error: "Unauthorized" }, 401);
  }

  // 2. Parse payload.
  let payload: InboundPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // 3. Resolve slug from any kb+ address in To/Cc/Bcc.
  const inboxRecipient = findInboxRecipient(payload.To);
  const slug = extractSlug(inboxRecipient);
  if (!slug) {
    console.warn("[inbox] no kb+ recipient in", payload.To);
    return c.json({ error: "Bad recipient address" }, 400);
  }

  // 4. Look up tenant.
  const tenant = await findTenantByInboxSlug(slug);
  if (!tenant) {
    // Don't reveal slug-existence to outsiders — log + 200.
    console.warn("[inbox] unknown slug:", slug, "from", payload.From);
    return c.json({ ok: true, ignored: "unknown-recipient" }, 200);
  }

  // [force] in subject disables the relevance gate for this send.
  const subject = payload.Subject || "";
  const relevanceGate: "on" | "off" = /\[force\]/i.test(subject) ? "off" : "on";

  console.log(
    "[inbox] received message=%s tenant=%s from=%s attachments=%d gate=%s",
    payload.MessageID || "(none)",
    tenant.id,
    payload.From || "(none)",
    payload.Attachments?.length || 0,
    relevanceGate,
  );

  const meta = requestMetadata(c);
  // Don't await — audit insert is best-effort and must not block the 200.
  void recordAuditEvent({
    tenantId: tenant.id,
    actorType: "apps_script",
    actorId: payload.From || "unknown",
    action: "inbox.email.received",
    resource: payload.MessageID || undefined,
    metadata: {
      from: payload.From,
      subject: payload.Subject,
      attachment_count: payload.Attachments?.length ?? 0,
      relevance_gate: relevanceGate,
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  // 5. Process attachments sequentially — bounds mira-ingest load per email.
  const result: InboxReceiptResult = {
    ingested: [],
    skipped: [],
    too_large: [],
    duplicates: [],
    rejected: [],
    errors: [],
  };
  for (const att of payload.Attachments || []) {
    const r = await forwardAttachment(att, tenant, relevanceGate);
    if (r.outcome === "ingested") result.ingested.push({ filename: r.filename });
    else if (r.outcome === "skipped")
      result.skipped.push({ filename: r.filename, reason: r.reason || "not a PDF" });
    else if (r.outcome === "too_large")
      result.too_large.push({
        filename: r.filename,
        size_mb: Number((r.reason || "0").replace(/[^0-9.]/g, "")) || 0,
      });
    else if (r.outcome === "duplicate")
      result.duplicates.push({
        filename: r.filename,
        original_filename: r.original_filename || r.filename,
        original_uploaded_at: r.original_uploaded_at || "",
      });
    else if (r.outcome === "rejected")
      result.rejected.push({
        filename: r.filename,
        reason: r.reason || "didn't look like a manual",
      });
    else
      result.errors.push({
        filename: r.filename,
        status: r.status ?? "unknown",
      });
  }

  // 6. Receipt email — fire and forget; don't block the 200.
  sendInboxReceiptEmail(tenant.email, tenant.first_name || "", result).catch((err) =>
    console.error("[inbox] receipt email send error:", err),
  );

  return c.json({ ok: true, summary: result }, 200);
});

export default inbox;
