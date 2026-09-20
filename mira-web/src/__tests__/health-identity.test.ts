import { describe, expect, test } from "bun:test";
import { deployIdentity } from "../capabilities/deploy-identity.js";

// /api/health returns deployIdentity() (server.ts). The deploy workflows assert
// gitSha == approved_rc_sha after the swap (#3910), so the identity must come
// from the build-time env and never from a hardcoded version string.
// Tested through the capability module: importing server.ts has module-level
// side effects that perturb the rest of the suite.

describe("deployIdentity (#3910)", () => {
  test("reports gitSha, version and builtAt from the build-time env", () => {
    const body = deployIdentity({
      MIRA_GIT_SHA: "a".repeat(40),
      MIRA_APP_VERSION: "3.349.16",
      MIRA_BUILD_TIME: "2026-09-20T18:00:00Z",
    });
    expect(body.status).toBe("ok");
    expect(body.service).toBe("mira-web");
    expect(body.gitSha).toBe("a".repeat(40));
    expect(body.version).toBe("3.349.16");
    expect(body.builtAt).toBe("2026-09-20T18:00:00Z");
  });

  test("reports 'unknown' when the build args were never injected", () => {
    const body = deployIdentity({});
    expect(body.gitSha).toBe("unknown");
    expect(body.version).toBe("unknown");
    expect(body.builtAt).toBe("unknown");
  });

  test("never reports a hardcoded semantic version as source identity", () => {
    const body = deployIdentity({ MIRA_APP_VERSION: "0.2.1" });
    expect(body.gitSha).toBe("unknown");
  });
});
