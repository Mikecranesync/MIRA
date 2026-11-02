import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPosthogInitJavaScript,
  posthogClientEnabled,
  posthogCspOrigins,
  posthogHost,
  posthogKey,
  signupCompletedProperties,
} from "../posthog";

const ENV_KEYS = [
  "PLG_POSTHOG_KEY",
  "PLG_POSTHOG_HOST",
  "POSTHOG_PERSONAL_API_KEY",
  "POSTHOG_PRIVATE_API_KEY",
  "POSTHOG_ADMIN_API_KEY",
  "POSTHOG_API_KEY",
];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe("posthog env + CSP", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("reads only PLG_POSTHOG_KEY — admin/personal keys never enable ingest", () => {
    process.env.POSTHOG_PERSONAL_API_KEY = "phx_admin_secret";
    process.env.POSTHOG_API_KEY = "phx_also_admin";
    expect(posthogKey()).toBe("");
    expect(posthogClientEnabled()).toBe(false);
    const js = buildPosthogInitJavaScript();
    expect(js).toContain("analytics disabled");
    expect(js).not.toContain("phx_admin_secret");
    expect(js).not.toContain("phx_also_admin");
  });

  it("defaults the ingest host to US and derives the assets host", () => {
    expect(posthogHost()).toBe("https://us.i.posthog.com");
    expect(posthogCspOrigins()).toEqual([
      "https://us.i.posthog.com",
      "https://us-assets.i.posthog.com",
    ]);
  });

  it("derives EU asset host from PLG_POSTHOG_HOST", () => {
    process.env.PLG_POSTHOG_HOST = "https://eu.i.posthog.com";
    expect(posthogCspOrigins()).toEqual([
      "https://eu.i.posthog.com",
      "https://eu-assets.i.posthog.com",
    ]);
  });

  it("treats compose's empty PLG_POSTHOG_HOST as the US default", () => {
    process.env.PLG_POSTHOG_HOST = "";
    expect(posthogHost()).toBe("https://us.i.posthog.com");
  });
});

describe("buildPosthogInitJavaScript", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("ships a no-op stub when the ingest key is unset", () => {
    const js = buildPosthogInitJavaScript({ key: "", host: "https://us.i.posthog.com" });
    expect(js).toContain("analytics disabled");
    expect(js).toContain("window.posthog=");
    expect(js).not.toContain("posthog.init(");
  });

  it("inits with session replay off, autocapture off, DNT respected, identified_only", () => {
    const js = buildPosthogInitJavaScript({
      key: "phc_test_ingest",
      host: "https://us.i.posthog.com",
    });
    expect(js).toContain(JSON.stringify("phc_test_ingest"));
    expect(js).toContain('"disable_session_recording":true');
    expect(js).toContain('"autocapture":false');
    expect(js).toContain('"respect_dnt":true');
    expect(js).toContain('"person_profiles":"identified_only"');
    expect(js).not.toMatch(/startSessionRecording\s*\(/);
    expect(js).toContain("register_once");
    expect(js).toContain("utm_source");
  });

  it("JSON-escapes the key so it cannot break out of the script", () => {
    const js = buildPosthogInitJavaScript({
      key: 'phc_"</script>',
      host: "https://us.i.posthog.com",
    });
    expect(js).toContain(JSON.stringify('phc_"</script>'));
  });

  it("never inlines admin-key env names into the snippet", () => {
    const src = buildPosthogInitJavaScript({ key: "phc_x", host: "https://us.i.posthog.com" });
    expect(src).not.toContain("POSTHOG_PERSONAL_API_KEY");
    expect(src).not.toContain("POSTHOG_ADMIN_API_KEY");
    expect(src).not.toMatch(/phx_/);
  });
});

describe("signupCompletedProperties", () => {
  it("allowlists method + utm_* + click-id presence — no email or name", () => {
    const props = signupCompletedProperties(
      {
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "pilot",
        utmContent: "hero",
        utmTerm: null,
        hasGclid: true,
        hasFbclid: false,
      },
      "credentials",
    );
    expect(props.method).toBe("credentials");
    expect(props.utm_source).toBe("google");
    expect(JSON.stringify(props)).not.toContain("@");
    expect(Object.keys(props).sort()).toEqual([
      "has_fbclid",
      "has_gclid",
      "method",
      "utm_campaign",
      "utm_content",
      "utm_medium",
      "utm_source",
      "utm_term",
    ]);
  });
});
