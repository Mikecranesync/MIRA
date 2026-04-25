// mira-web/src/routes/inbox.ts
//
// Magic email inbox (Unit 3 + 3.5): customer forwards an email with PDF
// attachments to kb+<slug>@inbox.factorylm.com; Resend Inbound POSTs a
// webhook here. We verify the Svix signature, resolve the tenant by slug,
// fetch each attachment via Resend's Attachments API (download_url is
// signed and valid for 1 hour), and stream the PDFs to mira-ingest.
//
// Always returns 200 to Resend on parse-able payloads (Resend retries on
// non-2xx, which causes storms on real-customer issues like an unknown
// slug). Auth failures and bad payloads are 401/400 — Resend handles those.

import { Hono } from "hono";
import { Resend } from "resend";
import { findTenantByInboxSlug, type Tenant } from "../lib/quota.js";
import { sendInboxReceiptEmail, type InboxReceiptResult } from "../lib/mailer.js";

export const inbox = new Hono();

const MIRA_INGEST_URL = () =>
  process.env.MIRA_INGEST_URL || "http://mira-ingest:8001";

const MAX_PDF_BYTES = 20 * 1024 * 1024; // matches mira-ingest enforcement

// Lazy-init the Resend client so missing creds at boot don't crash the process.
let _resend: Resend | null = null;
function resendClient(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY || "");
  return _resend;
}

// Test-only seam: tests reset the cached client between cases.
export function _resetResendClientForTests(): void {
  _resend = null;
}

// Resend Inbound webhook payload shape (subset we use)
interface ResendInboundEvent {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    attachments?: { filename?: string; content_type?: string }[];
  };
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

// Resend's `data.to` is an array; we use the first kb+ address we find.
function findInboxRecipient(toList: string[] | undefined): string | null {
  if (!Array.isArray(toList)) return null;
  for (const addr of toList) {
    const slug = extractSlug(addr);
    if (slug) return addr;
  }
  return null;
}

interface ProcessAttachmentResult {
  filename: string;
  outcome: "ingested" | "skipped" | "too_large" | "duplicate" | "rejected" | "error";
  reason?: string;
  status?: number | string;
  // populated when outcome === "duplicate"
  original_filename?: string;
  original_uploaded_at?: string;
}

async function forwardAttachment(
  filename: string,
  contentType: string,
  contentLength: number | null,
  downloadUrl: string,
  tenant: Tenant,
  relevanceGate: "on" | "off",
): Promise<ProcessAttachmentResult> {
  const isPdfMime = (contentType || "").toLowerCase() === "application/pdf";
  const isPdfExt = filename.toLowerCase().endsWith(".pdf");

  if (!isPdfMime && !isPdfExt) {
    return {
      filename,
      outcome: "skipped",
      reason: "I only accept PDFs for now",
    };
  }

  if (typeof contentLength === "number" && contentLength > MAX_PDF_BYTES) {
    return {
      filename,
      outcome: "too_large",
      reason: `${Math.round(contentLength / (1024 * 1024))} MB`,
    };
  }

  // Download the attachment from Resend's signed URL (valid 1 hour).
  let bytes: Uint8Array;
  try {
    const dl = await fetch(downloadUrl);
    if (!dl.ok) {
      return { filename, outcome: "error", status: `download-${dl.status}` };
    }
    bytes = new Uint8Array(await dl.arrayBuffer());
  } catch (err) {
    console.error("[inbox] attachment download failed:", filename, err);
    return { filename, outcome: "error", status: "download-failed" };
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
  // 1. Auth — Svix-style HMAC signature verify via Resend SDK.
  const secret = process.env.RESEND_INBOUND_SECRET || "";
  if (!secret) {
    console.error("[inbox] RESEND_INBOUND_SECRET not set; refusing all webhooks");
    return c.json({ error: "Webhook not configured" }, 500);
  }

  const rawBody = await c.req.text();
  let payload: ResendInboundEvent;
  try {
    payload = resendClient().webhooks.verify({
      payload: rawBody,
      headers: {
        id: c.req.header("svix-id") || "",
        timestamp: c.req.header("svix-timestamp") || "",
        signature: c.req.header("svix-signature") || "",
      },
      webhookSecret: secret,
    }) as ResendInboundEvent;
  } catch (err) {
    console.warn("[inbox] svix verify failed:", err instanceof Error ? err.message : err);
    return c.json({ error: "Unauthorized" }, 401);
  }

  // 2. Filter on event type — Resend sends multiple event types per stream.
  if (payload.type !== "email.received") {
    console.log("[inbox] ignored event type:", payload.type);
    return c.json({ ok: true, ignored: "wrong-event-type" }, 200);
  }

  const data = payload.data || {};
  const emailId = data.email_id;
  if (!emailId) {
    return c.json({ error: "Missing email_id" }, 400);
  }

  // 3. Resolve slug from the first kb+ recipient.
  const inboxRecipient = findInboxRecipient(data.to);
  const slug = extractSlug(inboxRecipient);
  if (!slug) {
    console.warn("[inbox] no kb+ recipient in", data.to);
    return c.json({ error: "Bad recipient address" }, 400);
  }

  // 4. Look up tenant.
  const tenant = await findTenantByInboxSlug(slug);
  if (!tenant) {
    console.warn("[inbox] unknown slug:", slug, "from", data.from);
    return c.json({ ok: true, ignored: "unknown-recipient" }, 200);
  }

  // [force] in subject disables the relevance gate for this send.
  const subject = data.subject || "";
  const relevanceGate: "on" | "off" = /\[force\]/i.test(subject) ? "off" : "on";

  console.log(
    "[inbox] received email_id=%s tenant=%s from=%s gate=%s",
    emailId,
    tenant.id,
    data.from || "(none)",
    relevanceGate,
  );

  // 5. Fetch the attachment list (download_url is valid 1 hour).
  const result: InboxReceiptResult = {
    ingested: [],
    skipped: [],
    too_large: [],
    duplicates: [],
    rejected: [],
    errors: [],
  };

  let attachmentsList: {
    filename?: string;
    content_type?: string;
    content_length?: number;
    download_url?: string;
  }[] = [];
  try {
    const listResp = await resendClient().emails.receiving.attachments.list({
      emailId,
    });
    attachmentsList = (listResp as any)?.data || [];
  } catch (err) {
    console.error("[inbox] attachment list failed:", err);
    // Receipt still fires so the customer knows we got their email but couldn't
    // process attachments; record one error per known-from-payload attachment.
    for (const att of data.attachments || []) {
      result.errors.push({
        filename: att.filename || "attachment",
        status: "list-failed",
      });
    }
    sendInboxReceiptEmail(tenant.email, tenant.first_name || "", result).catch(
      (err) => console.error("[inbox] receipt email send error:", err),
    );
    return c.json({ ok: true, summary: result }, 200);
  }

  // 6. Process each attachment (sequential — bounds mira-ingest load).
  for (const att of attachmentsList) {
    const r = await forwardAttachment(
      att.filename || "attachment.pdf",
      att.content_type || "",
      typeof att.content_length === "number" ? att.content_length : null,
      att.download_url || "",
      tenant,
      relevanceGate,
    );
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

  // 7. Receipt email — fire and forget; don't block the 200 to Resend.
  sendInboxReceiptEmail(tenant.email, tenant.first_name || "", result).catch((err) =>
    console.error("[inbox] receipt email send error:", err),
  );

  return c.json({ ok: true, summary: result }, 200);
});

export default inbox;
