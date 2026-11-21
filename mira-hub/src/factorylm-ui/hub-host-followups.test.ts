/**
 * #4454: after a stream the /v3 host re-loads the thread and drops the live
 * turn, and saved rows never carry follow-up suggestions, so the chips the
 * technician just saw vanished. The host now keeps the finished answer's
 * suggestions and overlays them on the reloaded answer.
 *
 * The host component is not rendered in this suite (precedent:
 * hub-host-open-notebook.test.ts), so the wiring is pinned against its source;
 * the behaviour itself is covered by `withSettledFollowups` in
 * to-interaction.test.ts.
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

describe("hub-host keeps a finished answer's follow-ups after the reload (#4454)", () => {
  it("a new send clears the previous answer's follow-ups before it goes out", () => {
    const send = sendBody();
    const clear = send.indexOf("setSettledFollowups(null)");
    const post = send.indexOf("await fetch(");
    expect(clear).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(clear);
  });

  it("keeps suggestions from the streamed result until the matching durable answer is available", () => {
    const send = sendBody();
    expect(send).toMatch(/partsFromStream\(result,/);
    expect(send).toMatch(/requestId: body\.clientRequestId, suggestions: finished\.suggestions/);
    expect(host).toMatch(/persistedRequest\(detail\.turns, settledFollowups\.requestId\)/);
    expect(host).toMatch(/answerId: answerTurnId\(saved\.id\)/);
  });

  it("applies follow-ups within their thread, before appending the manual status", () => {
    const overlay = host.indexOf("withSettledFollowups(");
    expect(host.lastIndexOf("withManualSearchStatus(", overlay)).toBeGreaterThan(-1);
    expect(host.indexOf("displayedManualStatus,", overlay)).toBeGreaterThan(overlay);
    expect(host).toMatch(/settledFollowups\.notebookId === selection\.notebookId && settledFollowups\.threadId === selection\.threadId/);
  });
});
