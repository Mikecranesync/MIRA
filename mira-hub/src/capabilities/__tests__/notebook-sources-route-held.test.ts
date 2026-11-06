// Lives outside src/app/** because every test file there is a lifecycle-guarded
// path; the route under test is imported by alias.
//
// Codex review of #4091 at 1082ad199, F7: POST /api/equipment-notebooks/:id/sources
// attaches a document the technician picked from elsewhere, so it must use the
// attach that holds the upload row (attachSourceHeld), never the unlocked one.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  attachSource: vi.fn(async () => ({ ok: true })),
  attachSourceHeld: vi.fn(async () => ({ ok: true })),
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/sources/route";
import { sessionOr401 } from "@/lib/session";
import { attachSource, attachSourceHeld } from "@/lib/equipment-notebooks";

const NB = "eeeeeeee-0000-4000-8000-00000000000e";
const DOC = "dddddddd-0000-4000-8000-00000000000d";

const post = (body: unknown) =>
  POST(
    new Request(`https://hub.test/api/equipment-notebooks/${NB}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: NB }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({ userId: "u_1", tenantId: "t-1" } as never);
});

describe("notebook sources route attaches under the upload-row hold (F7)", () => {
  it("201 through attachSourceHeld, never the unlocked attachSource", async () => {
    const res = await post({ docId: DOC });
    expect(res.status).toBe(201);
    expect(attachSourceHeld).toHaveBeenCalledWith("t-1", NB, DOC, expect.objectContaining({ matchState: "user_confirmed" }));
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("a delete that won first surfaces as 404 doc_not_found", async () => {
    vi.mocked(attachSourceHeld).mockResolvedValueOnce({ ok: false, error: "doc_not_found" });
    const res = await post({ docId: DOC });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "doc_not_found" });
  });
});
