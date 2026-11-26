import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { sessionOr401, listNotebooksWithThreads } = vi.hoisted(() => ({
  sessionOr401: vi.fn(),
  listNotebooksWithThreads: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ sessionOr401 }));
vi.mock("@/lib/equipment-notebooks", () => ({
  createNotebook: vi.fn(),
  listNotebooksWithThreads,
}));
vi.mock("@/capabilities/notebook-manual-acquisition", () => ({ startManualAcquisition: vi.fn() }));

import { GET } from "../route";

const TENANT = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.resetAllMocks();
  sessionOr401.mockResolvedValue({ tenantId: TENANT, userId: "viewer-1" });
  listNotebooksWithThreads.mockResolvedValue([
    { id: "nb1", threads: [{ id: "latest" }] },
    { id: "nb2", threads: [] },
  ]);
});

describe("GET /api/equipment-notebooks", () => {
  it("returns a single batched tenant and viewer scoped project list", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      notebooks: [{ id: "nb1", threads: [{ id: "latest" }] }, { id: "nb2", threads: [] }],
    });
    expect(listNotebooksWithThreads).toHaveBeenCalledExactlyOnceWith(TENANT, "viewer-1");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns the auth response before reading any projects", async () => {
    sessionOr401.mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listNotebooksWithThreads).not.toHaveBeenCalled();
  });

  it.each([
    Object.assign(new Error("private DB detail"), { code: "53300" }),
    Object.assign(new Error("private socket detail"), { code: "ECONNRESET" }),
    new Error("timeout exceeded when trying to connect"),
  ])("marks a known temporary read failure retryable (%s)", async (err) => {
    const captured = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      listNotebooksWithThreads.mockRejectedValue(err);
      const res = await GET();
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("1");
      expect(await res.json()).toEqual({ error: "project_list_temporarily_unavailable", retryable: true });
      expect(captured).toHaveBeenCalledOnce();
      expect(JSON.stringify(captured.mock.calls)).not.toMatch(/private/);
    } finally {
      captured.mockRestore();
    }
  });

  it("returns a safe 500 for programming errors rather than a successful empty list", async () => {
    const captured = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = Object.assign(new Error("private SQL statement"), { code: "42703" });
      listNotebooksWithThreads.mockRejectedValue(err);
      const res = await GET();
      expect(res.status).toBe(500);
      expect(res.headers.get("Retry-After")).toBeNull();
      expect(await res.json()).toEqual({ error: "project_list_failed", retryable: false });
      expect(captured).toHaveBeenCalledOnce();
      expect(JSON.stringify(captured.mock.calls)).not.toMatch(/private/);
    } finally {
      captured.mockRestore();
    }
  });
});
