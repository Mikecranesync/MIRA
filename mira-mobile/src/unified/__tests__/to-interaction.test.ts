// Mobile chat-adapter vocabulary -> shared InteractionPart, member by member.
// Run: cd mira-mobile && npx vitest run src/unified/__tests__/to-interaction
import { describe, expect, it } from "vitest";
import type { AdapterMessage, MessagePart } from "../../chat-adapter/contract";
import {
  basisKind,
  citationIndex,
  contextFor,
  liveFixture,
  projectsFor,
  sourceFor,
  toInteractionPart,
  toThread,
  toTurn,
  type UnifiedNotebookMeta,
} from "../to-interaction";

const META: UnifiedNotebookMeta = {
  notebookId: "nb-1",
  title: "Drive A",
  tenantId: "t-1",
  asset: { id: "asset-1", name: "Launch 2 Drive A", unsPath: "rides.launch2.drive_a" },
  identityConfirmed: true,
  capturedAt: "2026-09-06T18:00:00.000Z",
};

const CITATION = { citationId: "c1", sourceTitle: "G120 Operating Instructions", page: 418, quote: "Check the supply.", fileId: null };

const PARTS: MessagePart[] = [
  { type: "basis", basis: "documents", label: "Cited from the manual" },
  { type: "text", text: "Check the supply first.", knownCitationIds: ["c1"] },
  { type: "source", citation: CITATION },
  { type: "machine_evidence", entry: { kind: "machine_evidence", assetId: "asset-1", anchorAt: "2026-09-06T17:00:00Z", pre: 120, post: 120, rowCount: 23, freshness: "stale", reason: null } },
  { type: "observation", entry: { kind: "visual_observation", fileId: "f1", capturedAt: "2026-09-06T17:01:00Z", provenance: "phone_photo" } },
  { type: "safety_notice", trigger: "bypass the interlock" },
  { type: "error", reason: "provider_failure" },
  { type: "followups", suggestions: ["What next?"] },
  { type: "identity_dispute" },
  { type: "unknown", raw: { kind: "future" } },
];

describe("toInteractionPart", () => {
  it("maps every mobile part to exactly one shared part, in order, preserving unknowns", () => {
    const mapped = PARTS.map(toInteractionPart);
    expect(mapped.map((p) => p.type)).toEqual([
      "evidence_basis", "text", "source", "machine_evidence", "visual_observation",
      "safety_notice", "error", "followups", "identity_dispute", "unknown",
    ]);
    // Display grouping only: authorization is server-owned and never asserted from a basis string.
    expect(mapped[0]).toEqual({ type: "evidence_basis", basis: { kind: "oem_documentation", label: "Cited from the manual", authorized: false } });
    expect(mapped[4]).toMatchObject({ type: "visual_observation", observation: { verified: false } });
    expect(mapped[2]).toEqual({ type: "source", source: { id: "c1", title: "G120 Operating Instructions", kind: "oem_documentation", locator: "p. 418" } });
    expect(mapped[3]).toMatchObject({ type: "machine_evidence", evidence: { preSeconds: 120, postSeconds: 120, rowCount: 23, freshness: "stale", source: "recorded" } });
    expect(mapped[5]).toMatchObject({ type: "safety_notice", notice: { severity: "stop", trigger: "bypass the interlock" } });
    expect(mapped[6]).toMatchObject({ type: "error", error: { code: "provider_failure", retryable: true } });
    expect(mapped[9]).toEqual({ type: "unknown", raw: { kind: "future" } });
  });

  it("never over-claims a basis it cannot recognise", () => {
    expect(basisKind("general")).toBe("general_reasoning");
    expect(basisKind("something new")).toBe("general_reasoning");
    expect(basisKind("live machine evidence")).toBe("live_machine_evidence");
    expect(basisKind("machine history")).toBe("machine_history");
    expect(toInteractionPart({ type: "basis", basis: "general", label: null })).toEqual({
      type: "evidence_basis", basis: { kind: "general_reasoning", label: "general", authorized: false },
    });
  });

  it("marks a stopped answer as not retryable and a workspace file as a workspace source", () => {
    expect(toInteractionPart({ type: "error", reason: "stopped" })).toMatchObject({ error: { code: "stopped", retryable: false } });
    expect(sourceFor({ ...CITATION, page: null, fileId: "file-9" })).toMatchObject({ kind: "workspace_file", locator: "Check the supply." });
  });
});

describe("turns and thread", () => {
  const messages: AdapterMessage[] = [
    { id: "r1-q", role: "user", parts: [{ type: "text", text: "Why F30001?", knownCitationIds: [] }], lifecycle: "completed", status: null },
    { id: "r1-a", role: "assistant", parts: PARTS, lifecycle: "failed", status: "error" },
    { id: "live-0-a", role: "assistant", parts: [{ type: "text", text: "…", knownCitationIds: [] }], lifecycle: "running", status: null },
  ];

  it("keeps ids, roles, lifecycles, and gives a disputed turn an unconfirmed context", () => {
    const thread = toThread(messages, META);
    expect(thread.id).toBe("notebook-nb-1");
    expect(thread.primaryAssetId).toBe("asset-1");
    expect(thread.turns.map((t) => [t.id, t.role, t.lifecycle])).toEqual([
      ["r1-q", "user", "completed"], ["r1-a", "assistant", "failed"], ["live-0-a", "assistant", "running"],
    ]);
    expect(thread.turns[0].context.machineIdentity).toBe("confirmed");
    expect(thread.turns[1].context.machineIdentity).toBe("unconfirmed");
    expect(thread.turns[1].context.evidenceAuthorization).toBe("not_authorized");
  });

  it("indexes citations for the host viewer and builds a fixture-shaped snapshot", () => {
    expect(citationIndex(messages).get("c1")).toBe(CITATION);
    const fixture = liveFixture(messages, META);
    expect(fixture.machines).toEqual([{ id: "asset-1", canonicalAssetId: "asset-1", name: "Launch 2 Drive A", unsPath: "rides.launch2.drive_a", status: "unknown" }]);
    expect(projectsFor(META)[0].children.map((c) => c.kind)).toEqual(["machine-link", "thread"]);
    expect(contextFor({ ...META, asset: null })).toMatchObject({ machineIdentity: "not_applicable", evidenceAuthorization: "not_applicable" });
    expect(toTurn(messages[0], { ...META, asset: null }).context.machineId).toBeUndefined();
    expect(contextFor({ ...META, identityConfirmed: false })).toMatchObject({ machineIdentity: "unconfirmed", evidenceAuthorization: "not_authorized" });
  });
});
