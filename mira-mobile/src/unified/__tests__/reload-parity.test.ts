// Phone ↔ /v3 parity on a RELOADED thread (parity matrix rows 2 and 4,
// 2026-10-07 Pixel acceptance on staging 5da41825a).
// Run: cd mira-mobile && npx vitest run src/unified/__tests__/reload-parity
import { describe, expect, it } from "vitest";
import type { InteractionThread } from "@factorylm/interaction";
import type { AdapterMessage, MessagePart } from "../../chat-adapter/contract";
import { toThread, type UnifiedNotebookMeta } from "../to-interaction";
import { observationFileIds, withPhotoPreviews } from "../photo-previews";
import { notebookSourceDocIds, withNotebookCaptions } from "../reload-captions";

const META: UnifiedNotebookMeta = {
  notebookId: "nb-1",
  title: "PF525 acceptance",
  identityConfirmed: false,
  capturedAt: "2026-10-07T18:00:00.000Z",
};

const OWN = { citationId: "1", sourceTitle: "PowerFlex 525 User Manual", page: 21, quote: "F004 UnderVoltage", docId: "doc-own", fileId: "file-own" };
const OTHER = { citationId: "2", sourceTitle: "PowerFlex 525 User Manual", page: 22, quote: "F005 OverVoltage", docId: "doc-own-2", fileId: "file-own-2" };
const LIBRARY = { citationId: "3", sourceTitle: "Shared library manual", page: 9, quote: "F004", docId: null, fileId: null };

/** A reloaded answer: the persisted row carries the basis value but no label. */
function reloaded(citations: (typeof OWN | typeof LIBRARY)[], label: string | null = null): AdapterMessage {
  const parts: MessagePart[] = [
    { type: "text", text: "F004 is an undervoltage fault [1].", knownCitationIds: citations.map((c) => c.citationId) },
    ...citations.map((citation) => ({ type: "source" as const, citation })),
    { type: "basis", basis: "oem_documentation", label },
  ];
  return { id: "row-1-a", role: "assistant", parts, lifecycle: "completed" } as AdapterMessage;
}

function caption(msg: AdapterMessage, notebookDocIds?: readonly string[]): string | undefined {
  const thread = withNotebookCaptions(toThread([msg], META), [msg], notebookDocIds);
  const part = thread.turns[0]!.parts.find((p) => p.type === "evidence_basis");
  return part?.type === "evidence_basis" ? part.basis.label : undefined;
}

describe("row 2 — a reloaded answer's caption names the notebook only when provable (/v3 #4301)", () => {
  it("names the notebook when every citation is one of its own sources", () => {
    expect(caption(reloaded([OWN, OTHER]), ["doc-own", "doc-own-2"])).toBe("Grounded in this notebook's sources.");
  });

  it("names no scope when one citation is a shared-library chunk (no docId)", () => {
    expect(caption(reloaded([OWN, LIBRARY]), ["doc-own"])).toBe("Grounded in the cited documentation.");
  });

  it("names no scope when a cited doc is not among the notebook's sources", () => {
    expect(caption(reloaded([OWN, OTHER]), ["doc-own"])).toBe("Grounded in the cited documentation.");
  });

  it("names no scope while the notebook's sources are unknown", () => {
    expect(caption(reloaded([OWN]))).toBe("Grounded in the cited documentation.");
  });

  it("names no scope for an answer with no citations at all", () => {
    expect(caption(reloaded([]), ["doc-own"])).toBe("Grounded in the cited documentation.");
  });

  it("keeps the server's own live label untouched", () => {
    expect(caption(reloaded([OWN], "Grounded in the manufacturer's documentation (shared library)."), ["doc-own"]))
      .toBe("Grounded in the manufacturer's documentation (shared library).");
  });

  it("treats a rejected match, and a row with no docId, as not the notebook's source", () => {
    expect(notebookSourceDocIds([
      { docId: "doc-own", matchState: "user_confirmed" },
      { docId: "doc-candidate", matchState: "candidate" },
      { docId: "doc-rejected", matchState: "rejected" },
      { docId: "", matchState: "verified" },
    ])).toEqual(["doc-own", "doc-candidate"]);
  });
});

const PHOTO_ENTRY = { kind: "visual_observation" as const, fileId: "photo-1", capturedAt: "2026-10-07T17:00:00Z", provenance: "phone_photo" };

function photoThread(): InteractionThread {
  const question: AdapterMessage = { id: "row-2-q", role: "user", parts: [{ type: "text", text: "What does this nameplate say?" }], lifecycle: "completed" } as AdapterMessage;
  const answer: AdapterMessage = {
    id: "row-2-a",
    role: "assistant",
    parts: [
      { type: "text", text: "It reads 480 V.", knownCitationIds: [] },
      { type: "observation", entry: PHOTO_ENTRY },
    ],
    lifecycle: "completed",
  } as AdapterMessage;
  return toThread([question, answer], META);
}

describe("row 4 — the sent photo shows as a picture, as on /v3", () => {
  it("lists each photo the thread carries once", () => {
    const thread = photoThread();
    const doubled = { ...thread, turns: [...thread.turns, ...thread.turns] };
    expect(observationFileIds(doubled)).toEqual(["photo-1"]);
  });

  it("gives the observation card its picture and puts the photo on the question", () => {
    const thread = withPhotoPreviews(photoThread(), new Map([["photo-1", "blob:https://localhost/p1"]]));
    const [question, answer] = thread.turns;
    const observation = answer!.parts.find((p) => p.type === "visual_observation");
    expect(observation?.type === "visual_observation" && observation.observation.previewUrl).toBe("blob:https://localhost/p1");
    const attachment = question!.parts.find((p) => p.type === "attachment");
    expect(attachment).toEqual({
      type: "attachment",
      attachment: { id: "photo-1", name: "Photo", mediaType: "image/*", kind: "photo", status: "ready", previewUrl: "blob:https://localhost/p1" },
    });
  });

  it("changes nothing until the picture is loaded", () => {
    const thread = photoThread();
    expect(withPhotoPreviews(thread, new Map())).toBe(thread);
    const other = withPhotoPreviews(thread, new Map([["photo-9", "blob:https://localhost/p9"]]));
    expect(other.turns[0]!.parts.some((p) => p.type === "attachment")).toBe(false);
  });

  it("never adds the same photo to the question twice", () => {
    const previews = new Map([["photo-1", "blob:https://localhost/p1"]]);
    const twice = withPhotoPreviews(withPhotoPreviews(photoThread(), previews), previews);
    expect(twice.turns[0]!.parts.filter((p) => p.type === "attachment")).toHaveLength(1);
  });
});
