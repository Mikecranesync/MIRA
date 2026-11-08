/**
 * #3882: a cold restart reopened the preserved `?notebook=…&thread=…` URL, but
 * the Job Sheet was gone until the technician reselected the project. The URL
 * selection is restored only from the notebook list, and one failed or
 * timed-out list request left the host on HOME with nothing logged. The list
 * load now retries a bounded number of times and logs each failure; a 401
 * still stops at once (signed out), and a success is returned untouched.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { NOTEBOOK_LIST_RETRY_DELAYS_MS, loadNotebookListWithRetry } from "./hub-host-logic";

type List = { notebooks: { id: string }[] };
const ok: { status: number; data: List | null } = { status: 200, data: { notebooks: [{ id: "nb-1" }] } };
const fail = (status: number) => ({ status, data: null });

function harness(results: Array<{ status: number; data: List | null } | Error>) {
  const get = vi.fn(async () => {
    const next = results.shift();
    if (!next) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async (ms: number) => { void ms; });
  const warn = vi.fn();
  return { get, sleep, warn };
}

describe("notebook list load retries before giving up the URL restore (#3882)", () => {
  it("a 500 then a success restores: the second response is returned", async () => {
    const h = harness([fail(500), ok]);
    const res = await loadNotebookListWithRetry(h.get, { sleep: h.sleep, warn: h.warn });
    expect(res).toEqual(ok);
    expect(h.get).toHaveBeenCalledTimes(2);
    expect(h.sleep).toHaveBeenCalledWith(NOTEBOOK_LIST_RETRY_DELAYS_MS[0]);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(String(h.warn.mock.calls[0][0])).toMatch(/notebook list/);
  });

  it("a network error (fetch rejects) is retried the same way", async () => {
    const h = harness([new TypeError("Failed to fetch"), ok]);
    expect(await loadNotebookListWithRetry(h.get, { sleep: h.sleep, warn: h.warn })).toEqual(ok);
    expect(h.get).toHaveBeenCalledTimes(2);
  });

  it("is bounded: after every delay is used it returns the last failure, logged each time", async () => {
    const attempts = NOTEBOOK_LIST_RETRY_DELAYS_MS.length + 1;
    const h = harness(Array.from({ length: attempts }, () => fail(503)));
    const res = await loadNotebookListWithRetry(h.get, { sleep: h.sleep, warn: h.warn });
    expect(res).toEqual(fail(503));
    expect(h.get).toHaveBeenCalledTimes(attempts);
    expect(h.warn).toHaveBeenCalledTimes(attempts);
  });

  it("a final network error resolves to a failure instead of throwing", async () => {
    const attempts = NOTEBOOK_LIST_RETRY_DELAYS_MS.length + 1;
    const h = harness(Array.from({ length: attempts }, () => new TypeError("Failed to fetch")));
    expect(await loadNotebookListWithRetry(h.get, { sleep: h.sleep, warn: h.warn })).toEqual({ status: 0, data: null });
  });

  it("401 is not retried (signed out is an answer, not a failure)", async () => {
    const h = harness([fail(401)]);
    expect(await loadNotebookListWithRetry(h.get, { sleep: h.sleep, warn: h.warn })).toEqual(fail(401));
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.sleep).not.toHaveBeenCalled();
  });

  it("stops retrying once the load is superseded", async () => {
    const h = harness([fail(500), ok]);
    const res = await loadNotebookListWithRetry(h.get, { sleep: h.sleep, warn: h.warn, isCurrent: () => false });
    expect(res).toEqual(fail(500));
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it("a first-try success makes exactly one request and logs nothing (control)", async () => {
    const h = harness([ok]);
    expect(await loadNotebookListWithRetry(h.get, { sleep: h.sleep, warn: h.warn })).toEqual(ok);
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it("the host's loadNotebooks uses the retrying load for the list GET", () => {
    const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
    const start = host.indexOf("const loadNotebooks = useCallback(");
    const end = host.indexOf("\n  }, [", start);
    const body = host.slice(start, end);
    expect(body).toMatch(/loadNotebookListWithRetry\(/);
    expect(body).toMatch(/"\/api\/equipment-notebooks\/"/);
  });
});
