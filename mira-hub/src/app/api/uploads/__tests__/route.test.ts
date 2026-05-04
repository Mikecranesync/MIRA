// Tests for the /api/uploads GET degraded path (CRA-38).
//
// listUploads used to throw NeonDB connection errors / schema-drift errors
// straight out as a 500. The /knowledge page polls this endpoint every 2s
// while uploads are in flight, so a transient failure was lighting up the
// browser network tab + Lighthouse audit. GET now wraps in try/catch and
// returns an empty array (200) — the next poll picks up real data once
// the underlying issue clears.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(),
}));

vi.mock("@/lib/uploads", () => ({
  listUploads: vi.fn(),
}));

import { sessionOr401 } from "@/lib/session";
import { listUploads } from "@/lib/uploads";
import { GET } from "../route";

const goodCtx = { userId: "u_1", tenantId: "t_1", role: "member" as const };

beforeEach(() => {
  vi.resetAllMocks();
  (sessionOr401 as ReturnType<typeof vi.fn>).mockResolvedValue(goodCtx);
});

describe("GET /api/uploads — CRA-38 degraded path", () => {
  it("returns 200 + [] when listUploads throws (NeonDB blip / schema drift)", async () => {
    (listUploads as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Neon connection terminated unexpectedly"),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("returns 200 + the row list on the happy path (regression guard)", async () => {
    const fakeRows = [
      { id: "u1", filename: "a.pdf", status: "complete" },
      { id: "u2", filename: "b.pdf", status: "uploading" },
    ];
    (listUploads as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRows);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fakeRows);
  });

  it("returns the 401 short-circuit when sessionOr401 fails", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    (sessionOr401 as ReturnType<typeof vi.fn>).mockResolvedValue(unauthorized);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listUploads).not.toHaveBeenCalled();
  });
});
