import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/equipment-notebooks")>();
  return { getNotebook: vi.fn(), normalizeNotebookThreadId: actual.normalizeNotebookThreadId };
});
vi.mock("@/capabilities/photo-source", () => ({ keepPhotoAsSource: vi.fn() }));

import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { keepPhotoAsSource } from "@/capabilities/photo-source";
import { POST } from "@/app/api/equipment-notebooks/[id]/photos/[fileId]/source/route";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "dfe74725-a4ac-4c5f-8e8c-1f06002daf0f";
const PHOTO = "f803bb1e-325e-46fd-a1a7-4421425c1f3e";
const notebook = { id: NB, nodeId: "d400e0ae-218b-4dbc-8705-ad951ef0b80c", displayName: "Ride A", asset: null };

const call = (id = NB, fileId = PHOTO, body: unknown = { threadId: "legacy" }) =>
  POST(new Request(`http://x/api/equipment-notebooks/${id}/photos/${fileId}/source`, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  }), {
    params: Promise.resolve({ id, fileId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({ tenantId: TENANT, userId: "user-1" } as never);
  vi.mocked(getNotebook).mockResolvedValue(notebook as never);
  vi.mocked(keepPhotoAsSource).mockResolvedValue({ ok: true, docId: "doc-1", alreadyKept: false, chunkCount: 2 });
});

describe("POST /api/equipment-notebooks/[id]/photos/[fileId]/source", () => {
  it("returns the session's 401 untouched", async () => {
    vi.mocked(sessionOr401).mockResolvedValueOnce(NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never);
    expect((await call()).status).toBe(401);
    expect(keepPhotoAsSource).not.toHaveBeenCalled();
  });

  it("treats malformed ids as not found without querying", async () => {
    expect((await call("not-a-uuid")).status).toBe(404);
    expect((await call(NB, "not-a-uuid")).status).toBe(404);
    expect(getNotebook).not.toHaveBeenCalled();
  });

  it("404s a notebook outside the caller's tenant", async () => {
    vi.mocked(getNotebook).mockResolvedValueOnce(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(getNotebook).toHaveBeenCalledWith(TENANT, NB);
    expect(keepPhotoAsSource).not.toHaveBeenCalled();
  });

  it("refuses to file a photo against a machine nobody has confirmed", async () => {
    vi.mocked(getNotebook).mockResolvedValueOnce({ ...notebook, asset: { confirmedAt: null } } as never);
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("asset_not_confirmed");
    expect(keepPhotoAsSource).not.toHaveBeenCalled();
  });

  it("keeps the photo on a confirmed machine", async () => {
    vi.mocked(getNotebook).mockResolvedValueOnce({ ...notebook, asset: { confirmedAt: "2026-10-23T00:00:00Z" } } as never);
    expect((await call()).status).toBe(200);
  });

  it("keeps the photo for the caller and returns the source", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ docId: "doc-1", alreadyKept: false, chunkCount: 2 });
    expect(keepPhotoAsSource).toHaveBeenCalledWith({ tenantId: TENANT, userId: "user-1", notebook, fileId: PHOTO, threadId: "legacy" });
  });

  it("keeps the reading from the conversation named in the body", async () => {
    const threadId = "3c28cc6a-897d-4a51-a665-640fbc8380e1";
    expect((await call(NB, PHOTO, { threadId })).status).toBe(200);
    expect(keepPhotoAsSource).toHaveBeenCalledWith({ tenantId: TENANT, userId: "user-1", notebook, fileId: PHOTO, threadId });
  });

  it.each([{}, { threadId: null }, { threadId: 7 }])("rejects missing or non-string conversation scope: %j", async (body) => {
    expect((await call(NB, PHOTO, body)).status).toBe(400);
    expect(keepPhotoAsSource).not.toHaveBeenCalled();
  });

  it("rejects a malformed conversation id", async () => {
    const res = await call(NB, PHOTO, { threadId: "../../etc" });
    expect(res.status).toBe(400);
    expect(keepPhotoAsSource).not.toHaveBeenCalled();
  });

  it("passes the capability's refusal status through", async () => {
    vi.mocked(keepPhotoAsSource).mockResolvedValueOnce({ ok: false, status: 409, error: "no_photo_reading" });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_photo_reading");
  });

  it("answers 500 rather than throwing when the capability fails", async () => {
    vi.mocked(keepPhotoAsSource).mockRejectedValueOnce(new Error("db down"));
    expect((await call()).status).toBe(500);
  });
});
