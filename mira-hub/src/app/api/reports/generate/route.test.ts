import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { NextResponse } from "next/server";
import { POST } from "./route";

// Mock dependencies
vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(),
}));

vi.mock("@/lib/capabilities", () => ({
  requireCapability: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(),
}));

import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";

const mockSessionOr401 = vi.mocked(sessionOr401);
const mockRequireCapability = vi.mocked(requireCapability);
// Loosely-typed so `.mockResolvedValueOnce({ rows })` type-checks — pg's
// overloaded `query` makes `vi.mocked` infer a `void` resolve type otherwise.
const mockPoolQuery = vi.mocked(pool.query) as unknown as Mock;
const mockWithTenantContext = vi.mocked(withTenantContext);
// Loosely-typed fetch mock so resolved `{ ok, json }` fixtures and `mock.calls`
// indexing type-check without per-site `Response`/undefined casts.
let mockFetch: Mock;

describe("POST /api/reports/generate", () => {
  const TENANT_ID = "12345678-1234-5678-1234-567812345678";

  beforeEach(() => {
    vi.clearAllMocks();

    // Set API keys so LLM providers are available (match the repo-wide test
    // convention "test-key" — the chat route tests use the same, and the
    // Secrets Scan/gitleaks gate accepts it).
    process.env.GROQ_API_KEY = "test-key";
    process.env.CEREBRAS_API_KEY = "test-key";
    process.env.GEMINI_API_KEY = "test-key";
    process.env.NEON_DATABASE_URL = "postgresql://test";

    // Default mock session
    mockSessionOr401.mockResolvedValue({
      tenantId: TENANT_ID,
      userId: "user-123",
      email: "test@example.com",
      status: "active",
      trialExpiresAt: null,
    });

    // Default: no capability denial
    mockRequireCapability.mockReturnValue(null);

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.GROQ_API_KEY;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.NEON_DATABASE_URL;
  });

  describe("data assembly with real work orders", () => {
    it("should query tenant's real work_orders, not the static fixture", async () => {
      const mockWorkOrders = [
        {
          id: "wo-1",
          work_order_number: "WO-001",
          equipment_id: "eq-1",
          manufacturer: "Dorner",
          model_number: "2100",
          status: "open",
          priority: "high",
          created_at: "2026-06-01T10:00:00Z",
          updated_at: "2026-06-02T10:00:00Z",
          closed_at: null,
          source: "telegram",
          title: "Belt slipping",
          description: "Main belt needs retensioning",
          tenant_id: TENANT_ID,
        },
        {
          id: "wo-2",
          work_order_number: "WO-002",
          equipment_id: "eq-1",
          manufacturer: "Dorner",
          model_number: "2100",
          status: "completed",
          priority: "medium",
          created_at: "2026-05-15T09:00:00Z",
          updated_at: "2026-05-15T10:00:00Z",
          closed_at: "2026-05-15T11:00:00Z",
          source: "telegram",
          title: "Scheduled PM",
          description: "Regular maintenance",
          tenant_id: TENANT_ID,
        },
        {
          id: "wo-3",
          work_order_number: "WO-003",
          equipment_id: "eq-2",
          manufacturer: "Allen-Bradley",
          model_number: "PowerFlex 755",
          status: "open",
          priority: "critical",
          created_at: "2026-06-03T14:00:00Z",
          updated_at: "2026-06-04T14:00:00Z",
          closed_at: null,
          source: "hub_ui",
          title: "VFD fault",
          description: "Communication error",
          tenant_id: TENANT_ID,
        },
      ];

      // Mock the withTenantContext callback to return work orders
      mockWithTenantContext.mockImplementationOnce(
        ((_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn().mockResolvedValue({ rows: mockWorkOrders }) })) as never,
      );

      // Mock equipment lookup
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ total: 5, crit: 2 }],
      });

      // Mock LLM response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Test narrative" } }],
        }),
      });

      const response = await POST();

      // Verify it's using withTenantContext
      expect(mockWithTenantContext).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));

      // Parse response
      const json = await response.json();
      if (json.error) {
        console.log("Response error:", json);
        throw new Error(`Route returned error: ${json.error}`);
      }
      const stats = json.stats;

      // Verify stats come from real data, not fixture
      expect(stats.total).toBe(3);
      expect(stats.open).toBe(2); // wo-1 and wo-3
      expect(stats.completed).toBe(1); // wo-2
      expect(stats.criticalWOs).toBe(1); // wo-3
      expect(stats.inprogress).toBe(0);

      // The top problem asset should be Dorner 2100 (2 work orders), not "Air Compressor #1"
      expect(stats.topProblemAsset).toBe("Dorner 2100");
      expect(stats.topProblemAssetWOs).toBe(2);
      expect(stats.topProblemAsset).not.toContain("Air Compressor");

      // Verify the prompt sent to LLM contains real asset, not fabricated one
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const prompt = body.messages[0].content;

      // Prompt should contain real top asset
      expect(prompt).toContain("Dorner 2100");
      expect(prompt).not.toContain("Air Compressor #1");
    });
  });

  describe("empty work orders — no fabrication", () => {
    it("should produce 'none' sentinel for top asset when no work orders exist", async () => {
      // Mock empty work orders
      mockWithTenantContext.mockImplementationOnce(
        ((_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) })) as never,
      );

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ total: 3, crit: 1 }],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "No work order activity" } }],
        }),
      });

      const response = await POST();
      const json = await response.json();
      const stats = json.stats;

      // All WO stats should be zero
      expect(stats.total).toBe(0);
      expect(stats.open).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.topProblemAsset).toBe("none");
      expect(stats.topProblemAssetWOs).toBe(0);

      // Verify the prompt includes grounding instruction
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const prompt = body.messages[0].content;

      // Prompt should have grounding instruction
      expect(prompt).toContain("Do NOT invent");
      expect(prompt).toContain("insufficient activity");
    });

    it("should include anti-fabrication instruction in prompt", async () => {
      mockWithTenantContext.mockImplementationOnce(
        ((_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) })) as never,
      );

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ total: 0, crit: 0 }],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Test" } }],
        }),
      });

      await POST();

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const prompt = body.messages[0].content;

      // Verify anti-fabrication instruction is present
      expect(prompt).toMatch(/Base.*ONLY on the data provided|Do NOT invent|assume|reference.*not present/i);
    });
  });

  describe("MTTR handling", () => {
    it("should compute MTTR from real closed_at timestamps when available", async () => {
      const mockWorkOrders = [
        {
          id: "wo-1",
          work_order_number: "WO-001",
          equipment_id: "eq-1",
          manufacturer: "Test",
          model_number: "Asset",
          status: "completed",
          priority: "medium",
          created_at: "2026-06-01T10:00:00Z",
          updated_at: "2026-06-01T13:00:00Z",
          closed_at: "2026-06-01T13:00:00Z", // 3 hours later
          source: "hub_ui",
          title: "Test",
          description: "Test",
          tenant_id: TENANT_ID,
        },
        {
          id: "wo-2",
          work_order_number: "WO-002",
          equipment_id: "eq-1",
          manufacturer: "Test",
          model_number: "Asset",
          status: "completed",
          priority: "medium",
          created_at: "2026-06-01T10:00:00Z",
          updated_at: "2026-06-01T15:00:00Z",
          closed_at: "2026-06-01T15:00:00Z", // 5 hours later
          source: "hub_ui",
          title: "Test",
          description: "Test",
          tenant_id: TENANT_ID,
        },
      ];

      mockWithTenantContext.mockImplementationOnce(
        ((_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn().mockResolvedValue({ rows: mockWorkOrders }) })) as never,
      );

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ total: 1, crit: 0 }],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Test" } }],
        }),
      });

      const response = await POST();
      const json = await response.json();
      const stats = json.stats;

      // MTTR should be 4 hours (average of 3 and 5)
      expect(stats.mttrHours).toBe(4);
    });
  });

  describe("authentication and authorization", () => {
    it("should return 401 if session fails", async () => {
      mockSessionOr401.mockResolvedValueOnce(
        new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
      );

      const response = await POST();
      expect(response.status).toBe(401);
    });

    it("should return 403 if capability is denied", async () => {
      mockRequireCapability.mockReturnValueOnce(
        new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403 })
      );

      const response = await POST();
      expect(response.status).toBe(403);
    });
  });

  describe("backward compatibility", () => {
    it("should preserve response JSON shape with stats keys", async () => {
      const mockWorkOrders = [
        {
          id: "wo-1",
          work_order_number: "WO-001",
          equipment_id: "eq-1",
          manufacturer: "Test",
          model_number: "Asset",
          status: "open",
          priority: "medium",
          created_at: "2026-06-01T10:00:00Z",
          updated_at: "2026-06-02T10:00:00Z",
          closed_at: null,
          source: "hub_ui",
          title: "Test",
          description: "Test",
          tenant_id: TENANT_ID,
        },
      ];

      mockWithTenantContext.mockImplementationOnce(
        ((_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn().mockResolvedValue({ rows: mockWorkOrders }) })) as never,
      );

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ total: 1, crit: 0 }],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Test narrative" } }],
        }),
      });

      const response = await POST();
      const json = await response.json();

      // Verify expected shape
      expect(json).toHaveProperty("narrative");
      expect(json).toHaveProperty("stats");
      expect(json).toHaveProperty("generatedAt");

      // Verify stats has expected keys (backward compat)
      const stats = json.stats;
      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("open");
      expect(stats).toHaveProperty("inprogress");
      expect(stats).toHaveProperty("completed");
      expect(stats).toHaveProperty("overdue");
      expect(stats).toHaveProperty("mttrHours");
      expect(stats).toHaveProperty("topProblemAsset");
      expect(stats).toHaveProperty("topProblemAssetWOs");
      expect(stats).toHaveProperty("criticalWOs");
      expect(stats).toHaveProperty("assetCount");
      expect(stats).toHaveProperty("criticalAssets");
    });
  });
});
