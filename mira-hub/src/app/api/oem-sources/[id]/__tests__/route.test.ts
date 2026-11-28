// #6119: GET /api/oem-sources/[id] — session first, then the capability's answer
// mapped to a status. The fetch guards themselves are oem-source-bytes.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/capabilities/oem-source-bytes", () => ({ oemSourceBytes: vi.fn() }));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { oemSourceBytes } from "@/capabilities/oem-source-bytes";

const ID = "6119beef-0000-4000-8000-000000000001";
const session = { userId: "u_1", tenantId: "6119beef-0000-4000-8000-0000000000aa", email: "x@y", status: "trial", trialExpiresAt: null };
const req = () => new Request(`https://hub.test/api/oem-sources/${ID}/`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
});

describe("GET /api/oem-sources/[id]", () => {
  it("401 without a session, and the capability is never asked", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const res = await GET(req(), params(ID));
    expect(res.status).toBe(401);
    expect(oemSourceBytes).not.toHaveBeenCalled();
  });

  it("200 inline PDF with the safe headers", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(session as never);
    vi.mocked(oemSourceBytes).mockResolvedValue({ kind: "ok", bytes: Buffer.from("%PDF-1.7"), filename: "g120 list.pdf" });
    const res = await GET(req(), params(ID));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="g120 list.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7");
    expect(oemSourceBytes).toHaveBeenCalledWith(ID);
  });

  it("404 when the id names no shared manual", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(session as never);
    vi.mocked(oemSourceBytes).mockResolvedValue({ kind: "not_found" });
    expect((await GET(req(), params("nope"))).status).toBe(404);
  });

  it("502 source_unavailable when the vendor copy cannot be had, and when the lookup throws", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(session as never);
    vi.mocked(oemSourceBytes).mockResolvedValue({ kind: "unavailable" });
    const res = await GET(req(), params(ID));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "source_unavailable" });
    vi.mocked(oemSourceBytes).mockRejectedValue(new Error("db down"));
    expect((await GET(req(), params(ID))).status).toBe(502);
  });
});
