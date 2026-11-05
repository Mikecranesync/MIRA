/**
 * Mocked route test for GET /api/living-sheet/shift-report (S6). Flag
 * gating and window validation only need the store mocked — the report
 * body itself is covered by shift-report.test.ts (pure) and the
 * integration test (real DB). Pattern copied from
 * capabilities/living-sheet/__tests__/sheets.route.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "tech-1", email: "tech1@example.com" })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

const store = vi.hoisted(() => ({
  listJobsActiveBetween: vi.fn(),
  livingSheetStorageUnavailable: vi.fn((err: unknown) => {
    if ((err as { code?: string } | null)?.code === "42P01") {
      return { status: 503, json: async () => ({ error: "living_sheet_unavailable" }) };
    }
    return null;
  }),
}));
vi.mock("@/capabilities/living-sheet/store", () => store);

import { GET } from "./route";

function req(url: string) {
  return new NextRequest(`http://test${url}`, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_LIVING_SHEET = "1";
  store.listJobsActiveBetween.mockResolvedValue([]);
});

describe("GET /api/living-sheet/shift-report — flag", () => {
  it("flag off ⇒ 404 living_sheet_disabled, before any store call", async () => {
    delete process.env.NOTEBOOK_LIVING_SHEET;
    const res = await GET(req("/api/living-sheet/shift-report"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "living_sheet_disabled" });
    expect(store.listJobsActiveBetween).not.toHaveBeenCalled();
  });
});

describe("GET /api/living-sheet/shift-report — window validation", () => {
  it("defaults to the last 12 hours when from/to are omitted", async () => {
    const res = await GET(req("/api/living-sheet/shift-report"));
    expect(res.status).toBe(200);
    expect(store.listJobsActiveBetween).toHaveBeenCalledTimes(1);
    const [tenantId, from, to] = store.listJobsActiveBetween.mock.calls[0]!;
    expect(tenantId).toBe(TENANT);
    const spanMs = Date.parse(to) - Date.parse(from);
    expect(spanMs).toBe(12 * 60 * 60 * 1000);
  });

  it("a window wider than 7 days ⇒ 400 window_too_wide, before any store call", async () => {
    const res = await GET(
      req(`/api/living-sheet/shift-report?from=2026-01-01T00:00:00.000Z&to=2026-01-10T00:00:00.000Z`),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("window_too_wide");
    expect(store.listJobsActiveBetween).not.toHaveBeenCalled();
  });

  it("`to` before `from` ⇒ 400 invalid_window", async () => {
    const res = await GET(
      req(`/api/living-sheet/shift-report?from=2026-01-02T00:00:00.000Z&to=2026-01-01T00:00:00.000Z`),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_window");
    expect(store.listJobsActiveBetween).not.toHaveBeenCalled();
  });

  it("an unparseable date ⇒ 400 invalid_window", async () => {
    const res = await GET(req(`/api/living-sheet/shift-report?from=not-a-date&to=2026-01-01T00:00:00.000Z`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_window");
    expect(store.listJobsActiveBetween).not.toHaveBeenCalled();
  });

  it("accepts an explicit window within 7 days and returns a report", async () => {
    const res = await GET(
      req(`/api/living-sheet/shift-report?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report).toBeDefined();
    expect(body.report.emptyMessage).not.toBeNull();
  });
});

describe("GET /api/living-sheet/shift-report — storage unavailable", () => {
  it("maps a missing-table error to 503", async () => {
    store.listJobsActiveBetween.mockRejectedValue({ code: "42P01" });
    const res = await GET(req("/api/living-sheet/shift-report"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "living_sheet_unavailable" });
  });
});
