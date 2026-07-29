import { describe, expect, it, vi } from "vitest";

// Mock auth: no header => null (401); "Bearer good" => tenant "t1".
vi.mock("@/lib/i3x/auth", () => ({
  resolveI3xTenant: async (req: Request) =>
    req.headers.get("authorization") === "Bearer good" ? "t1" : null,
}));

import { GET as info } from "@/app/api/i3x/v1/info/route";
import { GET as namespaces } from "@/app/api/i3x/v1/namespaces/route";
import { PUT as valuePut } from "@/app/api/i3x/v1/objects/value/route";
import fixture from "./openapi.fixture.json";

const authed = (url: string, init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { authorization: "Bearer good", ...(init.headers || {}) } });

describe("/info is open and read-only", () => {
  it("returns capabilities with writes disabled, no auth needed", async () => {
    const res = await info();
    const body = await res.json();
    expect(body.result.capabilities.update.current).toBe(false);
    expect(body.result.capabilities.update.history).toBe(false);
  });
});

describe("auth gating", () => {
  it("401s /namespaces without a bearer key", async () => {
    const res = await namespaces(new Request("http://x/api/i3x/v1/namespaces"));
    expect(res.status).toBe(401);
  });
  it("serves /namespaces with a valid key", async () => {
    const res = await namespaces(authed("http://x/api/i3x/v1/namespaces"));
    expect(res.status).toBe(200);
  });
});

describe("writes disabled", () => {
  it("PUT /objects/value returns 501", async () => {
    const res = await valuePut();
    expect(res.status).toBe(501);
  });
});

// D2: OpenAPI shape fixture — pin the envelope schemas we depend on.
describe("published OpenAPI spec still defines the envelopes we target", () => {
  it("VQT.quality mentions Good, Bad, and Uncertain", () => {
    const schemas = (fixture as Record<string, unknown>).components as Record<string, unknown>;
    const schemaMap = schemas.schemas as Record<string, unknown>;
    const vqt = schemaMap.VQT as Record<string, unknown>;
    const props = vqt.properties as Record<string, Record<string, string>>;
    expect(props.quality.description).toMatch(/Good.*Bad.*Uncertain/);
  });
  it("ObjectInstanceResponse.required includes the fields we map", () => {
    const schemas = (fixture as Record<string, unknown>).components as Record<string, unknown>;
    const schemaMap = schemas.schemas as Record<string, unknown>;
    const oir = schemaMap.ObjectInstanceResponse as Record<string, unknown>;
    expect(oir.required).toEqual(
      expect.arrayContaining(["elementId", "displayName", "typeElementId", "isComposition"]),
    );
  });
});
