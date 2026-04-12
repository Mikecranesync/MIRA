/**
 * Unit tests for seedAssetFromNameplate (#156).
 *
 * Mocking strategy:
 *   - mock.module("@neondatabase/serverless") replaces the neon driver before
 *     the module under test is imported, so all SQL calls go to the fake.
 *   - globalThis.fetch is replaced in beforeEach to intercept Ollama embed calls.
 *
 * The mock neon sql() function intercepts tagged template calls and returns
 * canned responses, capturing call arguments for assertions.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAKE_EMBEDDING = Array.from({ length: 768 }, (_, i) => i * 0.001);

// ---------------------------------------------------------------------------
// Captured call state — populated by the mocks, reset per test
// ---------------------------------------------------------------------------

let capturedInserts: Array<{
  tenantId: string;
  sourceType: string;
  manufacturer: string;
  modelNumber: string;
  content: string;
}> = [];

let capturedCountQueries: Array<{
  manufacturer: string;
  modelNumber: string;
}> = [];

let linkedChunksResult = 3;

// ---------------------------------------------------------------------------
// Mock @neondatabase/serverless — must be called before importing the module
// under test so Bun substitutes the mock in the dynamic import() call.
// ---------------------------------------------------------------------------

mock.module("@neondatabase/serverless", () => ({
  neon: (_url: string) => {
    // Returns a tagged-template-literal compatible async function
    return async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("?").trim();
      const upper = query.toUpperCase();

      if (upper.includes("SELECT COUNT")) {
        // values[0] = manufacturer, values[1] = modelNumber
        capturedCountQueries.push({
          manufacturer: String(values[0] ?? ""),
          modelNumber: String(values[1] ?? ""),
        });
        return [{ cnt: String(linkedChunksResult) }];
      }

      if (upper.includes("INSERT INTO KNOWLEDGE_ENTRIES")) {
        // Template literal positions:
        //   $1=id, $2=tenantId, $3=sourceType, $4=manufacturer,
        //   $5=modelNumber, $6=content, $7=embeddingStr, $8='atlas-seed', $9=0,
        //   $10=metadataStr, ...
        capturedInserts.push({
          tenantId: String(values[1] ?? ""),
          sourceType: String(values[2] ?? ""),
          manufacturer: String(values[3] ?? ""),
          modelNumber: String(values[4] ?? ""),
          content: String(values[5] ?? ""),
        });
        return [];
      }

      return [];
    };
  },
}));

// Import the module under test AFTER mock.module is registered
const { seedAssetFromNameplate } = await import("../knowledge-seed.js");

// ---------------------------------------------------------------------------
// Fetch mock — intercepts Ollama embed calls
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  capturedInserts = [];
  capturedCountQueries = [];
  linkedChunksResult = 3;
  originalFetch = globalThis.fetch;

  process.env.NEON_DATABASE_URL = "postgresql://fake:fake@fake/fake";
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  delete process.env.MCP_REST_API_KEY;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;

    // mira-mcp embed proxy — 404 forces Ollama fallback
    if (url.includes("/api/embed") && !url.includes("/api/embeddings")) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }

    // Ollama embeddings endpoint
    if (url.includes("/api/embeddings")) {
      return new Response(
        JSON.stringify({ embedding: FAKE_EMBEDDING }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("not found", { status: 404 });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.NEON_DATABASE_URL;
  delete process.env.OLLAMA_BASE_URL;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("seedAssetFromNameplate", () => {
  it("returns { linkedChunks: 3, inserted: 1 } for a fully-specified nameplate", async () => {
    const result = await seedAssetFromNameplate("tenant-a", {
      manufacturer: "AutomationDirect",
      modelNumber: "GS1-45P0",
      serial: "S123",
      voltage: "460V",
      fla: "7.6A",
      hp: "5",
      frequency: "60Hz",
      rpm: "1750",
    });

    expect(result.linkedChunks).toBe(3);
    expect(result.inserted).toBe(1);
  });

  it("calls NeonDB with correct manufacturer and model for OEM lookup", async () => {
    await seedAssetFromNameplate("tenant-a", {
      manufacturer: "AutomationDirect",
      modelNumber: "GS1-45P0",
      serial: "S123",
    });

    expect(capturedCountQueries.length).toBeGreaterThanOrEqual(1);
    const q = capturedCountQueries[capturedCountQueries.length - 1];
    expect(q.manufacturer).toBe("AutomationDirect");
    expect(q.modelNumber).toBe("GS1-45P0");
  });

  it("inserts a knowledge entry scoped to tenantId with sourceType nameplate_asset", async () => {
    await seedAssetFromNameplate("tenant-a", {
      manufacturer: "AutomationDirect",
      modelNumber: "GS1-45P0",
      serial: "S123",
    });

    expect(capturedInserts.length).toBeGreaterThanOrEqual(1);
    const row = capturedInserts[capturedInserts.length - 1];
    expect(row.tenantId).toBe("tenant-a");
    expect(row.sourceType).toBe("nameplate_asset");
    expect(row.manufacturer).toBe("AutomationDirect");
    expect(row.modelNumber).toBe("GS1-45P0");
  });

  it("includes serial number in chunk content when provided", async () => {
    await seedAssetFromNameplate("tenant-a", {
      manufacturer: "AutomationDirect",
      modelNumber: "GS1-45P0",
      serial: "S123",
    });

    expect(capturedInserts.length).toBeGreaterThanOrEqual(1);
    const row = capturedInserts[capturedInserts.length - 1];
    expect(row.content).toContain("S123");
    expect(row.content).toContain("AutomationDirect GS1-45P0");
  });

  it("omits Specifications line when no spec fields are provided", async () => {
    await seedAssetFromNameplate("tenant-a", {
      manufacturer: "AutomationDirect",
      modelNumber: "GS1-45P0",
      // no voltage, fla, hp, frequency, rpm
    });

    expect(capturedInserts.length).toBeGreaterThanOrEqual(1);
    const row = capturedInserts[capturedInserts.length - 1];
    expect(row.content).not.toContain("Specifications:");
  });

  it("returns inserted: 0 when NEON_DATABASE_URL is unset", async () => {
    delete process.env.NEON_DATABASE_URL;

    const result = await seedAssetFromNameplate("tenant-a", {
      manufacturer: "AutomationDirect",
      modelNumber: "GS1-45P0",
    });

    expect(result.linkedChunks).toBe(0);
    expect(result.inserted).toBe(0);
  });
});
