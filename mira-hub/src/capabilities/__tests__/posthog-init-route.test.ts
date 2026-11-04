/**
 * Lives under capabilities/__tests__/ so the lifecycle guard does not
 * classify a co-located app/api test as frozen presentation.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/public/posthog-init/route";

const ENV_KEYS = ["PLG_POSTHOG_KEY", "PLG_POSTHOG_HOST", "POSTHOG_PERSONAL_API_KEY"];

describe("GET /api/public/posthog-init", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("returns a no-op stub when PLG_POSTHOG_KEY is unset, even if an admin key is present", async () => {
    process.env.POSTHOG_PERSONAL_API_KEY = "phx_admin";
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    const body = await res.text();
    expect(body).toContain("analytics disabled");
    expect(body).not.toContain("phx_admin");
    expect(body).not.toContain("posthog.init(");
  });

  it("serves the real init snippet from PLG_POSTHOG_KEY with replay off", async () => {
    process.env.PLG_POSTHOG_KEY = "phc_from_doppler";
    process.env.PLG_POSTHOG_HOST = "https://us.i.posthog.com";
    const res = await GET();
    const body = await res.text();
    expect(body).toContain(JSON.stringify("phc_from_doppler"));
    expect(body).toContain('"disable_session_recording":true');
    expect(body).toContain('"autocapture":false');
    expect(body).not.toMatch(/startSessionRecording\s*\(/);
  });
});
