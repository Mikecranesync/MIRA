// Vitest coverage for GET + POST /api/assets/[id]/validation-qa.

import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { GET, POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const ID = "11111111-2222-3333-4444-555555555555";
const session = { userId: "u_1", tenantId: "tenant-aaaa", email: "x@y" };
const params = Promise.resolve({ id: ID });

function mockClient(handlers: Array<[RegExp, { rows: unknown[] }]>) {
  return {
    query: vi.fn(async (sql: string) => {
      for (const [re, res] of handlers) if (re.test(sql)) return res;
      return { rows: [] };
    }),
  };
}
function wire(client: { query: ReturnType<typeof vi.fn> }) {
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn(client)) as never,
  );
}
const ASSET_OK: [RegExp, { rows: unknown[] }] = [
  /FROM cmms_equipment/,
  { rows: [{ "?column?": 1 }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue(session as never);
});

it("GET 404 when asset missing", async () => {
  wire(mockClient([[/FROM cmms_equipment/, { rows: [] }]]));
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(404);
});

it("GET returns the transcript shaped for the UI", async () => {
  wire(
    mockClient([
      ASSET_OK,
      [
        /FROM asset_validation_qa/,
        {
          rows: [
            {
              id: "q1",
              question: "Why faulted?",
              citations: [{ doc_id: "d", page: 6 }],
              reviewer_verdict: "good",
              created_at: "2026-06-07",
            },
          ],
        },
      ],
    ]),
  );
  const res = await GET(new Request("http://t"), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body[0].reviewerVerdict).toBe("good");
  expect(body[0].citations[0].page).toBe(6);
});

it("POST 400 when question is blank", async () => {
  wire(mockClient([ASSET_OK]));
  const res = await POST(
    new Request("http://t", { method: "POST", body: JSON.stringify({ question: "  " }) }),
    { params },
  );
  expect(res.status).toBe(400);
});

it("POST 201 records a validation turn", async () => {
  wire(
    mockClient([
      ASSET_OK,
      [/INSERT INTO asset_agent_status/, { rows: [] }],
      [
        /INSERT INTO asset_validation_qa/,
        { rows: [{ id: "q2", question: "Reset procedure?", citations: [] }] },
      ],
    ]),
  );
  const res = await POST(
    new Request("http://t", {
      method: "POST",
      body: JSON.stringify({ question: "Reset procedure?", groundedness: 9 }),
    }),
    { params },
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.id).toBe("q2");
});
