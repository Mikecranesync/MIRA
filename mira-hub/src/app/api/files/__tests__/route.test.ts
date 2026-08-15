// Vitest coverage for the Files REST API (canonical file + many-to-many links).
//
// Run: cd mira-hub && npx vitest run src/app/api/files
//
// @/lib/workspace-files is mocked at the module boundary (the Hub route-test
// convention) — these tests assert ROUTING, VALIDATION, and STATUS MAPPING, not
// SQL. The service's own SQL semantics are covered by
// src/lib/__tests__/workspace-files.test.ts.
//
// The tenancy contract under test: a file or target belonging to another tenant
// is INDISTINGUISHABLE from one that does not exist — same 404, same generic
// body, never a different status.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/workspace-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace-files")>();
  return {
    ...actual, // isLinkTargetType / capability helpers stay real
    listFiles: vi.fn(),
    getFile: vi.fn(),
    deleteFile: vi.fn(),
    attachFileToTargets: vi.fn(),
    detachLink: vi.fn(),
    relocateFile: vi.fn(),
  };
});

import { GET as listRoute } from "../route";
import { GET as getFileRoute, DELETE as deleteFileRoute } from "../[fileId]/route";
import { POST as attachRoute } from "../[fileId]/links/route";
import { DELETE as detachRoute } from "../[fileId]/links/[linkId]/route";
import { POST as relocateRoute } from "../[fileId]/relocate/route";
import { sessionOr401 } from "@/lib/session";
import {
  listFiles,
  getFile,
  deleteFile,
  attachFileToTargets,
  detachLink,
  relocateFile,
} from "@/lib/workspace-files";

const TENANT = "11111111-1111-1111-1111-111111111111";
const FILE_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_TENANT_FILE = "99999999-9999-9999-9999-999999999999";
const NOTEBOOK_A = "33333333-3333-3333-3333-333333333333";
const NOTEBOOK_B = "44444444-4444-4444-4444-444444444444";
const LINK_A = "55555555-5555-5555-5555-555555555555";
const LINK_B = "66666666-6666-6666-6666-666666666666";
const NODE_ID = "77777777-7777-7777-7777-777777777777";

const goodSession = {
  userId: "u_1",
  tenantId: TENANT,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const FILE = {
  id: FILE_ID,
  filename: "pump-manual.pdf",
  mimeType: "application/pdf",
  sizeBytes: 51200,
  contentSha256: "a".repeat(64),
  uploadId: "aaaaaaaa-0000-4000-8000-000000000001",
  verified: false,
  createdAt: "2026-08-13T00:00:00Z",
  capability: "indexable" as const,
  indexed: true,
  linkCount: 2,
};

const fileParams = (fileId: string) => ({ params: Promise.resolve({ fileId }) });
const linkParams = (fileId: string, linkId: string) => ({
  params: Promise.resolve({ fileId, linkId }),
});
const jsonReq = (url: string, body: unknown) =>
  new Request(url, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  vi.mocked(sessionOr401).mockResolvedValue(goodSession);
});

describe("GET /api/files — list + filters", () => {
  it("passes q / capability / unfiled / limit / offset through to the service", async () => {
    vi.mocked(listFiles).mockResolvedValue([FILE]);
    const res = await listRoute(
      new Request("https://hub.test/api/files?q=pump&capability=indexable&unfiled=true&limit=10&offset=20"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: unknown[] };
    expect(body.files).toHaveLength(1);
    expect(listFiles).toHaveBeenCalledWith(TENANT, {
      q: "pump",
      capability: "indexable",
      unfiled: true,
      limit: 10,
      offset: 20,
    });
  });

  it("defaults every filter off when no params are given", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    await listRoute(new Request("https://hub.test/api/files"));
    expect(listFiles).toHaveBeenCalledWith(TENANT, {
      q: null,
      capability: null,
      unfiled: false,
      limit: undefined,
      offset: undefined,
    });
  });

  it("422s an unknown capability instead of silently ignoring it", async () => {
    const res = await listRoute(new Request("https://hub.test/api/files?capability=executable"));
    expect(res.status).toBe(422);
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("propagates a 401 from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await listRoute(new Request("https://hub.test/api/files"));
    expect(res.status).toBe(401);
  });

  it("503s when the DB is not configured", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await listRoute(new Request("https://hub.test/api/files"));
    expect(res.status).toBe(503);
  });
});

describe("GET /api/files/[fileId]", () => {
  it("returns the file (with capability + indexed) and its links", async () => {
    vi.mocked(getFile).mockResolvedValue({
      file: FILE,
      links: [
        {
          id: LINK_A,
          fileId: FILE_ID,
          targetType: "equipment_notebook",
          targetId: NOTEBOOK_A,
          role: "manual",
          displayLabel: null,
          isPrimary: true,
          createdAt: "2026-08-13T00:00:00Z",
        },
      ],
    });
    const res = await getFileRoute(new Request("https://hub.test/x"), fileParams(FILE_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: Record<string, unknown>; links: unknown[] };
    expect(body.file).toMatchObject({ id: FILE_ID, capability: "indexable", indexed: true });
    expect(body.links).toHaveLength(1);
    expect(getFile).toHaveBeenCalledWith(TENANT, FILE_ID);
  });

  it("404s another tenant's file exactly like a missing one (no existence leak)", async () => {
    vi.mocked(getFile).mockResolvedValue(null); // service scopes by tenant
    const res = await getFileRoute(new Request("https://hub.test/x"), fileParams(OTHER_TENANT_FILE));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("POST /api/files/[fileId]/links — attach", () => {
  it("attaches an array of targets and returns the created links", async () => {
    vi.mocked(attachFileToTargets).mockResolvedValue({
      ok: true,
      links: [{ linkId: LINK_A, targetType: "equipment_notebook", targetId: NOTEBOOK_A }],
    });
    const res = await attachRoute(
      jsonReq("https://hub.test/x", {
        targets: [{ targetType: "equipment_notebook", targetId: NOTEBOOK_A, role: "manual" }],
      }),
      fileParams(FILE_ID),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: Array<{ linkId: string }> };
    expect(body.links[0].linkId).toBe(LINK_A);
    expect(attachFileToTargets).toHaveBeenCalledWith(
      TENANT,
      FILE_ID,
      [
        {
          targetType: "equipment_notebook",
          targetId: NOTEBOOK_A,
          role: "manual",
          displayLabel: null,
          isPrimary: false,
        },
      ],
      { createdBy: "u_1" },
    );
  });

  it("normalizes a single bare target object into a one-element array", async () => {
    vi.mocked(attachFileToTargets).mockResolvedValue({
      ok: true,
      links: [{ linkId: LINK_A, targetType: "cmms_asset", targetId: NODE_ID }],
    });
    const res = await attachRoute(
      jsonReq("https://hub.test/x", { targetType: "cmms_asset", targetId: NODE_ID }),
      fileParams(FILE_ID),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(attachFileToTargets).mock.calls[0][2]).toHaveLength(1);
  });

  it("is idempotent on replay — same link id, one relationship", async () => {
    // The service upserts on uq_workspace_file_links_relationship, so a replay
    // resolves to the SAME link id. The route adds no key store.
    vi.mocked(attachFileToTargets).mockResolvedValue({
      ok: true,
      links: [{ linkId: LINK_A, targetType: "equipment_notebook", targetId: NOTEBOOK_A }],
    });
    const body = { targets: [{ targetType: "equipment_notebook", targetId: NOTEBOOK_A }] };

    const first = await attachRoute(jsonReq("https://hub.test/x", body), fileParams(FILE_ID));
    const replay = await attachRoute(
      new Request("https://hub.test/x", {
        method: "POST",
        headers: { "Idempotency-Key": "abc-123" },
        body: JSON.stringify(body),
      }),
      fileParams(FILE_ID),
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await first.json()).toEqual(await replay.json());
  });

  it("422s an unknown target type before touching the service", async () => {
    const res = await attachRoute(
      jsonReq("https://hub.test/x", {
        targets: [{ targetType: "s3_bucket", targetId: NOTEBOOK_A }],
      }),
      fileParams(FILE_ID),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "invalid_target_type" });
    expect(attachFileToTargets).not.toHaveBeenCalled();
  });

  it("422s an empty targets list", async () => {
    const res = await attachRoute(
      jsonReq("https://hub.test/x", { targets: [] }),
      fileParams(FILE_ID),
    );
    expect(res.status).toBe(422);
    expect(attachFileToTargets).not.toHaveBeenCalled();
  });

  it("404s a cross-tenant fileId", async () => {
    vi.mocked(attachFileToTargets).mockResolvedValue({ ok: false, error: "file_not_found" });
    const res = await attachRoute(
      jsonReq("https://hub.test/x", {
        targets: [{ targetType: "equipment_notebook", targetId: NOTEBOOK_A }],
      }),
      fileParams(OTHER_TENANT_FILE),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("404s a cross-tenant targetId without echoing which target failed", async () => {
    vi.mocked(attachFileToTargets).mockResolvedValue({
      ok: false,
      error: "target_not_found",
      targetType: "equipment_notebook",
      targetId: NOTEBOOK_B,
    });
    const res = await attachRoute(
      jsonReq("https://hub.test/x", {
        targets: [{ targetType: "equipment_notebook", targetId: NOTEBOOK_B }],
      }),
      fileParams(FILE_ID),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "target_not_found" });
    expect(JSON.stringify(body)).not.toContain(NOTEBOOK_B);
  });
});

describe("DELETE /api/files/[fileId]/links/[linkId] — detach", () => {
  it("detaches exactly the named link, leaving sibling relationships alone", async () => {
    vi.mocked(detachLink).mockResolvedValue(true);
    const res = await detachRoute(
      new Request("https://hub.test/x", { method: "DELETE" }),
      linkParams(FILE_ID, LINK_A),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // Notebook B's link (LINK_B) is never named — the service is called with A only.
    expect(detachLink).toHaveBeenCalledTimes(1);
    expect(detachLink).toHaveBeenCalledWith(TENANT, FILE_ID, LINK_A);
    expect(vi.mocked(detachLink).mock.calls[0]).not.toContain(LINK_B);
  });

  it("detaching the LAST link never deletes the file", async () => {
    vi.mocked(detachLink).mockResolvedValue(true);
    await detachRoute(
      new Request("https://hub.test/x", { method: "DELETE" }),
      linkParams(FILE_ID, LINK_A),
    );
    expect(deleteFile).not.toHaveBeenCalled();

    // …and the file is still there afterwards, now unfiled.
    vi.mocked(getFile).mockResolvedValue({ file: { ...FILE, linkCount: 0 }, links: [] });
    const after = await getFileRoute(new Request("https://hub.test/x"), fileParams(FILE_ID));
    expect(after.status).toBe(200);
    const body = (await after.json()) as { file: { id: string }; links: unknown[] };
    expect(body.file.id).toBe(FILE_ID);
    expect(body.links).toEqual([]);
  });

  it("404s an unknown or cross-tenant link", async () => {
    vi.mocked(detachLink).mockResolvedValue(false);
    const res = await detachRoute(
      new Request("https://hub.test/x", { method: "DELETE" }),
      linkParams(FILE_ID, LINK_B),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("POST /api/files/[fileId]/relocate", () => {
  it("adds the new target and removes ONLY the named old link", async () => {
    vi.mocked(relocateFile).mockResolvedValue({
      ok: true,
      links: [{ linkId: LINK_B, targetType: "equipment_notebook", targetId: NOTEBOOK_B }],
      removed: 1,
    });
    const res = await relocateRoute(
      jsonReq("https://hub.test/x", {
        add: [{ targetType: "equipment_notebook", targetId: NOTEBOOK_B }],
        removeLinkIds: [LINK_A],
      }),
      fileParams(FILE_ID),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: 1 });
    expect(relocateFile).toHaveBeenCalledWith(
      TENANT,
      FILE_ID,
      {
        add: [
          {
            targetType: "equipment_notebook",
            targetId: NOTEBOOK_B,
            role: null,
            displayLabel: null,
            isPrimary: false,
          },
        ],
        removeLinkIds: [LINK_A],
      },
      { createdBy: "u_1" },
    );
  });

  it("422s an invalid target type in `add` before any write", async () => {
    const res = await relocateRoute(
      jsonReq("https://hub.test/x", {
        add: [{ targetType: "dropbox_folder", targetId: NOTEBOOK_B }],
        removeLinkIds: [],
      }),
      fileParams(FILE_ID),
    );
    expect(res.status).toBe(422);
    expect(relocateFile).not.toHaveBeenCalled();
  });

  it("404s a cross-tenant target the same way attach does", async () => {
    vi.mocked(relocateFile).mockResolvedValue({
      ok: false,
      error: "target_not_found",
      targetType: "equipment_notebook",
      targetId: NOTEBOOK_B,
    });
    const res = await relocateRoute(
      jsonReq("https://hub.test/x", {
        add: [{ targetType: "equipment_notebook", targetId: NOTEBOOK_B }],
        removeLinkIds: [],
      }),
      fileParams(FILE_ID),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "target_not_found" });
  });
});

describe("DELETE /api/files/[fileId] — destructive delete", () => {
  it("deletes an unfiled, unverified file", async () => {
    vi.mocked(deleteFile).mockResolvedValue({ ok: true });
    const res = await deleteFileRoute(
      new Request("https://hub.test/x", { method: "DELETE" }),
      fileParams(FILE_ID),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("409s while relationships remain, telling the caller to detach first", async () => {
    vi.mocked(deleteFile).mockResolvedValue({ ok: false, error: "has_links" });
    const res = await deleteFileRoute(
      new Request("https://hub.test/x", { method: "DELETE" }),
      fileParams(FILE_ID),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("has_links");
    expect(body.message).toMatch(/detach/i);
  });

  it("409s a verified file (retention)", async () => {
    vi.mocked(deleteFile).mockResolvedValue({ ok: false, error: "verified_retained" });
    const res = await deleteFileRoute(
      new Request("https://hub.test/x", { method: "DELETE" }),
      fileParams(FILE_ID),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("verified_retained");
  });

  it("404s a cross-tenant file", async () => {
    vi.mocked(deleteFile).mockResolvedValue({ ok: false, error: "not_found" });
    const res = await deleteFileRoute(
      new Request("https://hub.test/x", { method: "DELETE" }),
      fileParams(OTHER_TENANT_FILE),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
