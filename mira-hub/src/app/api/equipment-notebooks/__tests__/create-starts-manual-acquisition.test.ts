/**
 * #4075 — creating a notebook hands its confirmed identity to the background
 * official-manual search (which runs in the background — see
 * notebook-manual-acquisition.test.ts for the never-awaited contract).
 *
 * Run: npx vitest run src/app/api/equipment-notebooks/__tests__/create-starts-manual-acquisition.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
const domain = vi.hoisted(() => ({
  createNotebook: vi.fn(async (_t: string, input: Record<string, unknown>) => ({
    id: "22222222-2222-4222-8222-222222222222",
    nodeId: "n1",
    displayName: input.displayName,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    catalogNumber: input.catalogNumber ?? null,
    identityStatus: input.identityStatus,
  })),
  listNotebooks: vi.fn(),
  listThreads: vi.fn(),
}));
vi.mock("@/lib/equipment-notebooks", () => domain);
const acq = vi.hoisted(() => ({ startManualAcquisition: vi.fn(async () => true) }));
vi.mock("@/capabilities/notebook-manual-acquisition", () => acq);

import { POST } from "../route";

const req = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/equipment-notebooks → manual acquisition", () => {
  it("passes the CREATED notebook's own identity (not the raw body) to the search", async () => {
    const res = await POST(
      req({
        displayName: "SMC VQ1000-FPG-C6C6-D",
        manufacturer: "SMC",
        model: "VQ1000-FPG-C6C6-D",
        identityStatus: "user_confirmed",
        identitySourceType: "nameplate_image",
      }),
    );
    expect(res.status).toBe(201);
    expect(acq.startManualAcquisition).toHaveBeenCalledTimes(1);
    expect(acq.startManualAcquisition).toHaveBeenCalledWith({
      tenantId: "11111111-1111-4111-8111-111111111111",
      userId: "u1",
      notebookId: "22222222-2222-4222-8222-222222222222",
      nodeId: "n1",
      identity: { identityStatus: "user_confirmed", manufacturer: "SMC", model: "VQ1000-FPG-C6C6-D", catalogNumber: null },
    });
  });

  it("an unconfirmed create still calls the gate, which decides nothing qualifies (status 'unknown')", async () => {
    await POST(req({ displayName: "Some box", manufacturer: "SMC", model: "VQ1000" }));
    const arg = (acq.startManualAcquisition.mock.calls[0] as unknown[])[0] as { identity: { identityStatus: string } };
    expect(arg.identity.identityStatus).toBe("unknown");
  });

  it("a validation failure never starts a search", async () => {
    const res = await POST(req({ displayName: "  " }));
    expect(res.status).toBe(400);
    expect(acq.startManualAcquisition).not.toHaveBeenCalled();
  });
});
