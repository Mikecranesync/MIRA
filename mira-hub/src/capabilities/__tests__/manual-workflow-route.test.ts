import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/capabilities/manual-workflow-store", () => ({ inspectManualQuestion: vi.fn() }));
import { sessionOr401 } from "@/lib/session";
import { inspectManualQuestion } from "@/capabilities/manual-workflow-store";
import { GET } from "@/app/api/workflows/manual-question/route";
const tenantId = "d1000000-0000-4000-8000-000000000001";
const notebookId = "d2000000-0000-4000-8000-000000000001";
const fileId = "d3000000-0000-4000-8000-000000000001";
const get = (extra = "") => GET(new Request(`https://hub.test/api/workflows/manual-question?notebook_id=${notebookId}&file_id=${fileId}${extra}`));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({ tenantId, userId: "owner-a" } as never);
  vi.mocked(inspectManualQuestion).mockResolvedValue(null);
});
describe("manual workflow inspection API", () => {
  it("derives tenant and user from the session, ignoring forged authority", async () => {
    await get("&tenant_id=forged&user_id=other");
    expect(inspectManualQuestion).toHaveBeenCalledWith({ tenantId, userId: "owner-a", notebookId, fileId, clientRequestId: undefined });
  });
  it("rejects anonymous access before any domain read", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await get()).status).toBe(401); expect(inspectManualQuestion).not.toHaveBeenCalled();
  });
  it.each(["&client_request_id=invalid", "&thread_id=../other", "&file_id=invalid"])("rejects malformed scope %s", async (extra) => {
    const res = extra.startsWith("&file_id")
      ? await GET(new Request(`https://hub.test/api/workflows/manual-question?notebook_id=${notebookId}&file_id=invalid`))
      : await get(extra);
    expect(res.status).toBe(400); expect(inspectManualQuestion).not.toHaveBeenCalled();
  });
  it("does not distinguish a foreign, unrelated or absent file/notebook", async () => {
    const res = await get(); expect(res.status).toBe(404); expect(await res.json()).toEqual({ error: "workflow_not_found" });
  });
  it("does not expose a database exception", async () => {
    vi.mocked(inspectManualQuestion).mockRejectedValue(new Error("private connection and SQL"));
    const res = await get(); expect(res.status).toBe(503); expect(JSON.stringify(await res.json())).not.toContain("private");
  });
  it("marks inspection responses uncacheable", async () => {
    vi.mocked(inspectManualQuestion).mockResolvedValue({ workflow: { state: "waiting" } } as never);
    expect((await get()).headers.get("cache-control")).toBe("no-store");
  });
  it("canonicalizes UUID spelling so inspection and recorded operation identity agree", async () => {
    await GET(new Request(`https://hub.test/api/workflows/manual-question?notebook_id=${notebookId.toUpperCase()}&file_id=${fileId.toUpperCase()}`));
    expect(inspectManualQuestion).toHaveBeenCalledWith(expect.objectContaining({ notebookId, fileId }));
  });
});
