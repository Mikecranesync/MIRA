import { describe, expect, test } from "bun:test";
import { PRODUCTION_HUB_ORIGIN, hubOrigin, hubUrl } from "./hub-origin";

describe("hubOrigin — staging web never hands users to production hub (#3930)", () => {
  test("production default is unchanged when PLG_HUB_URL is unset or blank", () => {
    expect(hubOrigin({})).toBe(PRODUCTION_HUB_ORIGIN);
    expect(hubOrigin({ PLG_HUB_URL: "" })).toBe(PRODUCTION_HUB_ORIGIN);
    expect(hubOrigin({ PLG_HUB_URL: "   " })).toBe(PRODUCTION_HUB_ORIGIN);
  });
  test("staging value wins, trailing slashes trimmed, paths joined", () => {
    const env = { PLG_HUB_URL: "https://app-staging.factorylm.com/" };
    expect(hubOrigin(env)).toBe("https://app-staging.factorylm.com");
    expect(hubUrl("/c/new", env)).toBe("https://app-staging.factorylm.com/c/new");
    expect(hubUrl("feed/?checkout=success", env)).toBe("https://app-staging.factorylm.com/feed/?checkout=success");
    expect(hubUrl("/login", env)).not.toContain("app.factorylm.com");
  });
});
