/**
 * Unit tests for seedAssetFromNameplate (#156) and
 * POST /api/provision/nameplate endpoint (#157).
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

// ---------------------------------------------------------------------------
// POST /api/provision/nameplate — endpoint tests (#157)
// ---------------------------------------------------------------------------

describe("POST /api/provision/nameplate", () => {
  // Lazy-import the Hono app so that mock.module overrides above are already
  // in effect when server.ts runs its top-level imports.
  let app: { fetch: (req: Request) => Promise<Response> };

  const FAKE_MCP_KEY = "test-mcp-rest-api-key";
  const TENANT_ID = "tenant-test-1234";

  const VALID_BODY = {
    tenant_id: TENANT_ID,
    nameplate: {
      manufacturer: "AutomationDirect",
      modelNumber: "GS1-45P0",
      serial: "SN-999",
      voltage: "460V",
    },
  };

  beforeEach(async () => {
    process.env.MCP_REST_API_KEY = FAKE_MCP_KEY;
    process.env.PLG_JWT_SECRET = "test-jwt-secret-at-least-32-chars-long";
    process.env.NEON_DATABASE_URL = "postgresql://fake:fake@fake/fake";
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";

    // Fresh import each time so env vars take effect
    const mod = await import("../../server.js");
    app = mod.default as typeof app;
  });

  function post(body: unknown, authHeader?: string): Promise<Response> {
    return app.fetch(
      new Request("http://localhost/api/provision/nameplate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  }

  it("returns 200 ok with linkedChunks and inserted when service token is valid", async () => {
    const res = await post(VALID_BODY, `Bearer ${FAKE_MCP_KEY}`);
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(typeof json.linkedChunks).toBe("number");
    expect(typeof json.inserted).toBe("number");
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await post(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is present but not service key and not a valid JWT", async () => {
    const res = await post(VALID_BODY, "Bearer not-a-valid-token");
    expect(res.status).toBe(401);
  });

  it("returns 400 when tenant_id is missing from body", async () => {
    const res = await post(
      { nameplate: { manufacturer: "AutomationDirect", modelNumber: "GS1-45P0" } },
      `Bearer ${FAKE_MCP_KEY}`,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(typeof json.error).toBe("string");
  });

  it("returns 400 when nameplate is missing manufacturer", async () => {
    const res = await post(
      { tenant_id: TENANT_ID, nameplate: { modelNumber: "GS1-45P0" } },
      `Bearer ${FAKE_MCP_KEY}`,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when nameplate is missing modelNumber", async () => {
    const res = await post(
      { tenant_id: TENANT_ID, nameplate: { manufacturer: "AutomationDirect" } },
      `Bearer ${FAKE_MCP_KEY}`,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when nameplate field is absent entirely", async () => {
    const res = await post(
      { tenant_id: TENANT_ID },
      `Bearer ${FAKE_MCP_KEY}`,
    );
    expect(res.status).toBe(400);
  });
});
