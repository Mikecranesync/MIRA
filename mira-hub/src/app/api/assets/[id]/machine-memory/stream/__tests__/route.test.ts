import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

process.env.NEON_DATABASE_URL = "postgres://test";

const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

vi.mock("@/lib/demo-auth", () => ({ sessionOrDemo: vi.fn(async () => unauthorized) }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/machine-memory-response", () => ({ buildMachineMemoryResponse: vi.fn() }));

import { GET } from "../route";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

const makeReq = () => new Request("https://hub.test/api/assets/asset-1/machine-memory/stream");
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

// This route is a long-lived SSE connection — a full streaming e2e test is
// impractical in vitest (see task brief). This is the auth-guard + module
// import smoke test: unauthenticated requests never open the stream (no
// withTenantContext call, no ReadableStream is even constructed reaching a
// 401 response), matching the polling GET route's contract.
describe("GET /api/assets/[id]/machine-memory/stream", () => {
  it("returns the sessionOrDemo 401 without opening a stream or touching the DB", async () => {
    const res = await GET(makeReq(), makeParams("asset-1"));
    expect(res.status).toBe(401);
    expect(sessionOrDemo).toHaveBeenCalledTimes(1);
    expect(withTenantContext).not.toHaveBeenCalled();
  });
});
