import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/contextualization/unzip", () => ({ readZipEntries: vi.fn() }));
vi.mock("@/lib/contextualization/bundle-import", () => ({ parseBundle: vi.fn() }));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { readZipEntries } from "@/lib/contextualization/unzip";
import { parseBundle } from "@/lib/contextualization/bundle-import";

const TENANT = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const BATCH_ID = "33333333-3333-3333-3333-333333333333";
const SOURCE_ID = "44444444-4444-4444-4444-444444444444";

function bundleReq(): Request {
  const form = new FormData();
  form.append("file", new File(["bundle"], "context-bundle.zip", { type: "application/zip" }));
  return new Request("http://hub.test/api/contextualization/import", { method: "POST", body: form });
}

function makeClient() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("INSERT INTO contextualization_projects")) return { rows: [{ id: PROJECT_ID }] };
    if (sql.includes("SELECT id FROM contextualization_projects")) return { rows: [{ id: PROJECT_ID }] };
    if (sql.includes("INSERT INTO ctx_import_batches")) return { rows: [{ id: BATCH_ID }] };
    if (sql.includes("SELECT id FROM ctx_import_batches")) return { rows: [{ id: BATCH_ID }] };
    if (sql.includes("INSERT INTO ctx_sources")) return { rows: [{ id: SOURCE_ID }] };
    return { rows: [] };
  });
  return { client: { query }, calls };
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://unit-test";
  vi.mocked(sessionOr401).mockResolvedValue({
    tenantId: TENANT,
    userId: "u1",
    email: "tech@example.com",
    status: "active",
    trialExpiresAt: null,
  });
  vi.mocked(readZipEntries).mockReturnValue({
    "manifest.json": Buffer.from("{}"),
    "review.json": Buffer.from("{}"),
  });
  vi.mocked(parseBundle).mockReturnValue({
    projectName: "Garage Conveyor",
    description: "Offline context bundle",
    sources: [{ fileName: "conveyor.L5X", sourceType: "l5x", status: "done" }],
    extractions: [
      {
        tagName: "Conv_Run",
        roles: ["output"],
        unsPathProposed: "enterprise.garage.demo.conv.run",
        i3xElementId: null,
        evidenceJson: { source: "offline" },
        confidence: 0.9,
        status: "accepted",
        sourceFile: "conveyor.L5X",
      },
    ],
  });
});

afterEach(() => {
  delete process.env.NEON_DATABASE_URL;
});

describe("POST /api/contextualization/import - legacy bundle", () => {
  it("stages bundle imports through an import batch and attaches sources to it", async () => {
    const { client, calls } = makeClient();
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId, fn) => fn(client as never));

    const res = await POST(bundleReq());

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.importBatchId).toBe(BATCH_ID);

    expect(calls.some((c) => c.sql.includes("INSERT INTO ctx_import_batches"))).toBe(true);
    const sourceInsert = calls.find((c) => c.sql.includes("INSERT INTO ctx_sources"));
    expect(sourceInsert?.sql).toContain("import_batch_id");
    expect(sourceInsert?.params).toContain(BATCH_ID);
  });
});
