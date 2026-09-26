/**
 * #4019 — the /v3 composer's attachments reach the turn they ride.
 *
 * Before: the web adapter dropped the picked File and the host's `onSend`
 * ignored its attachments, so "attach the manual, ask" sent the question alone
 * with no upload and no error. These pin the compose step that runs before the
 * ONE canonical send: documents through the node-files + sources doors (the
 * classic page's and mobile's), the scope re-read after upload, and photos
 * through /look — never a photo question without the photo.
 */
import { describe, expect, it, vi } from "vitest";

import { composeHubSend, pairAttachments, PHOTO_ANALYSIS_UNAVAILABLE, type HubUploadDeps } from "./hub-attachments";

type Call = { url: string; method: string; body: unknown };

function att(id: string, kind: "pdf" | "photo" | "file", name: string) {
  return { id, name, mediaType: kind === "photo" ? "image/jpeg" : "application/pdf", kind, status: "ready" as const };
}

function file(name: string, bytes = 10): File {
  return new File(["x".repeat(bytes)], name);
}

/** A fake server: records every call and answers by URL shape. */
function server(over: Partial<Record<"files" | "sources" | "detail" | "look", () => Response>> = {}) {
  const calls: Call[] = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const fetchFn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body });
    if (url.includes("/api/namespace/node/")) return over.files?.() ?? json({ indexed: true, uploadId: "doc-new" }, 201);
    if (url.endsWith("/sources/")) return over.sources?.() ?? json({ ok: true }, 201);
    if (url.includes("/look/")) {
      return over.look?.() ?? json({ fileId: "f-1", observation: { text: "a GS10 nameplate", capturedAt: "2026-09-26T19:00:00Z" } });
    }
    return (
      over.detail?.() ??
      json({
        sources: [
          { docId: "doc-old", enabledByDefault: true, matchState: "user_confirmed" },
          { docId: "doc-new", enabledByDefault: true, matchState: "user_confirmed" },
        ],
      })
    );
  });
  const deps: HubUploadDeps = { fetch: fetchFn as unknown as typeof fetch, apiBase: "", newKey: () => "k-1", maxUploadMb: 50 };
  return { calls, deps };
}

const base = { notebookId: "nb-1", nodeId: "node-1", threadId: "t-1", baseScope: ["doc-old"] as readonly string[] };

describe("composeHubSend — documents", () => {
  it("uploads to the node, attaches as a source, and re-reads the scope so THIS turn is grounded", async () => {
    const { calls, deps } = server();
    const out = await composeHubSend(
      { ...base, text: "what is the carrier frequency", files: [{ attachment: att("a1", "pdf", "gs10.pdf"), file: file("gs10.pdf") }] },
      deps,
    );
    expect(out.failure).toBeUndefined();
    expect(out.question).toBe("what is the carrier frequency");
    expect(out.scope).toEqual(["doc-old", "doc-new"]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/namespace/node/node-1/files/",
      "POST /api/equipment-notebooks/nb-1/sources/",
      "GET /api/equipment-notebooks/nb-1/?threadId=t-1",
    ]);
    expect(JSON.parse(String(calls[1].body))).toEqual({ docId: "doc-new", sourceRole: "manual" });
  });

  it("an attachment with no typed question still asks something", async () => {
    const { deps } = server();
    const out = await composeHubSend({ ...base, text: "  ", files: [{ attachment: att("a1", "pdf", "m.pdf"), file: file("m.pdf") }] }, deps);
    expect(out.question).toBe("What is in this document?");
  });

  // Codex #4024 F5: a document that cannot ground the turn must not let its
  // question go out as an ungrounded general answer.
  it("a file that uploads but cannot be indexed fails closed — the question is not sent without it", async () => {
    const { calls, deps } = server({ files: () => new Response(JSON.stringify({ indexed: false, warning: "image-only PDF" }), { status: 201 }) });
    const out = await composeHubSend({ ...base, text: "q", files: [{ attachment: att("a1", "pdf", "scan.pdf"), file: file("scan.pdf") }] }, deps);
    expect(out.failure).toMatch(/couldn't be read for chat/i);
    expect(out.reattach).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/sources/"))).toBe(false);
  });

  it("a rejected upload fails closed: nothing is sent", async () => {
    const { deps } = server({ files: () => new Response(JSON.stringify({ error: "Upload failed" }), { status: 500 }) });
    const out = await composeHubSend({ ...base, text: "q", files: [{ attachment: att("a1", "pdf", "m.pdf"), file: file("m.pdf") }] }, deps);
    expect(out.failure).toBeTruthy();
  });

  it("an over-limit file fails closed before any upload", async () => {
    const { calls, deps } = server();
    const out = await composeHubSend(
      { ...base, text: "q", files: [{ attachment: att("a1", "pdf", "huge.pdf"), file: file("huge.pdf", 2 * 1024 * 1024) }] },
      { ...deps, maxUploadMb: 1 },
    );
    expect(out.failure).toMatch(/1 MB/);
    expect(calls).toHaveLength(0);
  });

  // Codex #4024 F2: a failed re-read must never send the pre-upload scope.
  it("a failed scope re-read still sends WITH the new document (base scope + the attached id)", async () => {
    const { deps } = server({ detail: () => new Response("", { status: 500 }) });
    const out = await composeHubSend({ ...base, text: "q", files: [{ attachment: att("a1", "pdf", "m.pdf"), file: file("m.pdf") }] }, deps);
    expect(out.failure).toBeUndefined();
    expect(out.scope).toEqual(["doc-old", "doc-new"]);
  });

  it("a re-read that somehow omits the new document still includes it", async () => {
    const { deps } = server({ detail: () => new Response(JSON.stringify({ sources: [{ docId: "doc-old", enabledByDefault: true, matchState: "user_confirmed" }] })) });
    const out = await composeHubSend({ ...base, text: "q", files: [{ attachment: att("a1", "pdf", "m.pdf"), file: file("m.pdf") }] }, deps);
    expect(out.scope).toEqual(["doc-old", "doc-new"]);
  });
});

describe("composeHubSend — photos", () => {
  it("parks the photo through /look and returns the visualEvidence rider", async () => {
    const { calls, deps } = server();
    const out = await composeHubSend({ ...base, text: "", files: [{ attachment: att("p1", "photo", "np.jpg"), file: file("np.jpg") }] }, deps);
    expect(out.question).toBe("What am I looking at, and what should I check?");
    expect(out.visualEvidence).toEqual({ fileId: "f-1", capturedAt: "2026-09-26T19:00:00Z" });
    expect(calls).toHaveLength(1);
    const fd = calls[0].body as FormData;
    expect(calls[0].url).toBe("/api/equipment-notebooks/nb-1/look/");
    expect(fd.get("clientKey")).toBe("k-1");
    expect(fd.get("threadId")).toBe("t-1");
    expect(fd.get("question")).toBe("What am I looking at, and what should I check?");
  });

  it("a photo that was saved but never read fails closed — no photo question without the photo", async () => {
    const { deps } = server({ look: () => new Response(JSON.stringify({ fileId: "f-1", observation: null }), { status: 502 }) });
    const out = await composeHubSend({ ...base, text: "what is this", files: [{ attachment: att("p1", "photo", "np.jpg"), file: file("np.jpg") }] }, deps);
    expect(out.failure).toBe(PHOTO_ANALYSIS_UNAVAILABLE);
    expect(out.visualEvidence).toBeUndefined();
  });

  it("a photo that did not upload fails closed", async () => {
    const { deps } = server({ look: () => new Response(JSON.stringify({ error: "x" }), { status: 500 }) });
    const out = await composeHubSend({ ...base, text: "q", files: [{ attachment: att("p1", "photo", "np.jpg"), file: file("np.jpg") }] }, deps);
    expect(out.failure).toMatch(/photo didn't upload/i);
  });
});

describe("composeHubSend — more than one photo (Codex #4024 F3)", () => {
  it("refuses before any upload — the turn carries one photo, so a second would be silently dropped", async () => {
    const { calls, deps } = server();
    const out = await composeHubSend({
      ...base, text: "compare these",
      files: [{ attachment: att("p1", "photo", "a.jpg"), file: file("a.jpg") }, { attachment: att("p2", "photo", "b.jpg"), file: file("b.jpg") }],
    }, deps);
    expect(out.failure).toMatch(/one photo/i);
    expect(calls).toHaveLength(0);
  });
});

describe("composeHubSend — no attachments", () => {
  it("is a pass-through with no network call", async () => {
    const { calls, deps } = server();
    const out = await composeHubSend({ ...base, text: " hi ", files: [] }, deps);
    expect(out).toEqual({ question: "hi", scope: ["doc-old"] });
    expect(calls).toHaveLength(0);
  });
});

// Codex #4024 F1/F3: decided synchronously in onSend, BEFORE the Composer clears
// the chips — a throw there keeps every chip and the draft.
describe("pairAttachments", () => {
  const held = new Map<string, File>([["a1", file("m.pdf")], ["p1", file("a.jpg")], ["p2", file("b.jpg")]]);
  const get = (id: string) => held.get(id);

  it("pairs every chip with its bytes", () => {
    expect(pairAttachments([att("a1", "pdf", "m.pdf"), att("p1", "photo", "a.jpg")], get).map((f) => f.attachment.id)).toEqual(["a1", "p1"]);
  });

  it("throws when ANY chip lost its bytes — never a partial send", () => {
    expect(() => pairAttachments([att("a1", "pdf", "m.pdf"), att("gone", "pdf", "x.pdf")], get)).toThrow(/x\.pdf/);
  });

  it("throws on a second photo before anything uploads", () => {
    expect(() => pairAttachments([att("p1", "photo", "a.jpg"), att("p2", "photo", "b.jpg")], get)).toThrow(/one photo/i);
  });

  it("no attachments is an empty pairing", () => {
    expect(pairAttachments([], get)).toEqual([]);
  });
});
