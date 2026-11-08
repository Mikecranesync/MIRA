/**
 * Mocked route tests for the four job-sheet-template routes (TASK-S4):
 * POST/GET /api/job-sheets, POST /api/job-sheets/[id]/revisions,
 * POST /api/job-sheets/[id]/review, POST /api/job-sheets/import/preview.
 * Pattern copied from sheets.route.test.ts: flag gating, id/UUID checks,
 * storage-unavailable mapping, status-to-HTTP mapping, actor always from
 * the session. The import/preview route is NOT mocked against the store —
 * it calls the real (pure, DB-free) parser.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const JOB_SHEET_ID = "55555555-5555-4555-8555-555555555555";
const CLIENT_REQUEST_ID = "66666666-6666-4666-8666-666666666666";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "tech-1", email: "tech1@example.com" })),
}));

const jobSheetStore = vi.hoisted(() => ({
  createJobSheet: vi.fn(),
  reviseJobSheet: vi.fn(),
  reviewJobSheet: vi.fn(),
  listJobSheets: vi.fn(),
  getJobSheetRevision: vi.fn(),
}));
vi.mock("@/capabilities/living-sheet/job-sheet-store", () => jobSheetStore);

const livingSheetStore = vi.hoisted(() => ({
  livingSheetStorageUnavailable: vi.fn((err: unknown) => {
    if ((err as { code?: string } | null)?.code === "42P01") {
      return { status: 503, json: async () => ({ error: "living_sheet_unavailable" }) };
    }
    return null;
  }),
}));
vi.mock("@/capabilities/living-sheet/store", () => livingSheetStore);

import { GET as GET_LIST, POST as POST_CREATE } from "../../../app/api/job-sheets/route";
import { POST as POST_REVISE } from "../../../app/api/job-sheets/[id]/revisions/route";
import { POST as POST_REVIEW } from "../../../app/api/job-sheets/[id]/review/route";
import { POST as POST_PREVIEW } from "../../../app/api/job-sheets/import/preview/route";

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://test${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const idParams = { params: Promise.resolve({ id: JOB_SHEET_ID }) };

const sampleBody = {
  title: "Front wheel bearing service",
  machineLabel: null,
  component: null,
  jobType: "pm",
  estHours: null,
  crewSize: null,
  isolationPoints: null,
  cautions: null,
  returnToService: [],
  items: [],
  torques: [],
  steps: [],
  author: null,
  notes: null,
};

const sampleRevision = {
  id: "77777777-7777-4777-8777-777777777777",
  jobSheetId: JOB_SHEET_ID,
  revision: 1,
  status: "draft",
  body: sampleBody,
  createdBy: "tech1@example.com",
  createdAt: "2026-11-03T00:00:00.000Z",
  reviewedBy: null,
  reviewedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_LIVING_SHEET = "1";
});

describe("job-sheets routes: flag", () => {
  it("flag off ⇒ 404 on every route", async () => {
    delete process.env.NOTEBOOK_LIVING_SHEET;
    const results = [
      await GET_LIST(),
      await POST_CREATE(req("/api/job-sheets", "POST", { clientRequestId: CLIENT_REQUEST_ID, body: sampleBody })),
      await POST_REVISE(req(`/api/job-sheets/${JOB_SHEET_ID}/revisions`, "POST", { clientRequestId: CLIENT_REQUEST_ID, body: sampleBody }), idParams),
      await POST_REVIEW(req(`/api/job-sheets/${JOB_SHEET_ID}/review`, "POST", { clientRequestId: CLIENT_REQUEST_ID, revision: 1 }), idParams),
      await POST_PREVIEW(req("/api/job-sheets/import/preview", "POST", { text: "x" })),
    ];
    for (const res of results) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "living_sheet_disabled" });
    }
    expect(jobSheetStore.createJobSheet).not.toHaveBeenCalled();
  });
});

describe("POST /api/job-sheets", () => {
  it("rejects a non-UUID clientRequestId before calling the store", async () => {
    const res = await POST_CREATE(req("/api/job-sheets", "POST", { clientRequestId: "not-a-uuid", body: sampleBody }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_client_request_id");
    expect(jobSheetStore.createJobSheet).not.toHaveBeenCalled();
  });

  it("201 + jobSheetId/revision on created, and passes the session actor (not a client-supplied one)", async () => {
    jobSheetStore.createJobSheet.mockResolvedValue({ status: "created", jobSheetId: JOB_SHEET_ID, revision: sampleRevision });
    const res = await POST_CREATE(
      req("/api/job-sheets", "POST", { clientRequestId: CLIENT_REQUEST_ID, body: sampleBody, actorLabel: "someone-else" }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ jobSheetId: JOB_SHEET_ID, revision: sampleRevision });
    expect(jobSheetStore.createJobSheet).toHaveBeenCalledWith(
      TENANT,
      { clientRequestId: CLIENT_REQUEST_ID, body: sampleBody },
      { userId: "tech-1", label: "tech1@example.com" },
    );
  });

  it("200 + replayed:true on existing (idempotent replay)", async () => {
    jobSheetStore.createJobSheet.mockResolvedValue({ status: "existing", jobSheetId: JOB_SHEET_ID, revision: sampleRevision });
    const res = await POST_CREATE(req("/api/job-sheets", "POST", { clientRequestId: CLIENT_REQUEST_ID, body: sampleBody }));
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
  });

  it("409 request_id_conflict when the same id was used for different content", async () => {
    jobSheetStore.createJobSheet.mockResolvedValue({ status: "request_id_conflict" });
    const res = await POST_CREATE(req("/api/job-sheets", "POST", { clientRequestId: CLIENT_REQUEST_ID, body: sampleBody }));
    expect(res.status).toBe(409);
  });

  it("400 invalid_body when the store's validator rejects the body", async () => {
    jobSheetStore.createJobSheet.mockResolvedValue({ status: "invalid_body", error: "invalid_title", field: "title" });
    const res = await POST_CREATE(req("/api/job-sheets", "POST", { clientRequestId: CLIENT_REQUEST_ID, body: { ...sampleBody, title: "" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_title", field: "title" });
  });

  it("503 on a missing-table error from the store", async () => {
    jobSheetStore.createJobSheet.mockRejectedValue(Object.assign(new Error("missing"), { code: "42P01" }));
    const res = await POST_CREATE(req("/api/job-sheets", "POST", { clientRequestId: CLIENT_REQUEST_ID, body: sampleBody }));
    expect(res.status).toBe(503);
  });
});

describe("GET /api/job-sheets", () => {
  it("returns the list from the store", async () => {
    jobSheetStore.listJobSheets.mockResolvedValue([{ jobSheetId: JOB_SHEET_ID, latest: sampleRevision, latestReviewed: null }]);
    const res = await GET_LIST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobSheets: [{ jobSheetId: JOB_SHEET_ID, latest: sampleRevision, latestReviewed: null }] });
  });
});

describe("POST /api/job-sheets/[id]/revisions", () => {
  it("a non-UUID job sheet id ⇒ 404, before calling the store", async () => {
    const res = await POST_REVISE(
      req("/api/job-sheets/not-a-uuid/revisions", "POST", { clientRequestId: CLIENT_REQUEST_ID, body: sampleBody }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(404);
    expect(jobSheetStore.reviseJobSheet).not.toHaveBeenCalled();
  });

  it("201 on created", async () => {
    jobSheetStore.reviseJobSheet.mockResolvedValue({ status: "created", revision: { ...sampleRevision, revision: 2 } });
    const res = await POST_REVISE(
      req(`/api/job-sheets/${JOB_SHEET_ID}/revisions`, "POST", { clientRequestId: CLIENT_REQUEST_ID, body: sampleBody }),
      idParams,
    );
    expect(res.status).toBe(201);
    expect((await res.json()).revision.revision).toBe(2);
  });

  it("404 job_sheet_not_found", async () => {
    jobSheetStore.reviseJobSheet.mockResolvedValue({ status: "job_sheet_not_found" });
    const res = await POST_REVISE(
      req(`/api/job-sheets/${JOB_SHEET_ID}/revisions`, "POST", { clientRequestId: CLIENT_REQUEST_ID, body: sampleBody }),
      idParams,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "job_sheet_not_found" });
  });
});

describe("POST /api/job-sheets/[id]/review", () => {
  it("rejects a non-integer revision before calling the store", async () => {
    const res = await POST_REVIEW(
      req(`/api/job-sheets/${JOB_SHEET_ID}/review`, "POST", { clientRequestId: CLIENT_REQUEST_ID, revision: 1.5 }),
      idParams,
    );
    expect(res.status).toBe(400);
    expect(jobSheetStore.reviewJobSheet).not.toHaveBeenCalled();
  });

  it("201 on created, with reviewed status in the body", async () => {
    jobSheetStore.reviewJobSheet.mockResolvedValue({
      status: "created",
      revision: { ...sampleRevision, revision: 3, status: "reviewed", reviewedBy: "tech1@example.com", reviewedAt: "2026-11-03T01:00:00.000Z" },
    });
    const res = await POST_REVIEW(
      req(`/api/job-sheets/${JOB_SHEET_ID}/review`, "POST", { clientRequestId: CLIENT_REQUEST_ID, revision: 1 }),
      idParams,
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.revision.status).toBe("reviewed");
    expect(json.revision.reviewedBy).toBe("tech1@example.com");
  });

  it("404 revision_not_found", async () => {
    jobSheetStore.reviewJobSheet.mockResolvedValue({ status: "revision_not_found" });
    const res = await POST_REVIEW(
      req(`/api/job-sheets/${JOB_SHEET_ID}/review`, "POST", { clientRequestId: CLIENT_REQUEST_ID, revision: 99 }),
      idParams,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "revision_not_found" });
  });
});

describe("POST /api/job-sheets/import/preview", () => {
  it("writes nothing — never calls the job-sheet store", async () => {
    const res = await POST_PREVIEW(req("/api/job-sheets/import/preview", "POST", { text: "### Jobs\nJob ID\tJob title\nLW-01\tFront wheel service" }));
    expect(res.status).toBe(200);
    expect(jobSheetStore.createJobSheet).not.toHaveBeenCalled();
    expect(jobSheetStore.reviseJobSheet).not.toHaveBeenCalled();
    expect(jobSheetStore.reviewJobSheet).not.toHaveBeenCalled();
  });

  it("returns a real ImportPreview shape (layout + jobs + refused) from the real parser", async () => {
    const res = await POST_PREVIEW(
      req("/api/job-sheets/import/preview", "POST", {
        text: "### Jobs\nJob ID\tJob title\nLW-01\tFront wheel service",
        layout: "five_tab",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.layout).toBe("five_tab");
    expect(json.jobs[0].body.title).toBe("Front wheel service");
    expect(json.refused).toEqual([]);
  });

  it("400 on a blank text field", async () => {
    const res = await POST_PREVIEW(req("/api/job-sheets/import/preview", "POST", { text: "   " }));
    expect(res.status).toBe(400);
  });

  it("400 on an unrecognized layout", async () => {
    const res = await POST_PREVIEW(req("/api/job-sheets/import/preview", "POST", { text: "x", layout: "spreadsheet" }));
    expect(res.status).toBe(400);
  });
});
