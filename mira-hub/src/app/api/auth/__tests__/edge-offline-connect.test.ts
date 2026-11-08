// #5265 W1: on the edge profile the user-supplied-destination connect routes refuse
// before any probe, and say why.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: "t", userId: "u" })) }));
const { upsertBinding } = vi.hoisted(() => ({ upsertBinding: vi.fn(async () => undefined) }));
vi.mock("@/lib/bindings", () => ({ upsertBinding }));

import { POST as openwebui } from "../openwebui/route";
import { POST as telegram } from "../telegram/route";

const post = (body: unknown) =>
  new NextRequest("http://test/api/auth/x", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  delete process.env.MIRA_PROFILE;
  vi.unstubAllGlobals();
});

describe.each([
  ["openwebui", openwebui, { url: "https://owui.example.com", apiKey: "k" }],
  ["telegram", telegram, { botToken: "123:abc", token: "123:abc" }],
])("%s connect route", (_name, handler, body) => {
  it("edge profile: 403 offline_device, no outbound probe, nothing stored", async () => {
    process.env.MIRA_PROFILE = "edge";
    const res = await handler(post(body));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("offline_device");
    expect(json.message).toMatch(/runs MIRA offline/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(upsertBinding).not.toHaveBeenCalled();
  });

  it("control: profile off, the route does not return offline_device", async () => {
    const res = await handler(post(body));
    expect(res.status).not.toBe(403);
  });
});
