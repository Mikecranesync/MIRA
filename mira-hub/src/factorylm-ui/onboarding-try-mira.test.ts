import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nodeChatFailureMessage, tryMiraChatScope } from "./onboarding-try-mira";

// #4417 (staging stranger walk, 2026-10-13): a new account's "Try MIRA" step
// refused the manual it had just uploaded — 412 approved_context, shown as
// "Connection lost". Owner ruling A: on a training surface the uploader's own
// manual answers right away. The node chat route already admits a document the
// technician opened (docId); onboarding never passed one.

const UPLOAD = "5f9b2c1a-0000-4000-8000-000000000001";
const ORIGINAL = "5f9b2c1a-0000-4000-8000-0000000000aa";
const INBOX = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const LINE = { id: "11111111-1111-4111-8111-111111111111", unsPath: "enterprise.acme.plant.line_1" };

describe("tryMiraChatScope — Try MIRA asks the manual the stranger just uploaded", () => {
  it("scopes the chat to the upload's own document on the node it was filed to", () => {
    expect(
      tryMiraChatScope({ uploadId: UPLOAD, upload: { kgEntityId: INBOX, statusDetail: null }, line: LINE }),
    ).toEqual({ nodeId: INBOX, unsPath: null, docId: UPLOAD });
  });

  it("a re-upload of identical bytes asks the ORIGINAL document, whose chunks are the ones on file", () => {
    expect(
      tryMiraChatScope({
        uploadId: UPLOAD,
        upload: { kgEntityId: INBOX, statusDetail: `duplicate of ${ORIGINAL}` },
        line: LINE,
      }),
    ).toEqual({ nodeId: INBOX, unsPath: null, docId: ORIGINAL });
  });

  it("an unreadable duplicate marker falls back to the upload's own id, never a guessed one", () => {
    expect(
      tryMiraChatScope({
        uploadId: UPLOAD,
        upload: { kgEntityId: INBOX, statusDetail: "duplicate of not-a-uuid" },
        line: LINE,
      }),
    ).toEqual({ nodeId: INBOX, unsPath: null, docId: UPLOAD });
  });

  it("reads the duplicate marker exactly as its one writer (local-upload.ts) writes it", () => {
    // Cheap-lane review on #4420: the parser depends on another module's
    // status text. Pin the writer, so a reworded marker fails here instead of
    // silently sending a re-upload's chat to a document with no chunks.
    const writer = readFileSync(new URL("../lib/local-upload.ts", import.meta.url), "utf8");
    const written = /`duplicate of \$\{(\w+)\.id\}`/.exec(writer);
    expect(written, "local-upload.ts no longer writes `duplicate of ${dup.id}`").not.toBeNull();
    const detail = `duplicate of ${ORIGINAL}`;
    expect(tryMiraChatScope({ uploadId: UPLOAD, upload: { kgEntityId: INBOX, statusDetail: detail }, line: LINE }).docId)
      .toBe(ORIGINAL);
  });

  it("with no node on the upload there is nothing to scope to — the line node, as before", () => {
    expect(
      tryMiraChatScope({ uploadId: UPLOAD, upload: { kgEntityId: null }, line: LINE }),
    ).toEqual({ nodeId: LINE.id, unsPath: LINE.unsPath });
    expect(tryMiraChatScope({ uploadId: UPLOAD, upload: null, line: LINE })).toEqual({
      nodeId: LINE.id,
      unsPath: LINE.unsPath,
    });
  });
});

describe("nodeChatFailureMessage — a refusal is not a network failure", () => {
  const CONNECTION_LOST = /connection lost|check your network/i;

  it("412 approved_context says what MIRA needs, in plain language", () => {
    const msg = nodeChatFailureMessage(412, {
      gate: "approved_context",
      reason: "MIRA needs approved asset context before answering.",
    });
    expect(msg).toMatch(/approved context/i);
    expect(msg).not.toMatch(CONNECTION_LOST);
  });

  it("a route error code in `error` maps through the same plain-language table", () => {
    expect(nodeChatFailureMessage(400, { error: "invalid_json" })).toBe(
      "The question could not be sent. Try again.",
    );
  });

  it("any other server answer (404, 503, unreadable body) is never blamed on the network", () => {
    for (const [status, body] of [
      [404, { error: "document not found" }],
      [503, null],
      [500, "<html>"],
    ] as const) {
      const msg = nodeChatFailureMessage(status, body);
      expect(msg).not.toMatch(CONNECTION_LOST);
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
