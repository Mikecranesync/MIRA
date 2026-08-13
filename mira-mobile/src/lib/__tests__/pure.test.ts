// Pure-logic regression net for the mobile client (Phase 3): deep-link tag
// parsing (trust filter included), SSE chat parsing, cookie splitting, and the
// canonical fail-closed nav model. No DOM, no network.
import { describe, it, expect } from "vitest";
import { extractAssetTag } from "../tags";
import { parseChatSse } from "../sse";
import { splitSetCookie } from "../../api/client";
import { TABS, visibleTabs, can } from "../../nav";

describe("extractAssetTag (Hub scan-target semantics + trust filter)", () => {
  it("accepts full app URL, custom scheme, path, and raw tag", () => {
    expect(extractAssetTag("https://app.factorylm.com/m/ROCK-BBTKAX7M")).toBe("ROCK-BBTKAX7M");
    expect(extractAssetTag("factorylm://m/ROCK-BBTKAX7M")).toBe("ROCK-BBTKAX7M");
    expect(extractAssetTag("/m/ROCK-BBTKAX7M/")).toBe("ROCK-BBTKAX7M");
    expect(extractAssetTag("ROCK-BBTKAX7M")).toBe("ROCK-BBTKAX7M");
  });
  it("REJECTS foreign origins even with an /m/ path (trust boundary)", () => {
    expect(extractAssetTag("https://evil.example.com/m/ROCK-BBTKAX7M")).toBeNull();
    expect(extractAssetTag("javascript://m/x")).toBeNull();
  });
  it("rejects malformed input", () => {
    expect(extractAssetTag("")).toBeNull();
    expect(extractAssetTag("https://app.factorylm.com/login/")).toBeNull();
  });
});

describe("parseChatSse", () => {
  const body = [
    'data: {"kind":"sources","citations":[{"citationId":"1","sourceTitle":"pf525_user_manual.pdf","page":161}]}',
    'data: {"kind":"content","content":"Fault F004 "}',
    'data: {"kind":"content","content":"[UnderVoltage] [1]."}',
    'data: {"kind":"status","status":"answered"}',
    "data: [DONE]",
  ].join("\n\n");
  it("assembles content deltas, citations, and status", () => {
    const t = parseChatSse(body);
    expect(t.answer).toBe("Fault F004 [UnderVoltage] [1].");
    expect(t.citations).toHaveLength(1);
    expect(t.citations[0].page).toBe(161);
    expect(t.status).toBe("answered");
  });
  it("carries a non-200 http status and survives junk frames", () => {
    const t = parseChatSse("data: not-json\n\n" + body, 500);
    expect(t.answer).toContain("F004");
    const empty = parseChatSse("", 422);
    expect(empty.status).toBe("http 422");
  });
});

describe("splitSetCookie", () => {
  it("splits combined cookies without breaking Expires dates", () => {
    const combined =
      "__Secure-next-auth.session-token=abc; Path=/; Expires=Thu, 13 Aug 2026 05:00:00 GMT; HttpOnly, next-auth.csrf-token=def; Path=/";
    const parts = splitSetCookie(combined);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("session-token=abc");
    expect(parts[1].trim().startsWith("next-auth.csrf-token=def")).toBe(true);
  });
});

describe("canonical nav model — fail closed", () => {
  it("is exactly the frozen 5-tab contract in order", () => {
    expect(TABS.map((t) => t.id)).toEqual(["workorders", "schedule", "chat", "assets", "more"]);
  });
  it("null/undefined capabilities ⇒ least privilege (never owner-by-default)", () => {
    // Tabs without a capability requirement stay visible; anything gated hides.
    const withNull = visibleTabs(null).map((t) => t.id);
    const withUndef = visibleTabs(undefined).map((t) => t.id);
    expect(withNull).toEqual(withUndef);
    expect(can(null, "work_orders.create")).toBe(false);
    expect(can(undefined, "work_orders.update")).toBe(false);
    expect(can([], "pm_schedules.complete")).toBe(false);
  });
  it("capability grants are honored", () => {
    expect(can(["work_orders.create"], "work_orders.create")).toBe(true);
  });
});
