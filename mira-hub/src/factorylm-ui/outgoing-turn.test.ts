/**
 * The technician's own message, like any chat app (owner ask, 2026-10-05):
 * shown the moment Send is tapped, with its photo, and the saved message keeps
 * the photo. Before this a photo send — or a first send from HOME — showed
 * nothing for ~38 s on staging, and the saved question was text only.
 */
import { describe, expect, it } from "vitest";

import type { Attachment, ContextSnapshot, InteractionTurn } from "../../../packages/factorylm-interaction/src";
import { HOME_THREAD, createOutgoingOwner, outgoingTurn, withOutgoing, type Outgoing } from "./outgoing-turn";
import { fileUrl, turnsFromPersisted, type HubNotebookMeta } from "./to-interaction";

const AT = "2026-10-05T20:00:00.000Z";
const CONTEXT: ContextSnapshot = { tenantId: "t", machineIdentity: "not_applicable", evidenceAuthorization: "not_applicable", capturedAt: AT };
const PHOTO: Attachment = { id: "a-1", name: "plate.jpg", mediaType: "image/jpeg", kind: "photo", status: "ready", previewUrl: "blob:https://app.factorylm.com/1" };
const OPEN = "notebook-nb-1:thread-t-1";
const NONE = { turns: [], outgoingId: null } as const;

function outgoing(over: Partial<Outgoing> = {}): Outgoing {
  return { id: "out-1", threadId: OPEN, question: "what is this?", attachments: [PHOTO], startedAt: AT, ...over };
}
function turn(id: string, role: "user" | "assistant", text: string): InteractionTurn {
  return { id, threadId: OPEN, role, parts: [{ type: "text", text }], lifecycle: "completed", context: CONTEXT, createdAt: AT, updatedAt: AT };
}
const saved = [turn("r1-q", "user", "earlier"), turn("r1-a", "assistant", "earlier answer")];

describe("the message shows the moment Send is tapped", () => {
  it("before any stream: the question and its photo, queued, after the saved turns", () => {
    const turns = withOutgoing(saved, NONE, outgoing(), OPEN, OPEN, CONTEXT);
    expect(turns.map((t) => t.id)).toEqual(["r1-q", "r1-a", "out-1-q"]);
    const mine = turns[2];
    expect(mine.role).toBe("user");
    expect(mine.parts).toEqual([
      { type: "text", text: "what is this?" },
      { type: "attachment", attachment: { ...PHOTO, status: "queued" } },
    ]);
  });

  it("a photo with no words shows the photo alone (no empty text bubble)", () => {
    const mine = outgoingTurn(outgoing({ question: "" }), OPEN, CONTEXT);
    expect(mine.parts.map((p) => p.type)).toEqual(["attachment"]);
  });

  it("once streaming, the stream's question turn carries the photo — never two copies of the message", () => {
    const streaming = [turn("live-q", "user", "what is this?"), turn("live-a", "assistant", "It is a TP700")];
    const turns = withOutgoing(saved, { turns: streaming, outgoingId: "out-1" }, outgoing(), OPEN, OPEN, CONTEXT);
    expect(turns.map((t) => t.id)).toEqual(["r1-q", "r1-a", "live-q", "live-a"]);
    expect(turns[2].parts.map((p) => p.type)).toEqual(["text", "attachment"]);
  });

  it("a stopped earlier answer keeps its own question; the new message and photo show after it (Codex #4289 F1)", () => {
    // Stop left the previous exchange on screen; the new photo is still uploading.
    const stopped = { turns: [turn("live-old-q", "user", "earlier stopped"), turn("live-old-a", "assistant", "partial")], outgoingId: "out-0" };
    const turns = withOutgoing(saved, stopped, outgoing(), OPEN, OPEN, CONTEXT);
    expect(turns.map((t) => t.id)).toEqual(["r1-q", "r1-a", "live-old-q", "live-old-a", "out-1-q"]);
    expect(turns[2].parts).toEqual([{ type: "text", text: "earlier stopped" }]);
    expect(turns[4].parts.map((p) => p.type)).toEqual(["text", "attachment"]);
    // A retry stream (started by no outgoing message) is not this message's stream either.
    expect(withOutgoing(saved, { ...stopped, outgoingId: null }, outgoing(), OPEN, OPEN, CONTEXT).map((t) => t.id)).toContain("out-1-q");
  });

  it("never shows in another thread", () => {
    const turns = withOutgoing(saved, NONE, outgoing(), "notebook-nb-2:thread-x", OPEN, CONTEXT);
    expect(turns.map((t) => t.id)).toEqual(["r1-q", "r1-a"]);
  });

  it("control: nothing outgoing leaves the thread exactly as it was", () => {
    const streaming = [turn("live-q", "user", "q"), turn("live-a", "assistant", "a")];
    expect(withOutgoing(saved, { turns: streaming, outgoingId: null }, null, OPEN, OPEN, CONTEXT)).toEqual([...saved, ...streaming]);
  });

  it("a first send from HOME shows on HOME before any project exists", () => {
    const turns = withOutgoing([], NONE, outgoing({ threadId: HOME_THREAD }), HOME_THREAD, "fixture-thread", CONTEXT);
    expect(turns).toHaveLength(1);
    expect(turns[0].threadId).toBe("fixture-thread");
  });
});

describe("the saved message keeps its photo", () => {
  const meta: HubNotebookMeta = {
    notebookId: "nb-1",
    threadId: "t-1",
    asset: null,
    identityConfirmed: false,
    capturedAt: AT,
    tenantId: "t",
  } as unknown as HubNotebookMeta;
  const row = (evidence: unknown[]) => ({
    id: "r9", question: "what is this?", answerText: "It is a TP700.", answerStatus: "answered", evidence, createdAt: AT,
  }) as unknown as Parameters<typeof turnsFromPersisted>[0];

  it("a question sent with a photo shows that photo on the question turn", () => {
    const [q] = turnsFromPersisted(row([{ kind: "visual_observation", fileId: "f9fdad9c", capturedAt: AT, provenance: "phone_photo" }]), meta);
    expect(q.role).toBe("user");
    expect(q.parts).toEqual([
      { type: "text", text: "what is this?" },
      { type: "attachment", attachment: { id: "f9fdad9c", name: "Photo", mediaType: "image/*", kind: "photo", status: "ready", previewUrl: fileUrl("f9fdad9c") } },
    ]);
  });

  it("control: a question without a photo stays text only", () => {
    const [q] = turnsFromPersisted(row([]), meta);
    expect(q.parts).toEqual([{ type: "text", text: "what is this?" }]);
  });
});

describe("the outgoing message owns its photo previews (Codex #4289 F2)", () => {
  const owner = () => {
    const released: string[] = [];
    const seen: (Outgoing | null)[] = [];
    return { released, seen, o: createOutgoingOwner((id) => released.push(id), (x) => seen.push(x)) };
  };

  it("leaving the hub releases a sent photo that is still on screen (a stopped answer)", () => {
    const { released, o } = owner();
    o.put(outgoing());
    o.dispose();
    expect(released).toEqual(["a-1"]);
    o.dispose();
    expect(released).toEqual(["a-1"]);
  });

  it("drop with a stale id leaves the newer message (and its photo) alone", () => {
    const { released, seen, o } = owner();
    o.put(outgoing({ id: "out-0", attachments: [{ ...PHOTO, id: "a-0" }] }));
    o.put(outgoing());
    expect(released).toEqual(["a-0"]);
    o.drop("out-0");
    expect(o.current?.id).toBe("out-1");
    expect(released).toEqual(["a-0"]);
    o.drop("out-1");
    expect(o.current).toBeNull();
    expect(released).toEqual(["a-0", "a-1"]);
    expect(seen.at(-1)).toBeNull();
  });

  it("moving the HOME message to its new thread keeps its photo", () => {
    const { released, o } = owner();
    const home = outgoing({ threadId: HOME_THREAD });
    o.put(home);
    o.put({ ...home, threadId: OPEN });
    expect(released).toEqual([]);
  });
});
