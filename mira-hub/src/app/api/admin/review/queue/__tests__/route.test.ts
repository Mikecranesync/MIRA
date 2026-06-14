// #1932: the review-queue route must reject callers who lack review_queue.read
// (403) and serve those who have it (200) — via the shared requireCapability
// guard, so the gate matches what the nav shows.

import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
// isReviewAdmin (used by capabilities) is the platform allowlist. getReviewQueue
// does DB work — stub both; let isReviewAdmin recognize one test email.
vi.mock("@/lib/review-queue", () => ({
  isReviewAdmin: (email: string | null | undefined) => email === "admin@allow",
  getReviewQueue: vi.fn(async () => ({ items: [], counts: { total: 0 } })),
}));

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

it("200 for a platform review admin (allowlist email)", async () => {
  vi.mocked(sessionOr401).mockResolvedValue({ ...base, email: "admin@allow", status: "trial" } as never);
  const res = await GET();
  expect(res.status).toBe(200);
});
