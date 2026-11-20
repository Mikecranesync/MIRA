import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The host wiring for #4846 / #4924 / #5463 (source shape, like retry-target-review).
// The behavior itself is unit-tested in persisted-retry.test.ts and hub-host-logic.test.ts.
describe("the host keeps a send alive (source shape)", () => {
  const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");

  it("#4924: Stop does nothing until the guard after Send has passed", () => {
    const onStop = host.slice(host.indexOf("const onStop = useCallback("), host.indexOf("const onRetry = useCallback("));
    const guard = onStop.indexOf("if (!stopArmed(busySinceRef.current, Date.now())) return;");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(onStop.indexOf("abortRef.current?.abort()"));
    expect(host).toMatch(/useEffect\(\(\) => \{ busySinceRef\.current = busy \? Date\.now\(\) : null; \}, \[busy\]\);/);
  });

  it("#4846: the reloaded thread preserves exchanges and marks only the eligible request retryable", () => {
    expect(host).toMatch(/withPersistedRetry\(threadFromPersisted\(withoutRetriedFailures\(detail\.turns\), meta\)\.turns, persistedRetry\?\.answerId \?\? null\)/);
  });

  it("#4846: a stored failure retries its original request through the canonical send path", () => {
    expect(host).toMatch(/void send\(chatBodyFor\(persistedRetry\.question, \[\], \[\], selection\), persistedRetry\.question, selection, "retry", row\.clientRequestId\);/);
  });

  it("#4846: no stored-failure Retry while a send is running or a send error is showing", () => {
    expect(host).toMatch(/detail && !busy && !live && !failedBody && !state\.sendError \? persistedRetryTarget\(detail\.turns, headerComponentId, detail\.notebook\.asset\?\.entityId\) : null/);
  });

  it("#5557: the stored-failure Retry reads THIS conversation's header, undefined until it is read", () => {
    expect(host).toMatch(/benchView && benchView\.key === `\$\{selection\.notebookId\}\|\$\{selection\.threadId\}`\s+\? \(benchView\.state\?\.selection\?\.componentId \?\? null\)\s+: undefined;/);
  });
});
