// Lives outside src/app/** because every test file there is a lifecycle-guarded
// path; the route under test is imported by alias.
//
// Codex review of #4091 at 1082ad199, F6: doc-scoped node chat on a duplicate
// upload 404'd — the filename lookup reads the document's OWN chunks, and a
// "duplicate of <original>" upload owns none. The lookup now follows the
// tenant-validated alias to the original, while retrieval and admission keep
// the id the technician opened (retrieveNodeChunks relabels the original's
// chunks with it).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/workspace-files", () => ({ linkedDocIdsForNode: vi.fn(async () => []) }));
vi.mock("@/lib/uploads", () => ({ resolveDuplicateDocAliases: vi.fn() }));
vi.mock("@/lib/manual-rag", () => ({
  retrieveNodeChunks: vi.fn(),
  buildDocScopedSystemPrompt: vi.fn(() => "doc-scoped prompt"),
  appendManualContext: vi.fn((prompt: string) => prompt),
  buildManualUserContent: vi.fn((content: string) => content),
  chunksToSources: vi.fn(() => []),
}));

import { POST } from "@/app/api/namespace/node/[id]/chat/route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { resolveDuplicateDocAliases } from "@/lib/uploads";

const NODE = "11111111-2222-3333-4444-555555555555";
const TENANT = "22222222-2222-4222-8222-222222222222";
const ORIG = "aaaaaaaa-0000-4000-8000-00000000000a";
const DUP = "dddddddd-0000-4000-8000-00000000000d";

const req = (docId: string) =>
  new Request(`https://hub.test/api/namespace/node/${NODE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "what does F004 mean" }], docId }),
  });

const filenameLookups: unknown[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  filenameLookups.length = 0;
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.GROQ_API_KEY = "test-key";
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(sessionOr401).mockResolvedValue({
    userId: "u_1",
    tenantId: TENANT,
    email: "x@y",
    status: "trial",
    trialExpiresAt: null,
  } as never);
  vi.mocked(retrieveNodeChunks).mockResolvedValue([]);
  vi.mocked(withTenantContext).mockImplementation(async (_t, fn) =>
    fn({
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("FROM kg_entities")) return { rows: [{ name: "Inbox", uns_path: null }] };
        if (sql.includes("metadata->>'filename'")) {
          filenameLookups.push(params[1]);
          // Only the ORIGINAL owns chunks.
          return { rows: params[1] === ORIG ? [{ filename: "manual.pdf" }] : [] };
        }
        return { rows: [] };
      }),
    } as never),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("doc-scoped node chat on a duplicate upload (F6)", () => {
  it("finds the document through its original, and retrieves under the id that was opened", async () => {
    vi.mocked(resolveDuplicateDocAliases).mockResolvedValue(new Map([[DUP, ORIG]]));
    const res = await POST(req(DUP), { params: Promise.resolve({ id: NODE }) });
    expect(res.status).not.toBe(404);
    expect(filenameLookups).toEqual([ORIG]);
    expect(vi.mocked(retrieveNodeChunks).mock.calls[0]?.[3]).toMatchObject({ docId: DUP, approvedSourceDocIds: [DUP] });
  });

  it("control: a document that owns no chunks and is not a duplicate is still a 404", async () => {
    vi.mocked(resolveDuplicateDocAliases).mockResolvedValue(new Map());
    const res = await POST(req(DUP), { params: Promise.resolve({ id: NODE }) });
    expect(res.status).toBe(404);
    expect(filenameLookups).toEqual([DUP]);
  });
});
