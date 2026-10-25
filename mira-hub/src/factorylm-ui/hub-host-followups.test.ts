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

  it("the finished answer's follow-ups are kept, from the same rule the live turn renders with, before the live turn is dropped", () => {
    const send = sendBody();
    const reload = send.indexOf("await loadDetail(sel)");
    const keep = send.indexOf("setSettledFollowups(\n");
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
    expect(send.slice(keep)).toMatch(/question: body\.message, suggestions: finished\.suggestions, answeredBefore \}/);
    // The ref follows the rendered detail, the same way draftRef follows the draft.
    expect(host).toMatch(/useEffect\(\(\) => \{ detailRef\.current = detail; \}, \[detail\]\);/);
  });

  it("the view overlays them on the reloaded thread, only for the thread they were answered in, before the manual-search status", () => {
    const overlay = host.indexOf("withSettledFollowups(");
    const status = host.lastIndexOf("withManualSearchStatus(", overlay);
    // withManualSearchStatus's SECOND argument; the overlay must sit inside its first.
    const statusArg = host.indexOf("follow?.status ?? detail.manualSearch", status);
    expect(overlay).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(-1);
    expect(statusArg).toBeGreaterThan(overlay);
    expect(host).toMatch(/settledFollowups\.notebookId === selection\.notebookId && settledFollowups\.threadId === selection\.threadId/);
  });
});
