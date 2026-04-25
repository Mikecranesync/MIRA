import {
  describe,
  test,
  expect,
  beforeEach,
  mock,
  spyOn,
} from "bun:test";

// --- env setup BEFORE mocks/imports ---------------------------------------
process.env.RESEND_INBOUND_SECRET = "whsec_test_secret";
process.env.RESEND_API_KEY = "re_test_apikey";
process.env.MIRA_INGEST_URL = "http://fake-ingest:8001";
delete process.env.RESEND_FROM_EMAIL;

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

// Stub the Resend SDK. We control:
//   - webhooks.verify() — return the payload, or throw to simulate sig failure
//   - emails.receiving.attachments.list() — return whatever the test wants
const verifyImpl = { fn: (_args: any) => ({}) as any };
const attachmentsListImpl = { fn: async (_args: any) => ({ data: [] as any[] }) };

mock.module("resend", () => ({
  Resend: class {
    webhooks = {
      verify: (args: any) => verifyImpl.fn(args),
    };
    emails = {
      receiving: {
        attachments: {
          list: (args: any) => attachmentsListImpl.fn(args),
        },
      },
    };
  },
}));

// --- now load module under test -------------------------------------------
const { inbox, extractSlug, _resetResendClientForTests } = await import("../inbox.js");

// --- helpers ---------------------------------------------------------------
function resendEvent(opts: {
  to?: string[];
  subject?: string;
  attachments?: Array<{ filename?: string; content_type?: string }>;
  type?: string;
}) {
  return {
    type: opts.type ?? "email.received",
    created_at: "2026-04-25T00:00:00Z",
    data: {
      email_id: "evt-123",
      from: "user@example.com",
      to: opts.to ?? ["kb+abc12345@inbox.factorylm.com"],
      subject: opts.subject ?? "Forwarded manual",
      attachments: opts.attachments ?? [],
    },
  };
}

function attachmentMeta(opts: {
  filename: string;
  content_type?: string;
  content_length?: number;
  download_url?: string;
}) {
  return {
    filename: opts.filename,
    content_type: opts.content_type ?? "application/pdf",
    content_length: opts.content_length ?? 1024,
    download_url:
      opts.download_url ?? `https://resend.test/dl/${encodeURIComponent(opts.filename)}`,
  };
}

async function postWebhook(
  body: object,
  headers: Record<string, string> = {},
) {
  return inbox.request("/email", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "svix-id": "msg_test_1",
      "svix-timestamp": String(Math.floor(Date.now() / 1000)),
      "svix-signature": "v1,signature_placeholder",
      ...headers,
    },
  });
}

beforeEach(() => {
  sentReceipts.length = 0;
  // Default: verify passes through the JSON body
  verifyImpl.fn = (args: any) => JSON.parse(args.payload);
  attachmentsListImpl.fn = async () => ({ data: [] });
  _resetResendClientForTests();
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
describe("POST /api/v1/inbox/email", () => {
  test("401 on signature verify failure", async () => {
    verifyImpl.fn = () => {
      throw new Error("Invalid signature");
    };
    const res = await postWebhook(resendEvent({}));
    expect(res.status).toBe(401);
  });

  test("200 + ignored on non email.received event types", async () => {
    const res = await postWebhook(resendEvent({ type: "email.delivered" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ignored).toBe("wrong-event-type");
  });

  test("400 on malformed To address (no kb+)", async () => {
    const res = await postWebhook(
      resendEvent({ to: ["hello@inbox.factorylm.com"] }),
    );
    expect(res.status).toBe(400);
  });

  test("200 + no forward + no receipt on unknown slug", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    const res = await postWebhook(
      resendEvent({
        to: ["kb+nopenope@inbox.factorylm.com"],
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts.length).toBe(0);
    fetchSpy.mockRestore();
  });

  test("single PDF: download + forward to mira-ingest with correct FormData; receipt fires", async () => {
    attachmentsListImpl.fn = async () => ({
      data: [attachmentMeta({ filename: "manual-yaskawa.pdf" })],
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      (input: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("https://resend.test/dl/")) {
          // Attachment download — return some PDF bytes
          return Promise.resolve(
            new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
              status: 200,
            }),
          );
        }
        // mira-ingest forward
        return Promise.resolve(
          new Response('{"status":"ok"}', {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    );

    const res = await postWebhook(resendEvent({}));
    expect(res.status).toBe(200);

    // Find the mira-ingest call
    const ingestCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes("/ingest/document-kb"),
    );
    expect(ingestCall).toBeDefined();
    const init = ingestCall![1] as RequestInit;
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
    attachmentsListImpl.fn = async () => ({
      data: [attachmentMeta({ filename: "ambiguous.pdf" })],
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 }),
      ),
    );

    const res = await postWebhook(
      resendEvent({ subject: "[force] please re-add" }),
    );
    expect(res.status).toBe(200);
    const ingestCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes("/ingest/document-kb"),
    );
    const fd = (ingestCall![1] as RequestInit).body as FormData;
    expect(fd.get("relevance_gate")).toBe("off");
    fetchSpy.mockRestore();
  });

  test("mixed bag (PDF + xlsx + 30MB PDF): only PDF forwarded; rest categorized", async () => {
    attachmentsListImpl.fn = async () => ({
      data: [
        attachmentMeta({ filename: "good.pdf" }),
        attachmentMeta({
          filename: "spreadsheet.xlsx",
          content_type:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        attachmentMeta({
          filename: "huge.pdf",
          content_length: 30 * 1024 * 1024,
        }),
      ],
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      (input: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("https://resend.test/dl/")) {
          return Promise.resolve(
            new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
              status: 200,
            }),
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    );

    const res = await postWebhook(resendEvent({}));
    expect(res.status).toBe(200);

    // Only the good PDF download + ingest forward should run.
    const ingestCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/ingest/document-kb"),
    );
    expect(ingestCalls.length).toBe(1);

    await new Promise((r) => setTimeout(r, 5));
    const r0 = sentReceipts[0].result;
    expect(r0.ingested.map((x: any) => x.filename)).toEqual(["good.pdf"]);
    expect(r0.skipped.map((x: any) => x.filename)).toEqual(["spreadsheet.xlsx"]);
    expect(r0.too_large.map((x: any) => x.filename)).toEqual(["huge.pdf"]);
    fetchSpy.mockRestore();
  });

  test("mira-ingest returns status:duplicate → surfaces in receipt duplicates[]", async () => {
    attachmentsListImpl.fn = async () => ({
      data: [attachmentMeta({ filename: "manual-yaskawa.pdf" })],
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      (input: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("https://resend.test/dl/")) {
          return Promise.resolve(
            new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
              status: 200,
            }),
          );
        }
        return Promise.resolve(
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
      },
    );

    const res = await postWebhook(resendEvent({}));
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
    attachmentsListImpl.fn = async () => ({
      data: [attachmentMeta({ filename: "agenda.pdf" })],
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      (input: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("https://resend.test/dl/")) {
          return Promise.resolve(
            new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
              status: 200,
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "rejected",
              filename: "agenda.pdf",
              reason: "looks like a meeting agenda",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    );

    const res = await postWebhook(resendEvent({}));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    const r0 = sentReceipts[0].result;
    expect(r0.ingested.length).toBe(0);
    expect(r0.rejected).toEqual([
      { filename: "agenda.pdf", reason: "looks like a meeting agenda" },
    ]);
    fetchSpy.mockRestore();
  });

  test("attachments.list throws → still returns 200; errors[] populated; receipt fires", async () => {
    attachmentsListImpl.fn = async () => {
      throw new Error("Resend API down");
    };
    const fetchSpy = spyOn(globalThis, "fetch");
    const res = await postWebhook(
      resendEvent({
        attachments: [{ filename: "doc.pdf", content_type: "application/pdf" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts[0].result.errors).toEqual([
      { filename: "doc.pdf", status: "list-failed" },
    ]);
    fetchSpy.mockRestore();
  });

  test("download_url returns 404 → captured in errors[]", async () => {
    attachmentsListImpl.fn = async () => ({
      data: [attachmentMeta({ filename: "doc.pdf" })],
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      (input: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("https://resend.test/dl/")) {
          return Promise.resolve(new Response("not found", { status: 404 }));
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    );

    const res = await postWebhook(resendEvent({}));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts[0].result.errors[0].status).toBe("download-404");
    // Did NOT forward to mira-ingest because the bytes were never obtained.
    const ingestCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/ingest/document-kb"),
    );
    expect(ingestCalls.length).toBe(0);
    fetchSpy.mockRestore();
  });

  test("mira-ingest returns 429 → captured in errors[]; webhook still 200", async () => {
    attachmentsListImpl.fn = async () => ({
      data: [attachmentMeta({ filename: "doc.pdf" })],
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      (input: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("https://resend.test/dl/")) {
          return Promise.resolve(
            new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
              status: 200,
            }),
          );
        }
        return Promise.resolve(new Response("tier limit", { status: 429 }));
      },
    );

    const res = await postWebhook(resendEvent({}));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(sentReceipts[0].result.errors).toEqual([
      { filename: "doc.pdf", status: 429 },
    ]);
    fetchSpy.mockRestore();
  });

  test("missing RESEND_INBOUND_SECRET → 500", async () => {
    const original = process.env.RESEND_INBOUND_SECRET;
    delete process.env.RESEND_INBOUND_SECRET;
    try {
      const res = await postWebhook(resendEvent({}));
      expect(res.status).toBe(500);
    } finally {
      process.env.RESEND_INBOUND_SECRET = original;
    }
  });
});
