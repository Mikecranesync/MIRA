// Unit tests for POST /api/connectors/plc/import — the Hub→mira-ingest forwarder for offline PLC
// program parsing. Auth (sessionOr401) and the ingest fetch are mocked; the live round-trip
// (Hub → ingest → parser) is verified separately on staging.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
// Mock the proposals layer so the commit path is tested without a DB.
vi.mock("@/lib/plc-proposals", () => ({
  plcReportToSuggestions: vi.fn(() => [{ suggestionType: "tag_mapping" }, { suggestionType: "kg_entity" }]),
  insertPlcSuggestions: vi.fn(async () => ["s1", "s2"]),
}));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { insertPlcSuggestions } from "@/lib/plc-proposals";

const goodSession = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  userId: "u1",
  email: "tech@example.com",
  status: "active",
  trialExpiresAt: null,
};

let fetchSpy: ReturnType<typeof vi.fn>;

function req(form: FormData): Request {
  return new Request("http://hub.test/api/connectors/plc/import", { method: "POST", body: form });
}

function l5xForm(extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append("file", new File(["<RSLogix5000Content/>"], "conveyor.L5X", { type: "application/xml" }));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.INGEST_URL = "http://mira-ingest:8001";
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  vi.mocked(sessionOr401).mockResolvedValue(goodSession);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/connectors/plc/import", () => {
  it("forwards an L5X upload and passes the parser report through (200)", async () => {
    const upstream = { report: { handled: true, uns_candidates: [{ tag: "VFD_Frequency" }] }, i3x: {} };
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 }));

    const res = await POST(req(l5xForm()) as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstream);
    // forwarded to the sidecar's plc-parse endpoint
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://mira-ingest:8001/ingest/plc-parse");
  });

  it("forwards UNS prefix overrides to the sidecar", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ report: { handled: true } }), { status: 200 }));

    await POST(req(l5xForm({ site: "Plant 2", line: "Line 3" })) as never);

    const sentForm = fetchSpy.mock.calls[0][1].body as FormData;
    expect(sentForm.get("site")).toBe("Plant 2");
    expect(sentForm.get("line")).toBe("Line 3");
  });

  it("commit=true persists proposals and reports the count", async () => {
    const upstream = { report: { handled: true, uns_candidates: [{ tag: "VFD_Frequency" }] } };
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 }));

    const res = await POST(req(l5xForm({ commit: "true" })) as never);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.committed).toBe(true);
    expect(json.proposalsCreated).toBe(2);
    expect(json.suggestionIds).toEqual(["s1", "s2"]);
    // scoped to the authenticated tenant
    expect(vi.mocked(insertPlcSuggestions).mock.calls[0][0]).toBe(goodSession.tenantId);
  });

  it("does NOT persist when commit is absent (preview/PR-B behavior)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ report: { handled: true } }), { status: 200 }),
    );
    const res = await POST(req(l5xForm()) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).committed).toBeUndefined();
    expect(vi.mocked(insertPlcSuggestions)).not.toHaveBeenCalled();
  });

  it("does NOT persist on a non-200 parse even with commit=true", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ detail: "export it to L5X first" }), { status: 422 }),
    );
    const res = await POST(req(l5xForm({ commit: "true" })) as never);
    expect(res.status).toBe(422);
    expect(vi.mocked(insertPlcSuggestions)).not.toHaveBeenCalled();
  });

  it("passes a closed-project 422 (export guidance) straight through", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ detail: "export it to L5X first" }), { status: 422 }),
    );
    const form = new FormData();
    form.append("file", new File([new Uint8Array([0, 1, 2])], "Line.ACD", { type: "application/octet-stream" }));

    const res = await POST(req(form) as never);

    expect(res.status).toBe(422);
    expect((await res.json()).detail).toContain("export");
  });

  it("rejects a missing file with 400 (no fetch)", async () => {
    const res = await POST(req(new FormData()) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("file_field_required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 503 when INGEST_URL is not configured", async () => {
    delete process.env.INGEST_URL;
    const res = await POST(req(l5xForm()) as never);
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated (no fetch)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(req(l5xForm()) as never);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
