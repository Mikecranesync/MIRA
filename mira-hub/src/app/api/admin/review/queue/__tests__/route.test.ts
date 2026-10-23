// #1932: the review-queue route must reject callers who lack review_queue.read
// (403) and serve those who have it (200) — via the shared requireCapability
// guard, so the gate matches what the nav shows.
// #4649: schema-behind (42P01 / 25P02) is a 200 + notice, not 500.

import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
// isReviewAdmin (used by capabilities) is the platform allowlist. getReviewQueue
// does DB work — stub those two; keep isReviewQueueSchemaBehind / schemaBehindNotice real.
vi.mock("@/lib/review-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/review-queue")>();
  return {
    ...actual,
    isReviewAdmin: (email: string | null | undefined) => email === "admin@allow",
    getReviewQueue: vi.fn(async () => ({ items: [], counts: { total: 0 } })),
  };
});

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn({})) as never,
  );
});

const base = { userId: "u1", tenantId: "11111111-2222-3333-4444-555555555555", trialExpiresAt: null };

it("403 when caller lacks review_queue.read (plain owner/trial)", async () => {
  vi.mocked(sessionOr401).mockResolvedValue({ ...base, email: "owner@example.com", status: "trial" } as never);
  const res = await GET();
  expect(res.status).toBe(403);
});

it("403 for an allowlisted email WITHOUT the DB platform-admin flag (#4591: a self-registered claim)", async () => {
  vi.mocked(sessionOr401).mockResolvedValue({ ...base, email: "admin@allow", status: "admin", platformAdmin: false } as never);
  const res = await GET();
  expect(res.status).toBe(403);
});

it("200 for a provisioned platform review admin (DB flag + allowlist email)", async () => {
  vi.mocked(sessionOr401).mockResolvedValue({ ...base, email: "admin@allow", status: "admin", platformAdmin: true } as never);
  const res = await GET();
  expect(res.status).toBe(200);
});

it("200 + schema_behind notice when withTenantContext rejects 42P01 (#4649)", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(sessionOr401).mockResolvedValue({ ...base, email: "admin@allow", status: "admin", platformAdmin: true } as never);
  vi.mocked(withTenantContext).mockRejectedValue(
    Object.assign(new Error('relation "relationship_proposals" does not exist'), { code: "42P01" }),
  );
  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.notice?.code).toBe("schema_behind");
  expect(body.notice?.sqlstate).toBe("42P01");
  expect(body.items).toEqual([]);
  expect(body.error).toBeUndefined();
});

it("200 + schema_behind notice when withTenantContext rejects 25P02 (#4649)", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(sessionOr401).mockResolvedValue({ ...base, email: "admin@allow", status: "admin", platformAdmin: true } as never);
  vi.mocked(withTenantContext).mockRejectedValue(
    Object.assign(new Error("current transaction is aborted, commands ignored until end of transaction block"), {
      code: "25P02",
    }),
  );
  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.notice?.code).toBe("schema_behind");
  expect(body.notice?.sqlstate).toBe("25P02");
  expect(body.items).toEqual([]);
  expect(body.error).toBeUndefined();
});

it("500 Queue load failed when withTenantContext rejects a generic Error", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(sessionOr401).mockResolvedValue({ ...base, email: "admin@allow", status: "admin", platformAdmin: true } as never);
  vi.mocked(withTenantContext).mockRejectedValue(new Error("connection reset"));
  const res = await GET();
  expect(res.status).toBe(500);
  const body = await res.json();
  expect(body.error).toBe("Queue load failed");
  expect(body.notice).toBeUndefined();
});
