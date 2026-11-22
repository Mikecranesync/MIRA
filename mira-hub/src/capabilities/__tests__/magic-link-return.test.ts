// #5744 — email sign-in returns to the cited manual page the technician opened.
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/magic-link-return
import { describe, it, expect, vi } from "vitest";
import {
  magicLandingPath,
  magicLinkRequestBody,
  magicLinkUrl,
  redeemMagicToken,
  safeReturnPath,
} from "@/capabilities/magic-link-return";

// The ready-manual link from #5726: the saved copy at its coverage page.
const FILE = "6c1f0b2e-1111-2222-3333-444455556666";
const VIEWER = `/v3/source/?file=${FILE}&page=26`;

// The machine-memory "create work order" link pre-fills these (#5751 Codex F1).
const WORK_ORDER =
  "/workorders/new/?asset=CV-101&prefill_title=Motor%20overcurrent%20trip&prefill_description=Check%20the%20GS10%20output%20current";

describe("safeReturnPath — only the cited-page viewer is carried", () => {
  it("accepts the viewer link with its file and page", () => {
    expect(safeReturnPath(VIEWER)).toBe(VIEWER);
  });

  it("accepts the viewer without a page, and without the trailing slash", () => {
    expect(safeReturnPath(`/v3/source/?file=${FILE}`)).toBe(`/v3/source/?file=${FILE}`);
    expect(safeReturnPath(`/v3/source?file=${FILE}&page=26`)).toBe(VIEWER);
  });

  it("rebuilds the link instead of passing the raw text through", () => {
    expect(safeReturnPath(`/v3/source/?page=26&file=${FILE.toUpperCase()}`)).toBe(VIEWER);
  });

  it.each([
    ["a work-order link with fault details", WORK_ORDER],
    ["the magic-link verifier", "/magic?token=abc"],
    ["the verifier without a token", "/magic"],
    ["the login page", "/login?callbackUrl=%2Ffeed"],
    ["any other Hub page", "/assets/123/"],
    ["the viewer with an extra parameter", `${VIEWER}&prefill_title=Motor%20trip`],
    ["the viewer with a non-uuid file", "/v3/source/?file=abc&page=26"],
    ["the viewer with no file", "/v3/source/?page=26"],
    ["the viewer with two files", `/v3/source/?file=${FILE}&file=${FILE}`],
    ["the viewer with a bad page", `/v3/source/?file=${FILE}&page=0`],
    ["another host, protocol-relative", "//evil.example/v3/source/"],
    ["another host, backslash", "/\\evil.example"],
    ["a tab before the second slash", "/\t/evil.example"],
    ["absolute URL", `https://evil.example${VIEWER}`],
    ["an unpaired surrogate", `/v3/source/?file=${FILE}&page=26\uD800`],
    ["non-ASCII text", `/v3/source/?file=${FILE}&page=２６`],
    ["empty", ""],
  ])("rejects %s", (_label, raw) => {
    expect(safeReturnPath(raw)).toBeNull();
  });

  it("rejects a non-string", () => {
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath({ toString: () => VIEWER })).toBeNull();
  });
});

describe("the three hops", () => {
  it("the form posts the viewer link with the email", () => {
    expect(magicLinkRequestBody(" tech@example.com ", VIEWER)).toEqual({ email: "tech@example.com", returnTo: VIEWER });
  });

  it("the form posts only the email for any other link", () => {
    for (const other of [null, "/feed", WORK_ORDER, "//evil.example"]) {
      expect(magicLinkRequestBody("tech@example.com", other)).toEqual({ email: "tech@example.com" });
    }
  });

  it("the emailed link carries the viewer link as next", () => {
    const url = new URL(magicLinkUrl("https://app.example.test", "/hub", "tok123", VIEWER));
    expect(url.pathname).toBe("/hub/magic/");
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe("tok123");
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.searchParams.get("next")).toBe(VIEWER);
  });

  it("the emailed link carries the rebuilt viewer link, never the raw input", () => {
    const raw = `/v3/source?page=26&file=${FILE.toUpperCase()}`;
    const url = new URL(magicLinkUrl("https://app.example.test", "/hub", "tok123", raw));
    expect(url.searchParams.get("next")).toBe(VIEWER);
  });

  it("the emailed link never carries work-order text, the verifier, or another host", () => {
    for (const bad of [WORK_ORDER, "/magic", "//evil.example", `/v3/source/?file=${FILE}\uD800`, undefined]) {
      const link = magicLinkUrl("https://app.example.test", "/hub", "tok123", bad);
      const url = new URL(link);
      expect(url.searchParams.has("next")).toBe(false);
      expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe("tok123");
      expect(link).not.toMatch(/overcurrent|prefill/i);
    }
  });

  it("the verify page goes to the viewer after sign-in, and to /feed otherwise", () => {
    const next = new URL(magicLinkUrl("https://app.example.test", "/hub", "tok123", VIEWER)).searchParams.get("next");
    expect(magicLandingPath(next)).toBe(VIEWER);
    for (const edited of [null, "/magic", "//evil.example", WORK_ORDER]) {
      expect(magicLandingPath(edited)).toBe("/feed");
    }
  });
});

describe("redeemMagicToken — the verify page's redemption", () => {
  it("an accepted token lands on the viewer page", async () => {
    const signIn = vi.fn(async () => ({ ok: true }));
    expect(await redeemMagicToken(signIn, "tok123", VIEWER)).toBe(VIEWER);
    expect(signIn).toHaveBeenCalledWith("tok123");
  });

  it("an accepted token whose next is the verifier lands on /feed, not an expired-link page", async () => {
    expect(await redeemMagicToken(async () => ({ ok: true }), "tok123", "/magic")).toBe("/feed");
  });

  it("a rejected token goes nowhere", async () => {
    expect(await redeemMagicToken(async () => ({ ok: false }), "tok123", VIEWER)).toBeNull();
    expect(await redeemMagicToken(async () => undefined, "tok123", VIEWER)).toBeNull();
  });
});
