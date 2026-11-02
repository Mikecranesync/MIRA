import { describe, expect, it } from "vitest";
import {
  attributionFromCookieHeader,
  attributionFromRequest,
  firstTouchUtmCookieValue,
  isSignupOrLoginPath,
  parseUtmCookieValue,
  serializeUtmCookie,
  UTM_COOKIE_NAME,
} from "../utm";

describe("isSignupOrLoginPath", () => {
  it("matches /signup and /login with or without a trailing slash", () => {
    expect(isSignupOrLoginPath("/signup")).toBe(true);
    expect(isSignupOrLoginPath("/signup/")).toBe(true);
    expect(isSignupOrLoginPath("/login")).toBe(true);
    expect(isSignupOrLoginPath("/login/")).toBe(true);
  });

  it("does not match neighboring public routes", () => {
    expect(isSignupOrLoginPath("/feed/")).toBe(false);
    expect(isSignupOrLoginPath("/magic")).toBe(false);
    expect(isSignupOrLoginPath("/signup-now")).toBe(false);
    expect(isSignupOrLoginPath("/")).toBe(false);
  });
});

describe("first-touch UTM cookie", () => {
  it("serializes sanitized utm_* and presence-only click ids", () => {
    const raw = firstTouchUtmCookieValue(
      "?utm_source=google&utm_medium=cpc&utm_campaign=pilot&gclid=secret-click-id",
      undefined,
    );
    expect(raw).toContain("utm_source=google");
    expect(raw).toContain("utm_medium=cpc");
    expect(raw).toContain("utm_campaign=pilot");
    expect(raw).toContain("gclid=1");
    expect(raw).not.toContain("secret-click-id");
  });

  it("does not overwrite an existing first-touch cookie", () => {
    expect(
      firstTouchUtmCookieValue("?utm_source=later", "utm_source=first"),
    ).toBeNull();
  });

  it("does not stamp an empty cookie when the URL has no campaign params", () => {
    expect(firstTouchUtmCookieValue("", undefined)).toBeNull();
    expect(firstTouchUtmCookieValue("?foo=bar", undefined)).toBeNull();
  });

  it("strips unsafe characters from cookie values", () => {
    const raw = firstTouchUtmCookieValue("?utm_source=<script>google", undefined);
    expect(raw).not.toContain("<");
    expect(raw).not.toContain(">");
    expect(raw).toContain("utm_source=scriptgoogle");
  });
});

describe("attributionFromRequest cookie carry-through", () => {
  it("reads the first-touch cookie when Referer has no UTMs (Google OAuth gap)", () => {
    const cookie = serializeUtmCookie({
      utmSource: "linkedin",
      utmMedium: "social",
      utmCampaign: "q4",
      utmContent: "hero",
      utmTerm: null,
      hasGclid: false,
      hasFbclid: false,
    });
    const req = new Request("https://app.factorylm.com/api/auth/register/", {
      headers: { cookie: `${UTM_COOKIE_NAME}=${cookie}` },
    });
    const a = attributionFromRequest(req);
    expect(a.utmSource).toBe("linkedin");
    expect(a.utmMedium).toBe("social");
    expect(a.utmCampaign).toBe("q4");
    expect(a.utmContent).toBe("hero");
  });

  it("prefers body over cookie over Referer", () => {
    const cookie = serializeUtmCookie({
      utmSource: "cookie-source",
      utmMedium: "cookie-medium",
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      hasGclid: false,
      hasFbclid: false,
    });
    const req = new Request("https://app.factorylm.com/api/auth/register/", {
      headers: {
        cookie: `${UTM_COOKIE_NAME}=${cookie}`,
        referer: "https://app.factorylm.com/signup?utm_source=referer-source&utm_campaign=referer-campaign",
      },
    });
    const a = attributionFromRequest(req, { utm_source: "body-source" });
    expect(a.utmSource).toBe("body-source");
    expect(a.utmMedium).toBe("cookie-medium");
    expect(a.utmCampaign).toBe("referer-campaign");
  });

  it("parses the Cookie header via attributionFromCookieHeader", () => {
    expect(attributionFromCookieHeader(null)).toEqual(parseUtmCookieValue(""));
    const a = attributionFromCookieHeader(`${UTM_COOKIE_NAME}=utm_source=bing; other=1`);
    expect(a.utmSource).toBe("bing");
  });
});
