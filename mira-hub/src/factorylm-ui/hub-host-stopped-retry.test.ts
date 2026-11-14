/**
 * Hub host wiring for stopped Retry (#4924). The host is not mounted here
 * (precedent: hub-host-followups.test.ts); the abort path is pinned against
 * source so removing `setFailedBody` on a retained stop turns this red.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");

function sendBody(): string {
  const start = host.indexOf("const send = useCallback(");
  expect(start, "send must exist in hub-host.tsx").toBeGreaterThan(-1);
  const end = host.indexOf("\n  }, [", start);
  expect(end).toBeGreaterThan(start);
  return host.slice(start, end);
}

describe("hub-host arms Retry after a retained user abort", () => {
  it("keeps failedBody on a retained interruption that may be retried", () => {
    const send = sendBody();
    const retained = send.indexOf("const retained = retainedStreamInterruption(err);");
    const arm = send.indexOf("if (shouldArmRetryAfterInterruption(retained)) {");
    const endRetained = send.indexOf("return;", arm);
    expect(retained).toBeGreaterThan(-1);
    expect(arm).toBeGreaterThan(retained);
    expect(endRetained).toBeGreaterThan(arm);
    const block = send.slice(retained, endRetained);
    expect(block.match(/setFailedBody\(\{ body, question \}\)/g)).toEqual(["setFailedBody({ body, question })"]);
    expect(block).toMatch(/if \(shouldArmRetryAfterInterruption\(retained\)\) \{\s*setFailedBody\(\{ body, question \}\);/);
  });

  it("does not show a send-error banner on a user abort", () => {
    const send = sendBody();
    expect(send).toMatch(/if \(!retained\.stopped\) \{\s*const message = sendFailureMessage\(err\);/);
  });
});
