/**
 * #4784 — a manual that is still being indexed is waited for, not reported as
 * unreadable, and the question is not sent until the manual is searchable.
 */
import { describe, expect, it, vi } from "vitest";

import { composeHubSend, type HubUploadDeps } from "./hub-attachments";

const NODE_FILES = "/api/namespace/node/node-1/files/";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function makeDeps(opts: {
  post: Response;
  listStates: Array<{ upload_id: string | null; indexingState: string | null }>;
  attempts?: number;
}) {
  const calls: Array<{ url: string; method: string }> = [];
  const listQueue = [...opts.listStates];
  const fetchFn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method });
    if (url.includes(NODE_FILES) && method === "POST") return opts.post;
    if (url.includes(NODE_FILES) && method === "GET") {
      const row = listQueue.length > 1 ? listQueue.shift()! : listQueue[0];
      return json({ files: [{ id: "f-9", filename: "gs10.pdf", ...row }] });
    }
    if (url.endsWith("/sources/")) return json({ ok: true }, 201);
    return json({ sources: [{ docId: "doc-9", enabledByDefault: true, matchState: "user_confirmed" }] });
  });
  const sleep = vi.fn(async () => {});
  const deps: HubUploadDeps = {
    fetch: fetchFn as unknown as typeof fetch,
    apiBase: "",
    newKey: () => "k-1",
    maxUploadMb: 50,
    sleep,
    indexPollAttempts: opts.attempts ?? 5,
  };
  return { calls, deps, sleep };
}

const base = { notebookId: "nb-1", nodeId: "node-1", threadId: "t-1", baseScope: [] as readonly string[] };
const pdf = {
  attachment: { id: "a1", name: "gs10.pdf", mediaType: "application/pdf", kind: "pdf" as const, status: "ready" as const },
  file: new File(["x"], "gs10.pdf"),
};

describe("composeHubSend — manual still indexing (#4784)", () => {
  it("waits while the manual is parsing, then sends with it grounded", async () => {
    const { calls, deps, sleep } = makeDeps({
      post: json({ ok: true, indexed: false, indexing: true, indexingState: "parsing", fileId: "f-9" }, 202),
      listStates: [
        { upload_id: null, indexingState: "parsing" },
        { upload_id: "doc-9", indexingState: "indexed" },
      ],
    });
    const out = await composeHubSend({ ...base, text: "carrier frequency?", files: [pdf] }, deps);
    expect(out.failure).toBeUndefined();
    expect(out.scope).toContain("doc-9");
    expect(sleep).toHaveBeenCalled();
    expect(calls.some((c) => c.url.endsWith("/sources/") && c.method === "POST")).toBe(true);
  });

  it("does not send the question and says it is still indexing when the wait runs out", async () => {
    const { calls, deps } = makeDeps({
      post: json({ ok: true, indexed: false, indexing: true, indexingState: "parsing", fileId: "f-9" }, 202),
      listStates: [{ upload_id: null, indexingState: "parsing" }],
      attempts: 3,
    });
    const out = await composeHubSend({ ...base, text: "carrier frequency?", files: [pdf] }, deps);
    expect(out.failure).toMatch(/still being indexed/);
    expect(out.failure).not.toMatch(/couldn't be read/);
    expect(calls.some((c) => c.url.includes("/sources/"))).toBe(false);
  });

  it("control: a file that is not indexable still fails as unreadable without polling", async () => {
    const { calls, deps } = makeDeps({
      post: json({ ok: true, indexed: false, fileId: "f-9", warning: "scanned" }, 201),
      listStates: [{ upload_id: null, indexingState: null }],
    });
    const out = await composeHubSend({ ...base, text: "q", files: [pdf] }, deps);
    expect(out.failure).toMatch(/couldn't be read for chat/);
    expect(calls.some((c) => c.method === "GET" && c.url.includes(NODE_FILES))).toBe(false);
  });
});
