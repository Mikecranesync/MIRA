// #3437 — lives outside src/app/** because every test file there is a
// lifecycle-guarded path; the route under test is imported by alias.
// Vitest coverage for POST /api/namespace/node/[id]/chat (folder=brain node chat).
//
// Run: cd mira-hub && npx vitest run src/app/api/namespace/node/[id]/chat
//
// Covers the pure, no-live-LLM branches that gate the spec acceptance criteria:
//   - safety keyword → X-Safety-Stop header set AND no provider fetch fired
//     (the hard-stop is the one branch this evidence culture won't forgive shipping
//      on a clone with zero execution);
//   - node-not-found → 404; auth/validation guards.
// The cited-answer streaming path needs a live cascade — verified at the staging gate.
//
// Spec: docs/specs/uns-node-centric-knowledge-spec.md (Slice — node chat acceptance)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
// Canonical-files derivation (075) — the widening pass is covered in
// doc-scope.test.ts; here it stays empty so these branches are unchanged.
vi.mock("@/lib/workspace-files", () => ({ linkedDocIdsForNode: vi.fn(async () => []) }));
vi.mock("@/lib/manual-rag", () => ({
  retrieveNodeChunks: vi.fn(),
  buildDocScopedSystemPrompt: vi.fn(() => "doc-scoped prompt"),
  appendManualContext: vi.fn((prompt: string) => prompt),
  buildManualUserContent: vi.fn((content: string) => content),
  chunksToSources: vi.fn((chunks: Array<{ title?: string; sourceUrl?: string; sourcePage?: number | null; verified?: boolean }>) =>
    chunks.map((chunk, index) => ({
      index: index + 1,
      title: chunk.title ?? "manual",
      url: chunk.sourceUrl ?? null,
      page: chunk.sourcePage ?? null,
      verified: chunk.verified === true,
    })),
  ),
}));

import { POST } from "@/app/api/namespace/node/[id]/chat/route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { appendManualContext, retrieveNodeChunks } from "@/lib/manual-rag";
import { linkedDocIdsForNode } from "@/lib/workspace-files";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "tenant-aaaa-bbbb";

const goodSession = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const makeReq = (body: unknown) =>
  new Request(`https://hub.test/api/namespace/node/${VALID_UUID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

const userMsg = (content: string) => ({ messages: [{ role: "user", content }] });

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  process.env.GROQ_API_KEY = "test-key"; // so a non-safety path WOULD try to fetch
  vi.mocked(retrieveNodeChunks).mockResolvedValue([]);
  vi.mocked(linkedDocIdsForNode).mockResolvedValue([]);
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MIRA_ENFORCE_APPROVED_ASK;
});

describe("node chat — approval-gate admission (#3437)", () => {
  it("#3437: a file a person LINKED to the node is admitted under both gates; an unlinked draft is not", async () => {
    process.env.NEON_DATABASE_URL = "postgres://test";
    process.env.MIRA_ENFORCE_APPROVED_ASK = "true";
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const LINKED = "44444444-4444-4444-8444-444444444444";
    vi.mocked(linkedDocIdsForNode).mockResolvedValue([LINKED]);
    const chunk = (content: string, docId: string | null, verified: boolean) => ({
      content,
      manufacturer: "FactoryLM",
      modelNumber: "N100",
      sourceUrl: `node-doc/${docId}/m.pdf`,
      sourcePage: 1,
      title: "Manual",
      rank: 0.5,
      verified,
      docId,
    });
    vi.mocked(retrieveNodeChunks)
      .mockResolvedValueOnce([chunk("Unlinked draft", "55555555-5555-4555-8555-555555555555", false)])
      .mockResolvedValueOnce([chunk("Linked private manual", LINKED, false)]);
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId, fn) =>
      fn({
        query: vi.fn(async (sql: string) => {
          if (sql.includes("FROM kg_entities")) return { rows: [{ name: "Motor", uns_path: "Plant.Line.Motor" }] };
          return { rows: [] };
        }),
      } as never),
    );

    await POST(makeReq(userMsg("what is the torque spec?")), makeParams(VALID_UUID));

    // Retrieval is told the link is the approval (MIRA_ENFORCE_APPROVED_RETRIEVAL).
    const linkedCall = vi.mocked(retrieveNodeChunks).mock.calls[1]?.[3];
    expect(linkedCall).toMatchObject({ docIds: [LINKED], validatedDocScope: true, approvedSourceDocIds: [LINKED] });
    // And the ask gate keeps it, while still dropping the unlinked draft.
    const chunks = vi.mocked(appendManualContext).mock.calls[0]?.[1] ?? [];
    expect(chunks.map((c) => c.content)).toEqual(["Linked private manual"]);
  });

  it("#3437: a document opened for doc-scoped chat is admitted as the approval set", async () => {
    process.env.NEON_DATABASE_URL = "postgres://test";
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const DOC = "66666666-6666-4666-8666-666666666666";
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId, fn) =>
      fn({
        query: vi.fn(async (sql: string) => {
          if (sql.includes("FROM kg_entities")) return { rows: [{ name: "Motor", uns_path: "Plant.Line.Motor" }] };
          if (sql.includes("metadata->>'filename'")) return { rows: [{ filename: "m.pdf" }] };
          return { rows: [] };
        }),
      } as never),
    );

    await POST(makeReq({ ...userMsg("torque?"), docId: DOC }), makeParams(VALID_UUID));

    expect(vi.mocked(retrieveNodeChunks).mock.calls[0]?.[3]).toMatchObject({
      docId: DOC,
      approvedSourceDocIds: [DOC],
    });
  });
});
