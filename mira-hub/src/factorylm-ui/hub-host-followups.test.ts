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
    const keep = send.indexOf("setSettledFollowups(\n");
    const reload = send.lastIndexOf("await loadDetail(sel)", keep);
    const drop = send.indexOf("setLive((cur) => (cur && cur.id === id ? null : cur))", reload);
    expect(reload).toBeGreaterThan(-1);
    expect(keep).toBeGreaterThan(reload);
    expect(drop).toBeGreaterThan(keep);
    expect(send.slice(reload, keep)).toMatch(/partsFromStream\(result,/);
    // Kept exactly when the live render showed follow-ups, for the question sent.
    expect(send.slice(keep, drop)).toMatch(/finished\?\.type === "followups"\s*\?\s*\{/);
    expect(send.slice(keep, drop)).toMatch(/suggestions: finished\.suggestions/);
    expect(send.slice(keep, drop)).toMatch(/question: body\.message/);
  });

  // Cheap-lane finding on #4456: the overlay must know which answers were
  // already there, or another device's later answer to the same question
  // could inherit them.
  it("the answers already in the thread are recorded before the send goes out, and travel with the kept follow-ups", () => {
    const send = sendBody();
    const taken = send.indexOf("const answeredBefore = (detailRef.current?.turns ?? []).map((row) => answerTurnId(row.id));");
    const post = send.indexOf("await fetch(");
    const keep = send.indexOf("setSettledFollowups(\n");
    expect(taken).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(taken);
    expect(send.slice(keep)).toMatch(/question: body\.message, suggestions: finished\.suggestions, answeredBefore, clientRequestId: outBody\.clientRequestId \}/);
    // The ref follows the rendered detail, the same way draftRef follows the draft.
    expect(host).toMatch(/useEffect\(\(\) => \{ detailRef\.current = detail; \}, \[detail\]\);/);
  });

  it("the view overlays them on the reloaded thread, only for the thread they were answered in, before the manual-search status", () => {
    const overlay = host.indexOf("withSettledFollowups(");
    // #5750 r2: the host places the status through withHostManualStatus.
    expect(host.lastIndexOf("withHostManualStatus(", overlay)).toBeGreaterThan(-1);
    expect(host.indexOf("displayedManualStatus,", overlay)).toBeGreaterThan(overlay);
    expect(host).toMatch(/settledFollowups\.notebookId === selection\.notebookId && settledFollowups\.threadId === selection\.threadId/);
  });

  // #5750 r3: a detail read that withheld the status for this thread hides
  // the status the host is still following, too.
  it("passes the detail read's withheld scope into the shown status", () => {
    expect(host).toMatch(/manualStatusForThread\([\s\S]*?detail\?\.manualSearchScope,\s*\)/);
  });

  // #5750 r3 F11/F12: the shown status is placed by the answer recorded for
  // it — from the detail read's named answer, or the send whose live frame
  // carried it — never by default.
  it("places the shown status by its recorded origin", () => {
    expect(host).toMatch(/statusOrigins\.get\(manualStatusKey\(displayedManualStatus\)\)/);
    expect(host).toMatch(/recordStatusOrigin\(res\.data\.manualSearch, res\.data\.manualSearchAnswer \? \{ turnId: res\.data\.manualSearchAnswer\.turnId \} : null\)/);
    expect(host).toMatch(/recordStatusOrigin\(status, \{ requestId: outBody\.clientRequestId \}\);\s*manualSearchDriverRef\.current\?\.observeLive/);
  });
});
