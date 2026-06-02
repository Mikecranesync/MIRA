import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// Mock the auth gate so the route runs without a real next-auth session.
vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(),
}));

import { sessionOr401 } from "@/lib/session";
import { GET, POST } from "./route";
import { __resetInventoryStore } from "@/lib/discovery-store";
import { INVENTORY_SCHEMA } from "@/lib/discovery";

const TENANT = "11111111-1111-1111-1111-111111111111";

function asAuthed(tenantId = TENANT) {
  vi.mocked(sessionOr401).mockResolvedValue({
    userId: "u-1",
    tenantId,
    email: "tech@example.com",
    status: "trial",
    trialExpiresAt: null,
  });
}

function postReq(payload: unknown) {
  return new Request("http://localhost/api/discovery", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function fixture() {
  return {
    schema: INVENTORY_SCHEMA,
    scanned_at: "2026-05-29T00:00:00Z",
    scan: { subnets: ["192.168.1.0/24"] },
    devices: [
      {
        transport: "ethernet",
        address: "192.168.1.100",
        tier: "device_identified",
        protocol: "ethernet_ip",
        profile: "micro820",
        identity: { vendor: "1", product: "2080-LC20-20QBB", serial: "D096D30C" },
        evidence: ["enip list-identity reply"],
        uns_hint: "enterprise.knowledge_base.rockwell_automation.micro820",
        next_actions: ["Deploy the Modbus map"],
      },
    ],
    unknowns: [],
  };
}

describe("api/discovery route", () => {
  beforeEach(() => {
    __resetInventoryStore();
    vi.clearAllMocks();
  });

  it("returns the 401 response when unauthenticated", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("GET returns null inventory before any upload", async () => {
    asAuthed();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inventory: null });
  });

  it("POST stores a valid payload, then GET returns it (roundtrip)", async () => {
    asAuthed();
    const postRes = await POST(postReq(fixture()));
    expect(postRes.status).toBe(200);
    const posted = await postRes.json();
    expect(posted.deviceCount).toBe(1);

    const getRes = await GET();
    const got = await getRes.json();
    expect(got.inventory.schema).toBe(INVENTORY_SCHEMA);
    expect(got.inventory.devices[0].profile).toBe("micro820");
  });

  it("POST rejects a bad schema with 400", async () => {
    asAuthed();
    const res = await POST(postReq({ ...fixture(), schema: "nope" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/schema/);
  });

  it("POST rejects invalid JSON with 400", async () => {
    asAuthed();
    const req = new Request("http://localhost/api/discovery", {
      method: "POST",
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it("isolates inventories per tenant", async () => {
    asAuthed("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    await POST(postReq(fixture()));

    asAuthed("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    const res = await GET();
    expect((await res.json()).inventory).toBeNull();
  });
});
