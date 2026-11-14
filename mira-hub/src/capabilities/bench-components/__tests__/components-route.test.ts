/**
 * GET /api/equipment-notebooks/[id]/components: only the caller's own project is
 * read, and a database without the component tables (proposed migration 115 not
 * applied yet) answers 503 so the tablet hides the checklist instead of showing
 * an error on every project. Any other failure is not masked.
 *
 * Run: npx vitest run src/capabilities/bench-components/__tests__/components-route.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })) }));
const nbMock = vi.hoisted(() => ({ LEGACY_THREAD_ID: "legacy", getNotebook: vi.fn(), listSources: vi.fn(async () => []) }));
vi.mock("@/lib/equipment-notebooks", () => nbMock);
const httpMock = vi.hoisted(() => ({ benchState: vi.fn() }));
vi.mock("@/capabilities/bench-components/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/bench-components/http")>()),
  benchState: httpMock.benchState,
}));

import { GET } from "@/app/api/equipment-notebooks/[id]/components/route";

const get = () =>
  GET(new NextRequest(`http://test/api/equipment-notebooks/${NB}/components?threadId=legacy`), { params: Promise.resolve({ id: NB }) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.getNotebook.mockResolvedValue({ id: NB });
  httpMock.benchState.mockResolvedValue({ components: [], selection: null, turnComponents: {}, tallies: {}, documentNumbers: [] });
});

describe("GET components", () => {
  it("control: the caller's own project returns its checklist, read under the caller's tenant", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(nbMock.getNotebook).toHaveBeenCalledWith(TENANT, NB);
    expect(httpMock.benchState).toHaveBeenCalledWith(TENANT, NB, "u1", "legacy", []);
  });

  it("a project that is not the caller's is a 404 and nothing of it is read", async () => {
    nbMock.getNotebook.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(404);
    expect(httpMock.benchState).not.toHaveBeenCalled();
    expect(nbMock.listSources).not.toHaveBeenCalled();
  });

  it("a database without the component tables answers 503, which the tablet treats as 'not available here'", async () => {
    httpMock.benchState.mockRejectedValue(Object.assign(new Error('relation "notebook_components" does not exist'), { code: "42P01" }));
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "components_unavailable" });
  });

  it("control: any other database failure is not dressed up as 'unavailable'", async () => {
    httpMock.benchState.mockRejectedValue(Object.assign(new Error("connection reset"), { code: "08006" }));
    await expect(get()).rejects.toThrow("connection reset");
  });
});
