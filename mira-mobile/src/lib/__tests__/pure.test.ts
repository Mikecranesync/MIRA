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

describe("notebook scoping + covers (NotebookLM flow)", () => {
  it("enabledDocIds keeps only checked sources (retrieval scope)", async () => {
    const { enabledDocIds } = await import("../../api/resources");
    expect(
      enabledDocIds([
        { docId: "a", enabledByDefault: true },
        { docId: "b", enabledByDefault: false },
        { docId: "c", enabledByDefault: true },
      ]),
    ).toEqual(["a", "c"]);
    expect(enabledDocIds([])).toEqual([]);
  });
  it("cover class is deterministic and glyph maps equipment types", async () => {
    const { coverClass, coverGlyph } = await import("../../screens/NotebooksTab");
    const nb = { id: "x1", equipmentType: "drive" };
    expect(coverClass(nb)).toBe(coverClass({ ...nb }));
    expect(coverClass(nb)).toMatch(/^nb-cover-(blue|green|amber|violet)$/);
    expect(coverGlyph("VFD Drive")).toBe("⚡");
    expect(coverGlyph(null)).toBe("📓");
  });
});

describe("punch-list pure helpers", () => {
  it("humanizes machine status tokens (COPY-09) — no raw tokens leak", async () => {
    const { humanizeAnswerStatus, answerBody } = await import("../chat-copy");
    expect(humanizeAnswerStatus("insufficient_evidence")).toMatch(/couldn't find/i);
    expect(humanizeAnswerStatus("answered")).toBe("");
    expect(humanizeAnswerStatus("http 422")).toMatch(/422/);
    expect(answerBody(null, "insufficient_evidence")).not.toContain("_");
    expect(answerBody("Real answer [1].", "answered")).toBe("Real answer [1].");
  });
  it("parses persisted evidence into citations defensively (CIT-07)", async () => {
    const { citationsFromEvidence } = await import("../../screens/NotebookScreen");
    const rows = citationsFromEvidence([
      { citationId: "1", sourceTitle: "manual.pdf", page: 44, quote: "torque is 0.71 N-m", docId: "d1" },
      "junk",
      { noCitationId: true },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quote).toContain("0.71");
    expect(citationsFromEvidence(undefined)).toEqual([]);
  });
  it("sse parser passes quote/docId through the sources frame", async () => {
    const { parseChatSse } = await import("../sse");
    const body =
      'data: {"kind":"sources","citations":[{"citationId":"1","sourceTitle":"m.pdf","page":2,"quote":"the cited passage","docId":"d9"}]}\n\n' +
      'data: {"kind":"content","content":"x [1]"}\n\ndata: {"kind":"status","status":"answered"}\n\ndata: [DONE]';
    const t = parseChatSse(body);
    expect(t.citations[0].quote).toBe("the cited passage");
    expect(t.citations[0].docId).toBe("d9");
  });
  it("sign-out purge also clears cached Studio artifacts", async () => {
    const { purgeAllQueues } = await import("../offline-queue");
    const data: Record<string, string> = {
      "flm.woqueue.v1.t1": "[]",
      "flm.studio.v1.nb1": "{}",
      "flm.cookiejar.v1": "keep",
    };
    const store = {
      get: async (k: string) => data[k] ?? null,
      set: async (k: string, v: string) => { data[k] = v; },
      remove: async (k: string) => { delete data[k]; },
      keys: async () => Object.keys(data),
    };
    expect(await purgeAllQueues(store)).toBe(2);
    expect(Object.keys(data)).toEqual(["flm.cookiejar.v1"]);
  });
});

describe("SCH-04 create-schedule contract (client side)", () => {
  it("interval units offered match the server's calendar CREATE_UNITS subset", async () => {
    const { PM_INTERVAL_UNITS } = await import("../../api/resources");
    // Server accepts hours..years; client offers the field-sensible calendar
    // subset and NEVER "cycles" (meter-only unit the POST rejects).
    for (const u of PM_INTERVAL_UNITS) {
      expect(["hours", "days", "weeks", "months", "years"]).toContain(u);
    }
    expect(PM_INTERVAL_UNITS).not.toContain("cycles");
  });
});
