/**
 * POST /api/equipment-notebooks/[id]/sheets/[jobId]/photos — multipart
 * upload → park + attach (workspace-files) → append a photo_attached event
 * via the S1 store. Mirrors the events route's status->HTTP mapping exactly
 * (TASK-S3). Mocks session, notebook lookup, the flag, workspace-files, and
 * the S1 store — the only real code under test is this route file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({ getNotebook: vi.fn() }));
vi.mock("@/capabilities/living-sheet/flag", () => ({ livingSheetEnabled: vi.fn() }));
vi.mock("@/lib/workspace-files", () => ({ parkOrReuseFile: vi.fn(), attachFileToTargets: vi.fn() }));
vi.mock("@/capabilities/living-sheet/store", () => ({
  appendEvent: vi.fn(),
  livingSheetStorageUnavailable: vi.fn(() => null),
}));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { parkOrReuseFile, attachFileToTargets } from "@/lib/workspace-files";
import { appendEvent } from "@/capabilities/living-sheet/store";

const NOTEBOOK_ID = "11111111-2222-3333-4444-555555555555";
const JOB_ID = "22222222-3333-4444-5555-666666666666";
const CLIENT_EVENT_ID = "33333333-4444-5555-6666-777777777777";

const goodSession = { userId: "u_1", tenantId: "t_1", email: "tech@example.com" };

function makeReq(opts: { file?: File; clientEventId?: string; baseSeq?: string; caption?: string } = {}) {
  const fd = new FormData();
  if (opts.file !== undefined) fd.append("file", opts.file);
  if (opts.clientEventId !== undefined) fd.append("clientEventId", opts.clientEventId);
  if (opts.baseSeq !== undefined) fd.append("baseSeq", opts.baseSeq);
  if (opts.caption !== undefined) fd.append("caption", opts.caption);
  return new Request(`https://hub.test/api/equipment-notebooks/${NOTEBOOK_ID}/sheets/${JOB_ID}/photos`, {
    method: "POST",
    body: fd,
  });
}

const makeParams = () => ({ params: Promise.resolve({ id: NOTEBOOK_ID, jobId: JOB_ID }) });
const goodFile = () => new File([new Uint8Array([1, 2, 3])], "bearing.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
  vi.mocked(livingSheetEnabled).mockReturnValue(true);
  vi.mocked(getNotebook).mockResolvedValue({ id: NOTEBOOK_ID } as never);
  vi.mocked(parkOrReuseFile).mockResolvedValue({ fileId: "file-1", reused: false, uploadId: null });
  vi.mocked(attachFileToTargets).mockResolvedValue({ ok: true, links: [] } as never);
});

describe("POST photos — gates", () => {
  it("404s when the flag is off", async () => {
    vi.mocked(livingSheetEnabled).mockReturnValue(false);
    const res = await POST(makeReq({ file: goodFile(), clientEventId: CLIENT_EVENT_ID, baseSeq: "1" }) as never, makeParams());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("living_sheet_disabled");
  });

  it("404s when the notebook does not exist", async () => {
    vi.mocked(getNotebook).mockResolvedValue(null);
    const res = await POST(makeReq({ file: goodFile(), clientEventId: CLIENT_EVENT_ID, baseSeq: "1" }) as never, makeParams());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("notebook_not_found");
  });

  it("400s with no file field", async () => {
    const res = await POST(makeReq({ clientEventId: CLIENT_EVENT_ID, baseSeq: "1" }) as never, makeParams());
    expect(res.status).toBe(400);
  });

  it("415s a non-image file", async () => {
    const file = new File(["not a photo"], "notes.txt", { type: "text/plain" });
    const res = await POST(makeReq({ file, clientEventId: CLIENT_EVENT_ID, baseSeq: "1" }) as never, makeParams());
    expect(res.status).toBe(415);
  });

  it("413s a file over 10MB", async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.jpg", { type: "image/jpeg" });
    const res = await POST(makeReq({ file: big, clientEventId: CLIENT_EVENT_ID, baseSeq: "1" }) as never, makeParams());
    expect(res.status).toBe(413);
  });

  it("400s a missing/non-uuid clientEventId", async () => {
    const res = await POST(makeReq({ file: goodFile(), clientEventId: "not-a-uuid", baseSeq: "1" }) as never, makeParams());
    expect(res.status).toBe(400);
  });

  it("400s a missing/non-integer baseSeq", async () => {
    const res = await POST(makeReq({ file: goodFile(), clientEventId: CLIENT_EVENT_ID, baseSeq: "nope" }) as never, makeParams());
    expect(res.status).toBe(400);
  });
});

describe("POST photos — success path", () => {
  it("parks, attaches to the notebook, appends photo_attached with a DETERMINISTIC photoId (= clientEventId), returns 201", async () => {
    vi.mocked(appendEvent).mockResolvedValue({
      status: "created",
      event: { id: "ev-1" },
      seq: 4,
      view: { jobId: JOB_ID, seq: 4 } as never,
    } as never);

    const res = await POST(
      makeReq({ file: goodFile(), clientEventId: CLIENT_EVENT_ID, baseSeq: "3", caption: "bearing surface" }) as never,
      makeParams(),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.seq).toBe(4);

    expect(attachFileToTargets).toHaveBeenCalledWith("t_1", "file-1", [
      { targetType: "equipment_notebook", targetId: NOTEBOOK_ID },
    ]);

    const call = vi.mocked(appendEvent).mock.calls[0]!;
    expect(call[0]).toBe("t_1");
    expect(call[1]).toBe(NOTEBOOK_ID);
    expect(call[2]).toBe(JOB_ID);
    const input = call[3] as { clientEventId: string; baseSeq: number; kind: string; payload: { photoId: string; fileId: string; caption: string | null } };
    expect(input.clientEventId).toBe(CLIENT_EVENT_ID);
    expect(input.baseSeq).toBe(3);
    expect(input.kind).toBe("photo_attached");
    // Deterministic: a retry with the same clientEventId must produce the
    // SAME payload (same photoId), or the store's fingerprint check would
    // reject the retry as request_id_conflict instead of replaying it.
    expect(input.payload.photoId).toBe(CLIENT_EVENT_ID);
    expect(input.payload.fileId).toBe("file-1");
    expect(input.payload.caption).toBe("bearing surface");
  });

  it("maps every appendEvent status the same way the events route does", async () => {
    vi.mocked(appendEvent).mockResolvedValue({ status: "conflict", seq: 7, view: { seq: 7 } as never } as never);
    const res = await POST(makeReq({ file: goodFile(), clientEventId: CLIENT_EVENT_ID, baseSeq: "3" }) as never, makeParams());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("conflict");
  });

  it("replays an existing clientEventId as 200", async () => {
    vi.mocked(appendEvent).mockResolvedValue({ status: "existing", event: { id: "ev-1" } } as never);
    const res = await POST(makeReq({ file: goodFile(), clientEventId: CLIENT_EVENT_ID, baseSeq: "3" }) as never, makeParams());
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
  });
});
