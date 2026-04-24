import {
  describe,
  test,
  expect,
  beforeEach,
  mock,
  spyOn,
} from "bun:test";

// --- env setup BEFORE mocks/imports ---------------------------------------
process.env.POSTMARK_INBOUND_TOKEN = "test-token";
process.env.MIRA_INGEST_URL = "http://fake-ingest:8001";
delete process.env.RESEND_API_KEY; // forces mailer dev-mode (logs only)

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
}));

const sentReceipts: { email: string; firstName: string; result: any }[] = [];
mock.module("../../lib/mailer.js", () => ({
  sendInboxReceiptEmail: async (email: string, firstName: string, result: any) => {
    sentReceipts.push({ email, firstName, result });
    return true;
  },
}));

// --- now load module under test -------------------------------------------
const { inbox, extractSlug } = await import("../inbox.js");

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

function postmarkBody(opts: {
  to?: string;
  attachments?: Array<Record<string, unknown>>;
}) {
  return JSON.stringify({
    MessageID: "test-msg-1",
    From: "user@example.com",
    To: opts.to ?? "kb+abc12345@inbox.factorylm.com",
    Subject: "Test",
    Attachments: opts.attachments ?? [],
  });
}

async function postWebhook(body: string, headers: Record<string, string> = {}) {
  return inbox.request("/postmark", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

beforeEach(() => {
  sentReceipts.length = 0;
});

// --- pure-function tests ---------------------------------------------------
describe("extractSlug", () => {
  test("plain address", () => {
    expect(extractSlug("kb+abc12345@inbox.factorylm.com")).toBe("abc12345");
  });

  test("display name + angle brackets", () => {
    expect(extractSlug('"MIRA Inbox" <kb+abc12345@inbox.factorylm.com>')).toBe(
      "abc12345",
    );
  });

  test("normalizes uppercase", () => {
    expect(extractSlug("KB+ABC12345@inbox.factorylm.com")).toBe("abc12345");
  });

  test("returns null when no kb+ prefix", () => {
    expect(extractSlug("hello@inbox.factorylm.com")).toBeNull();
  });

  test("returns null on empty/null/undefined", () => {
    expect(extractSlug("")).toBeNull();
    expect(extractSlug(null)).toBeNull();
    expect(extractSlug(undefined)).toBeNull();
  });
});

// --- handler tests ---------------------------------------------------------
describe("POST /api/v1/inbox/postmark", () => {
  test("401 on missing X-Auth-Token", async () => {
    const res = await postWebhook(postmarkBody({}));
    expect(res.status).toBe(401);
  });

  test("401 on wrong X-Auth-Token", async () => {
    const res = await postWebhook(postmarkBody({}), { "X-Auth-Token": "nope" });
    expect(res.status).toBe(401);
  });

  test("400 on malformed To address", async () => {
    const res = await postWebhook(
      postmarkBody({ to: "hello@inbox.factorylm.com" }),
      { "X-Auth-Token": "test-token" },
    );
    expect(res.status).toBe(400);
  });

  test("200 + no forward + no receipt on unknown slug", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    const res = await postWebhook(
      postmarkBody({
        to: "kb+nopenope@inbox.factorylm.com",
        attachments: [pdfAttachment("doc.pdf")],
      }),
      { "X-Auth-Token": "test-token" },
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    // give any fire-and-forget a chance to run, then assert nothing fired
    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts.length).toBe(0);
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
      postmarkBody({ attachments: [pdfAttachment("manual-yaskawa.pdf")] }),
      { "X-Auth-Token": "test-token" },
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
    expect(fd.get("file")).toBeInstanceOf(Blob);

    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts.length).toBe(1);
    expect(sentReceipts[0].email).toBe(FAKE_TENANT.email);
    expect(sentReceipts[0].result.ingested.map((x: any) => x.filename)).toEqual([
      "manual-yaskawa.pdf",
    ]);
    fetchSpy.mockRestore();
  });

  test("mixed bag (good PDF + xlsx + 30MB PDF): only good PDF forwarded; rest categorized", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const xlsx = {
      Name: "spreadsheet.xlsx",
      Content: btoa("PK"),
      ContentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ContentLength: 2,
    };
    const oversize = pdfAttachment("huge.pdf", 30 * 1024 * 1024);

    const res = await postWebhook(
      postmarkBody({
        attachments: [pdfAttachment("good.pdf"), xlsx, oversize],
      }),
      { "X-Auth-Token": "test-token" },
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

  test("mira-ingest returns 429: captured in errors[]; webhook still returns 200", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("tier limit", { status: 429 }),
    );
    const res = await postWebhook(
      postmarkBody({ attachments: [pdfAttachment("doc.pdf")] }),
      { "X-Auth-Token": "test-token" },
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts[0].result.errors).toEqual([
      { filename: "doc.pdf", status: 429 },
    ]);
    expect(sentReceipts[0].result.ingested.length).toBe(0);
    fetchSpy.mockRestore();
  });

  test("mira-ingest network error: captured; webhook still returns 200", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("ECONNREFUSED"),
    );
    const res = await postWebhook(
      postmarkBody({ attachments: [pdfAttachment("doc.pdf")] }),
      { "X-Auth-Token": "test-token" },
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts[0].result.errors[0].status).toBe("upstream-unreachable");
    fetchSpy.mockRestore();
  });
});
