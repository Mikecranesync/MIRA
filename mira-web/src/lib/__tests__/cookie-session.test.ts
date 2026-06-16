// mira-web/src/lib/__tests__/cookie-session.test.ts
import { describe, test, expect } from "bun:test";
import { parseCookies, buildSessionCookie, buildPendingScanCookie, buildClearCookie } from "../cookie-session.js";

describe("parseCookies", () => {
  test("empty header returns empty object", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  test("parses single cookie", () => {
    expect(parseCookies("mira_session=abc123")).toEqual({ mira_session: "abc123" });
  });

  test("parses multiple cookies with whitespace", () => {
    const result = parseCookies("mira_session=abc123; mira_pending_scan=def456;path=/");
    expect(result).toEqual({ mira_session: "abc123", mira_pending_scan: "def456", path: "/" });
  });

  test("URL-decodes cookie values", () => {
    expect(parseCookies("name=hello%20world")).toEqual({ name: "hello world" });
  });
});

describe("buildSessionCookie", () => {
  test("emits HttpOnly Secure SameSite=Lax with 30d max-age", () => {
    const c = buildSessionCookie("eyJJWT");
    expect(c).toContain("mira_session=eyJJWT");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
    expect(c).toContain("Max-Age=2592000");
    expect(c).toContain("Domain=.factorylm.com");
  });
});

describe("buildPendingScanCookie", () => {
  test("emits 5-minute HttpOnly cookie for scan correlation", () => {
    const c = buildPendingScanCookie("01920000-1234-7000-8000-000000000000");
    expect(c).toContain("mira_pending_scan=01920000-1234-7000-8000-000000000000");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Max-Age=300");
    expect(c).toContain("SameSite=Lax");
  });
});

describe("buildClearCookie", () => {
  test("clears mira_pending_scan with Max-Age=0", () => {
    const c = buildClearCookie("mira_pending_scan");
    expect(c).toContain("mira_pending_scan=");
    expect(c).toContain("Max-Age=0");
  });
});
