import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  resolveI3xTenant: vi.fn(),
  sessionOr401: vi.fn(),
}));

vi.mock("@/lib/external-ai/context-skill", () => ({
  factoryLmContextSkill: {
    call: mocks.call,
  },
}));

vi.mock("@/lib/i3x/auth", () => ({
  resolveI3xTenant: mocks.resolveI3xTenant,
}));

vi.mock("@/lib/session", () => ({
  sessionOr401: mocks.sessionOr401,
}));

import { POST } from "@/app/api/factorylm/context/route";

function req(body: unknown, init: RequestInit = {}) {
  return new Request("http://x/api/factorylm/context", {
    method: "POST",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/factorylm/context", () => {
  beforeEach(() => {
    mocks.call.mockReset();
    mocks.resolveI3xTenant.mockReset();
    mocks.sessionOr401.mockReset();
  });

  it("401s when neither bearer auth nor Hub session resolves a tenant", async () => {
    mocks.resolveI3xTenant.mockResolvedValue(null);
    mocks.sessionOr401.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await POST(req({ tool: "find_asset", input: { query: "filler" } }));

    expect(res.status).toBe(401);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("uses existing i3X bearer auth when present", async () => {
    mocks.resolveI3xTenant.mockResolvedValue("tenant-i3x");
    mocks.call.mockResolvedValue({
      ok: true,
      found: true,
      tool: "find_asset",
      data: { results: [] },
      evidence: [],
      confidence: "medium",
      approvalState: "verified",
    });

    const res = await POST(req({ tool: "find_asset", input: { query: "filler" } }, {
      headers: { authorization: "Bearer good" },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.sessionOr401).not.toHaveBeenCalled();
    expect(mocks.call).toHaveBeenCalledWith({
      tool: "find_asset",
      input: { query: "filler" },
      context: { tenantId: "tenant-i3x" },
    });
  });

  it("falls back to the Hub session for internal/dev usage", async () => {
    mocks.resolveI3xTenant.mockResolvedValue(null);
    mocks.sessionOr401.mockResolvedValue({ tenantId: "tenant-session", userId: "u1", email: "a@example.com" });
    mocks.call.mockResolvedValue({
      ok: true,
      found: false,
      tool: "get_live_value",
      data: null,
      evidence: [],
      confidence: "none",
      approvalState: "not_found",
      notFoundReason: "no approved live-read tag matched",
    });

    const res = await POST(req({ tool: "get_live_value", input: { tag_or_uns_path: "line.tag" } }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(false);
    expect(mocks.call).toHaveBeenCalledWith({
      tool: "get_live_value",
      input: { tag_or_uns_path: "line.tag" },
      context: { tenantId: "tenant-session" },
    });
  });

  it("400s malformed JSON and missing tool before dispatch", async () => {
    mocks.resolveI3xTenant.mockResolvedValue("tenant-i3x");

    const malformed = await POST(req("{"));
    expect(malformed.status).toBe(400);

    const missingTool = await POST(req({ input: {} }));
    expect(missingTool.status).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("surfaces read-only refusals as 400 without hiding the envelope", async () => {
    mocks.resolveI3xTenant.mockResolvedValue("tenant-i3x");
    mocks.call.mockResolvedValue({
      ok: false,
      found: false,
      tool: "write_tag",
      data: null,
      evidence: [],
      confidence: "none",
      approvalState: "unknown",
      refusedReason: "unsupported or unsafe tool; FactoryLM external AI skill is read-only",
    });

    const res = await POST(req({ tool: "write_tag", input: { tag: "x", value: 1 } }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.refusedReason).toMatch(/read-only/i);
  });
});
