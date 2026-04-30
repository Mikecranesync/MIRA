import {
  describe,
  test,
  expect,
  beforeEach,
  mock,
  spyOn,
} from "bun:test";
import { createHmac } from "node:crypto";

// --- env setup BEFORE mocks/imports ---------------------------------------
process.env.INBOUND_HMAC_SECRET = "test_hmac_secret_value";
process.env.MIRA_INGEST_URL = "http://fake-ingest:8001";

// --- module mocks ----------------------------------------------------------
const FAKE_TENANT = {
  id: "00000000-0000-0000-0000-000000000099",
  email: "tester@example.com",
  company: "Test Co",
  tier: "active",
  first_name: "Tester",
  stripe_customer_id: null,
  stripe_subscription_id: null,
  atlas_password: "",
  atlas_company_id: 0,
  atlas_user_id: 0,
  atlas_provisioning_status: "ok",
  activation_email_status: "sent",
  demo_seed_status: "ok",
  provisioning_attempts: 0,
  provisioning_last_attempt_at: null,
  provisioning_last_error: null,
  inbox_slug: "abc12345",
  created_at: "2026-04-24T00:00:00Z",
};

mock.module("../../lib/quota.js", () => ({
  findTenantByInboxSlug: async (slug: string) =>
    slug === "abc12345" ? FAKE_TENANT : null,
  // Stubs so sibling test files that transitively import these don't break
  // when bun runs the suite together (mock.module is process-global).
  findTenantById: async () => null,
  findTenantByEmail: async () => null,
  findTenantByStripeCustomerId: async () => null,
  getQuota: async () => ({ used: 0, limit: 100, remaining: 100 }),
  getQueriesUsedToday: async () => 0,
  hasQuotaRemaining: async () => true,
  logQuery: async () => {},
  createTenant: async () => {},
  updateTenantTier: async () => {},
  updateTenantStripe: async () => {},
  updateTenantAtlas: async () => {},
  updateTenantCmmsConfig: async () => {},
  getTenantCmmsTier: async () => "base",
  updateTenantEmailStatus: async () => {},
  updateTenantSeedStatus: async () => {},
  recordProvisioningAttempt: async () => {},
  generateInboxSlug: () => "stub1234",
  getMfaState: async () => ({
    enabled: false,
    secretEnc: null,
    recoveryCodesHashed: [],
    enrolledAt: null,
  }),
  stageMfaEnrollment: async () => {},
  activateMfa: async () => {},
  clearMfa: async () => {},
  consumeRecoveryCodeAt: async () => {},
  getDeletionState: async () => ({ deletedAt: null, purgeAfter: null }),
  markTenantDeleted: async () => {},
  listTenantsAwaitingPurge: async () => [],
  hardDeleteTenant: async () => {},
  ensureSchema: async () => {},
}));

const sentReceipts: { email: string; firstName: string; result: any }[] = [];
mock.module("../../lib/mailer.js", () => ({
  sendInboxReceiptEmail: async (email: string, firstName: string, result: any) => {
    sentReceipts.push({ email, firstName, result });
    return true;
  },
}));

// Audit log writes go to NeonDB in production; stub them out for the inbox
// route tests so they don't try to open a real DB connection. The audit
// behavior itself is best-effort and tested separately.
const auditEvents: any[] = [];
mock.module("../../lib/audit.js", () => ({
  recordAuditEvent: async (ev: any) => {
    auditEvents.push(ev);
    return true;
  },
  requestMetadata: () => ({ ip: "127.0.0.1", userAgent: "bun-test" }),
}));

const { inbox, extractSlug, _testing } = await import("../inbox.js");

// --- helpers ---------------------------------------------------------------
function pdfAttachment(name: string, sizeBytes?: number) {
  const fakeBytes = "%PDF-1.4 fake content";
  const length = sizeBytes ?? fakeBytes.length;
  return {
    Name: name,
    Content: btoa(fakeBytes),
    ContentType: "application/pdf",
    ContentLength: length,
  };
}

function inboundBody(opts: {
  to?: string;
  subject?: string;
  attachments?: Array<Record<string, unknown>>;
}) {
  return JSON.stringify({
    MessageID: "test-msg-1",
    From: "user@example.com",
    To: opts.to ?? "kb+abc12345@factorylm.com",
    Subject: opts.subject ?? "Forwarded manual",
    Attachments: opts.attachments ?? [],
  });
}

function signRequest(
  body: string,
  ts: number,
  secret = "test_hmac_secret_value",
): string {
  return createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

async function postWebhook(
  body: string,
  headers: Record<string, string> = {},
  options: {
    sign?: boolean | string;
    timestamp?: number | string | null;
  } = { sign: true },
) {
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };
  const ts =
    options.timestamp === undefined || options.timestamp === null
      ? Math.floor(Date.now() / 1000)
      : Number(options.timestamp);
  if (options.sign === true) {
    finalHeaders["X-Hmac-Signature"] = signRequest(body, ts);
  } else if (typeof options.sign === "string") {
    finalHeaders["X-Hmac-Signature"] = options.sign;
  }
  if (options.timestamp !== null) {
    finalHeaders["X-Hmac-Timestamp"] = String(
      options.timestamp ?? Math.floor(Date.now() / 1000),
    );
  }
  return inbox.request("/email", {
    method: "POST",
    body,
    headers: finalHeaders,
  });
}

beforeEach(() => {
  sentReceipts.length = 0;
  auditEvents.length = 0;
  // Reset the per-IP rate-limit state so each test starts with a clean
  // bucket — otherwise the suite blows past INBOX_LIMIT_PER_MINUTE since
  // every request shares ip="unknown" via the in-process inbox.request().
  // See P0.4 (site-hardening 2026-04-30).
  _testing.reset();
});

// --- pure-function tests ---------------------------------------------------
describe("extractSlug", () => {
  test("plain address", () => {
    expect(extractSlug("kb+abc12345@factorylm.com")).toBe("abc12345");
  });

  test("display name + angle brackets", () => {
    expect(extractSlug('"MIRA Inbox" <kb+abc12345@factorylm.com>')).toBe(
      "abc12345",
    );
  });

  test("normalizes uppercase", () => {
    expect(extractSlug("KB+ABC12345@factorylm.com")).toBe("abc12345");
  });

  test("returns null when no kb+ prefix", () => {
    expect(extractSlug("hello@factorylm.com")).toBeNull();
  });

  test("returns null on empty/null/undefined", () => {
    expect(extractSlug("")).toBeNull();
    expect(extractSlug(null)).toBeNull();
    expect(extractSlug(undefined)).toBeNull();
  });
});

// --- handler tests ---------------------------------------------------------
describe("POST /api/v1/inbox/email", () => {
  test("401 on missing X-Hmac-Signature", async () => {
    const res = await postWebhook(inboundBody({}), {}, { sign: false });
    expect(res.status).toBe(401);
  });

  test("401 on wrong signature", async () => {
    const res = await postWebhook(
      inboundBody({}),
      {},
      { sign: "0000000000000000000000000000000000000000000000000000000000000000" },
    );
    expect(res.status).toBe(401);
  });

  test("401 on signature computed with wrong secret", async () => {
    const body = inboundBody({});
    const ts = Math.floor(Date.now() / 1000);
    const wrongSig = signRequest(body, ts, "different_secret");
    const res = await postWebhook(body, {}, { sign: wrongSig, timestamp: ts });
    expect(res.status).toBe(401);
  });

  test("401 on signature length mismatch (no array OOB)", async () => {
    const res = await postWebhook(inboundBody({}), {}, { sign: "abc" });
    expect(res.status).toBe(401);
  });

  test("401 on missing X-Hmac-Timestamp header", async () => {
    const body = inboundBody({});
    const ts = Math.floor(Date.now() / 1000);
    const sig = signRequest(body, ts);
    const res = await postWebhook(body, {}, { sign: sig, timestamp: null });
    expect(res.status).toBe(401);
  });

  test("401 on stale timestamp (>5 min old) — replay-window guard", async () => {
    const body = inboundBody({});
    const stale = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const sig = signRequest(body, stale);
    const res = await postWebhook(body, {}, { sign: sig, timestamp: stale });
    expect(res.status).toBe(401);
  });

  test("401 on far-future timestamp (>5 min ahead)", async () => {
    const body = inboundBody({});
    const future = Math.floor(Date.now() / 1000) + 600; // 10 min ahead
    const sig = signRequest(body, future);
    const res = await postWebhook(body, {}, { sign: sig, timestamp: future });
    expect(res.status).toBe(401);
  });

  test("401 on non-numeric X-Hmac-Timestamp", async () => {
    const body = inboundBody({});
    const ts = Math.floor(Date.now() / 1000);
    const sig = signRequest(body, ts);
    const res = await postWebhook(body, {}, { sign: sig, timestamp: "not-a-number" });
    expect(res.status).toBe(401);
  });

  test("401 on signature replay with mismatched timestamp", async () => {
    // Captured signature for ts=A, but request claims ts=B → mismatch.
    const body = inboundBody({});
    const tsA = Math.floor(Date.now() / 1000);
    const tsB = tsA + 10;
    const sigForA = signRequest(body, tsA);
    const res = await postWebhook(body, {}, { sign: sigForA, timestamp: tsB });
    expect(res.status).toBe(401);
  });

  test("400 on malformed To address (no kb+)", async () => {
    const res = await postWebhook(
      inboundBody({ to: "hello@factorylm.com" }),
    );
    expect(res.status).toBe(400);
  });

  test("400 on body that fails JSON parse (but signature valid for those bytes)", async () => {
    const garbled = "{not json at all";
    const ts = Math.floor(Date.now() / 1000);
    const res = await inbox.request("/email", {
      method: "POST",
      body: garbled,
      headers: {
        "Content-Type": "application/json",
        "X-Hmac-Signature": signRequest(garbled, ts),
        "X-Hmac-Timestamp": String(ts),
      },
    });
    expect(res.status).toBe(400);
  });

  test("200 + no forward + no receipt on unknown slug", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    const res = await postWebhook(
      inboundBody({
        to: "kb+nopenope@factorylm.com",
        attachments: [pdfAttachment("doc.pdf")],
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts.length).toBe(0);
    fetchSpy.mockRestore();
  });

  test("inbox.email.received audit event fires for valid email", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"status":"ok"}', { status: 200 }),
    );
    const res = await postWebhook(
      inboundBody({ attachments: [pdfAttachment("doc.pdf")] }),
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    const received = auditEvents.find((e) => e.action === "inbox.email.received");
    expect(received).toBeTruthy();
    expect(received.tenantId).toBe(FAKE_TENANT.id);
    expect(received.actorType).toBe("apps_script");
    expect(received.metadata.attachment_count).toBe(1);
    expect(received.metadata.relevance_gate).toBe("on");
    fetchSpy.mockRestore();
  });

  test("single PDF: forwarded once with correct FormData; receipt fires", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"status":"ok"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await postWebhook(
      inboundBody({ attachments: [pdfAttachment("manual-yaskawa.pdf")] }),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0]!;
    expect(call[0]).toBe("http://fake-ingest:8001/ingest/document-kb");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const fd = init.body as FormData;
    expect(fd.get("tenant_id")).toBe(FAKE_TENANT.id);
    expect(fd.get("filename")).toBe("manual-yaskawa.pdf");
    expect(fd.get("source")).toBe("inbox");
    expect(fd.get("relevance_gate")).toBe("on");
    expect(fd.get("file")).toBeInstanceOf(Blob);

    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts.length).toBe(1);
    expect(sentReceipts[0].result.ingested.map((x: any) => x.filename)).toEqual([
      "manual-yaskawa.pdf",
    ]);
    fetchSpy.mockRestore();
  });

  test("[force] in Subject sets relevance_gate=off", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"status":"ok"}', { status: 200 }),
    );
    const res = await postWebhook(
      inboundBody({
        subject: "[force] Re: Yaskawa drive",
        attachments: [pdfAttachment("ambiguous.pdf")],
      }),
    );
    expect(res.status).toBe(200);
    const fd = (fetchSpy.mock.calls[0]![1] as RequestInit).body as FormData;
    expect(fd.get("relevance_gate")).toBe("off");
    fetchSpy.mockRestore();
  });

  test("multi-recipient To: finds first kb+ address among Cc/Bcc joined", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"status":"ok"}', { status: 200 }),
    );
    const res = await postWebhook(
      inboundBody({
        to: "boss@example.com, kb+abc12345@factorylm.com, peer@example.com",
        attachments: [pdfAttachment("doc.pdf")],
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  test("mixed bag (PDF + xlsx + 30MB PDF): only PDF forwarded; rest categorized", async () => {
    const xlsx = {
      Name: "spreadsheet.xlsx",
      Content: btoa("PK"),
      ContentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ContentLength: 2,
    };
    const oversize = pdfAttachment("huge.pdf", 30 * 1024 * 1024);

    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const res = await postWebhook(
      inboundBody({
        attachments: [pdfAttachment("good.pdf"), xlsx, oversize],
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 5));
    const r0 = sentReceipts[0].result;
    expect(r0.ingested.map((x: any) => x.filename)).toEqual(["good.pdf"]);
    expect(r0.skipped.map((x: any) => x.filename)).toEqual(["spreadsheet.xlsx"]);
    expect(r0.too_large.map((x: any) => x.filename)).toEqual(["huge.pdf"]);
    fetchSpy.mockRestore();
  });

  test("mira-ingest returns status:duplicate → surfaces in receipt duplicates[]", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "duplicate",
          filename: "manual-yaskawa.pdf",
          original_filename: "manual-yaskawa-gs20.pdf",
          original_uploaded_at: "2026-04-19T10:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const res = await postWebhook(
      inboundBody({ attachments: [pdfAttachment("manual-yaskawa.pdf")] }),
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    const r0 = sentReceipts[0].result;
    expect(r0.ingested.length).toBe(0);
    expect(r0.duplicates).toEqual([
      {
        filename: "manual-yaskawa.pdf",
        original_filename: "manual-yaskawa-gs20.pdf",
        original_uploaded_at: "2026-04-19T10:00:00Z",
      },
    ]);
    fetchSpy.mockRestore();
  });

  test("mira-ingest returns status:rejected → surfaces in receipt rejected[]", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "rejected",
          filename: "agenda.pdf",
          reason: "looks like a meeting agenda",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const res = await postWebhook(
      inboundBody({ attachments: [pdfAttachment("agenda.pdf")] }),
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    const r0 = sentReceipts[0].result;
    expect(r0.rejected).toEqual([
      { filename: "agenda.pdf", reason: "looks like a meeting agenda" },
    ]);
    fetchSpy.mockRestore();
  });

  test("mira-ingest 429 → captured in errors[]; webhook still 200", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("tier limit", { status: 429 }),
    );
    const res = await postWebhook(
      inboundBody({ attachments: [pdfAttachment("doc.pdf")] }),
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts[0].result.errors).toEqual([
      { filename: "doc.pdf", status: 429 },
    ]);
    fetchSpy.mockRestore();
  });

  test("mira-ingest network error → captured; webhook still 200", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("ECONNREFUSED"),
    );
    const res = await postWebhook(
      inboundBody({ attachments: [pdfAttachment("doc.pdf")] }),
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts[0].result.errors[0].status).toBe("upstream-unreachable");
    fetchSpy.mockRestore();
  });

  test("missing INBOUND_HMAC_SECRET → 500", async () => {
    const original = process.env.INBOUND_HMAC_SECRET;
    delete process.env.INBOUND_HMAC_SECRET;
    try {
      const res = await postWebhook(inboundBody({}));
      expect(res.status).toBe(500);
    } finally {
      process.env.INBOUND_HMAC_SECRET = original;
    }
  });
});
