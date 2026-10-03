// Mobile chat-adapter vocabulary -> shared InteractionPart, member by member.
// Run: cd mira-mobile && npx vitest run src/unified/__tests__/to-interaction
import { describe, expect, it } from "vitest";
import type { AdapterMessage, MessagePart } from "../../chat-adapter/contract";
import {
  basisKind,
  citationIndex,
  contextFor,
  latestManualSearchStatus,
  liveFixture,
  projectsFor,
  sourceFor,
  toInteractionPart,
  toThread,
  toTurn,
  withManualSearchOverride,
  withManualSearchOverrides,
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
  { type: "basis", basis: "oem_documentation", label: "Cited from the manual" },
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

  // #3893/#3917, reproduced on a Pixel 9a against staging 2026-09-23: the Hub
  // rides the energized-electrical DIRECTIVE on the evidence frame's
  // hazardEntries and emits NO {kind:"safety"} frame, so turns-to-parts projects
  // a NON-terminal safety_notice (`terminal:false`). This adapter collapsed both
  // shapes to severity "stop", so the shipping unified surface showed
  // "MIRA will not guide the unsafe step" directly above an answer that does
  // guide the steps. mira-hub's own adapter already splits them
  // (mira-hub/src/factorylm-ui/to-interaction.ts safetyNoticePart); mobile must
  // project identically or the two shells disagree about what a turn MEANS.
  it("splits the non-terminal energized directive from the terminal hard stop", () => {
    const stop = toInteractionPart({ type: "safety_notice", trigger: "arc flash", terminal: true });
    expect(stop).toMatchObject({ type: "safety_notice", notice: { severity: "stop" } });
    expect((stop as { notice: { message: string } }).notice.message).toMatch(/^Stop\./);

    const directive = toInteractionPart({
      type: "safety_notice",
      trigger: "energized-electrical-hazard",
      terminal: false,
    });
    expect(directive).toMatchObject({ type: "safety_notice", notice: { severity: "warning" } });
    const message = (directive as { notice: { message: string } }).notice.message;
    expect(message).not.toMatch(/will not guide/);
    expect(message).toMatch(/NFPA 70E/);
  });

  // An older projection has no `terminal` field at all. contract.ts fixes the
  // safe default: treat it as terminal, preserving pre-#3893 behaviour.
  it("treats a projection without `terminal` as a hard stop", () => {
    expect(toInteractionPart({ type: "safety_notice", trigger: "loto" })).toMatchObject({
      type: "safety_notice",
      notice: { severity: "stop" },
    });
  });

  it("never over-claims a basis it cannot recognise", () => {
    expect(basisKind("general")).toBe("general_reasoning");
    expect(basisKind("something new")).toBe("general_reasoning");
    expect(basisKind("live machine evidence")).toBe("live_machine_evidence");
    expect(basisKind("machine history")).toBe("machine_history");
    // PR #3791 regression: an unknown value containing an evidence-flavoured
    // keyword must NOT upgrade to a stronger claim (the old substring
    // heuristic mapped these to oem_documentation via /…|knowledge/).
    expect(basisKind("general_knowledge")).toBe("general_reasoning");
    expect(basisKind("knowledge base entry")).toBe("general_reasoning");
    expect(basisKind("oem_documentation")).toBe("oem_documentation");
    expect(basisKind("workspace_evidence")).toBe("workspace_evidence");
    expect(basisKind("identified_component")).toBe("identified_component");
    expect(toInteractionPart({ type: "basis", basis: "general", label: null })).toEqual({
      type: "evidence_basis", basis: { kind: "general_reasoning", label: "general", authorized: false },
    });
  });

  it("marks a stopped answer as not retryable and a workspace file as a workspace source", () => {
    expect(toInteractionPart({ type: "error", reason: "stopped" })).toMatchObject({ error: { code: "stopped", retryable: false } });
    expect(sourceFor({ ...CITATION, page: null, fileId: "file-9" })).toMatchObject({ kind: "workspace_file", locator: "Check the supply." });
  });

  // T2 (#4175, #4189): identity_proposal and manual_search_status frames ride
  // the mobile wire as `{type:"unknown", raw:{kind:"identity_proposal", ...}}`
  // (sse.ts's generic passthrough, unmodified — it's guarded legacy
  // presentation). Recognizing them HERE, in the canonical adapter, is what
  // turns the raw "Unrecognized part" inspection box into the confirm card.
  it("recognizes an identity_proposal raw frame and maps it to a real part", () => {
    expect(toInteractionPart({ type: "unknown", raw: { kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" } }))
      .toEqual({ type: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" });
  });

  it("carries catalogNumber through when the server includes one", () => {
    expect(toInteractionPart({ type: "unknown", raw: { kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3", catalogNumber: "DUW01302" } }))
      .toEqual({ type: "identity_proposal", manufacturer: "SMC", model: "SS5Y3", catalogNumber: "DUW01302" });
  });

  it("recognizes a manual_search_status raw frame, running and finished", () => {
    expect(toInteractionPart({ type: "unknown", raw: { kind: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: true } }))
      .toEqual({ type: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: true });
    expect(toInteractionPart({ type: "unknown", raw: { kind: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: false, message: "Found it." } }))
      .toEqual({ type: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: false, message: "Found it." });
  });

  it("falls back to unknown for a malformed identity_proposal/manual_search_status and any other kind (regression)", () => {
    // Missing required fields — never half-render a card with blanks.
    expect(toInteractionPart({ type: "unknown", raw: { kind: "identity_proposal", manufacturer: "SMC" } }))
      .toEqual({ type: "unknown", raw: { kind: "identity_proposal", manufacturer: "SMC" } });
    expect(toInteractionPart({ type: "unknown", raw: { kind: "manual_search_status", manufacturer: "SMC", model: "X" } }))
      .toEqual({ type: "unknown", raw: { kind: "manual_search_status", manufacturer: "SMC", model: "X" } });
    // A genuinely unknown future kind stays unknown, unchanged.
    expect(toInteractionPart({ type: "unknown", raw: { kind: "future" } })).toEqual({ type: "unknown", raw: { kind: "future" } });
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
    expect(thread.id).toBe("notebook-nb-1:thread-legacy");
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

// Light-review fix (PR #4195, "a stale proposal can overwrite a later
// confirmed identity"): a persisted identity_proposal card must settle
// itself against the notebook's CURRENT confirmed identity (`meta.
// confirmedIdentity`), never offering a live Confirm when it's stale.
describe("identity_proposal settling — stale-card guard (#4195)", () => {
  const proposalMsg: AdapterMessage = {
    id: "a1",
    role: "assistant",
    parts: [{ type: "unknown", raw: { kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" } }],
    lifecycle: "completed",
    status: null,
  };

  it("flags priorOutcome:'confirmed' when the notebook's CURRENT identity matches (case/punctuation-insensitive)", () => {
    const meta = { ...META, confirmedIdentity: { manufacturer: "smc", model: "ss5y3 duw01302" } };
    const turn = toTurn(proposalMsg, meta);
    expect(turn.parts).toContainEqual({ type: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302", priorOutcome: "confirmed" });
  });

  it("flags priorOutcome:'superseded' when the notebook is NOW confirmed to a DIFFERENT identity", () => {
    const meta = { ...META, confirmedIdentity: { manufacturer: "Rockwell Automation", model: "PowerFlex 525" } };
    const turn = toTurn(proposalMsg, meta);
    expect(turn.parts).toContainEqual({ type: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302", priorOutcome: "superseded" });
  });

  it("carries no priorOutcome when the notebook has no confirmed identity yet (today's live card)", () => {
    const meta = { ...META, confirmedIdentity: null };
    const turn = toTurn(proposalMsg, meta);
    expect(turn.parts).toContainEqual({ type: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" });
  });

  it("leaves every other part type untouched", () => {
    const meta = { ...META, confirmedIdentity: { manufacturer: "Rockwell Automation", model: "PowerFlex 525" } };
    const turn = toTurn(messages0WithBasis(), meta);
    expect(turn.parts[0]).toEqual({ type: "evidence_basis", basis: { kind: "oem_documentation", label: "Cited from the manual", authorized: false } });
  });

  function messages0WithBasis(): AdapterMessage {
    return { id: "b1", role: "assistant", parts: [{ type: "basis", basis: "oem_documentation", label: "Cited from the manual" }], lifecycle: "completed", status: null };
  }
});

// Codex F4 (#4189): "Searching…" must resolve once the background search
// settles, even though NotebookScreen (frozen) keeps a completed turn's
// parts verbatim in `liveTurns` forever. `UnifiedChat`'s bounded re-check
// overlays the real outcome via these two pure helpers.
describe("latestManualSearchStatus / withManualSearchOverride (#4189 F4)", () => {
  const searching: AdapterMessage[] = [
    { id: "q", role: "user", parts: [{ type: "text", text: "is this an SMC SS5Y3?", knownCitationIds: [] }], lifecycle: "completed", status: null },
    {
      id: "a",
      role: "assistant",
      parts: [
        { type: "unknown", raw: { kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3" } },
        { type: "unknown", raw: { kind: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: true } },
      ],
      lifecycle: "completed",
      status: "insufficient_evidence",
    },
  ];

  it("finds the most recent manual_search_status part across the thread", () => {
    const thread = toThread(searching, META);
    expect(latestManualSearchStatus(thread.turns)).toEqual({ type: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: true });
  });

  it("returns null when nothing is searching", () => {
    expect(latestManualSearchStatus(toThread([searching[0]], META).turns)).toBeNull();
  });

  it("overlays the settled outcome onto the matching part — 'Searching…' resolves to the real result", () => {
    const thread = toThread(searching, META);
    const resolved = withManualSearchOverride(thread, { manufacturer: "SMC", model: "SS5Y3", running: false, message: "Found it — check Sources." });
    const part = resolved.turns[1].parts.find((p) => p.type === "manual_search_status");
    expect(part).toEqual({ type: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: false, message: "Found it — check Sources." });
    // Every other part on that turn, and the question turn, are untouched.
    expect(resolved.turns[1].parts[0]).toEqual(thread.turns[1].parts[0]);
    expect(resolved.turns[0]).toEqual(thread.turns[0]);
  });

  it("does nothing when the override is null", () => {
    const thread = toThread(searching, META);
    expect(withManualSearchOverride(thread, null)).toBe(thread);
  });

  // Codex round 2 F4: the server NEVER persists manual_search_status (the
  // SSE frame is deliberately transient — see chat/route.ts's own comment),
  // so after a reload (or for an identity the live frame never covered —
  // e.g. the hydration-time GET check, which has no live frame to overlay
  // onto at all) there is NO existing part to replace. The override must
  // still render — appended to the last assistant turn — exactly like the
  // Hub's `withManualSearchStatus`.
  it("APPENDS a rendered part to the last assistant turn when none exists yet (the realistic post-reload case)", () => {
    const noFrame: AdapterMessage[] = [
      { id: "q", role: "user", parts: [{ type: "text", text: "is this an SMC SS5Y3?", knownCitationIds: [] }], lifecycle: "completed", status: null },
      { id: "a", role: "assistant", parts: [{ type: "unknown", raw: { kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3" } }], lifecycle: "completed", status: "insufficient_evidence" },
    ];
    const thread = toThread(noFrame, META);
    expect(latestManualSearchStatus(thread.turns)).toBeNull();
    const out = withManualSearchOverride(thread, { manufacturer: "SMC", model: "SS5Y3", running: true });
    expect(out.turns[1].parts).toContainEqual({ type: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: true });
    // The identity_proposal part is untouched, not replaced.
    expect(out.turns[1].parts).toContainEqual(thread.turns[1].parts[0]);
  });

  it("appends for an unrelated (different) identity too — the override is the current truth, not a conditional guess", () => {
    const thread = toThread(searching, META);
    const out = withManualSearchOverride(thread, { manufacturer: "Rockwell", model: "PowerFlex 525", running: false });
    // The EXISTING SMC part is untouched (no match to replace)...
    expect(out.turns[1].parts).toContainEqual(thread.turns[1].parts[1]);
    // ...and the Rockwell status is appended.
    expect(out.turns[1].parts).toContainEqual({ type: "manual_search_status", manufacturer: "Rockwell", model: "PowerFlex 525", running: false });
  });

  it("returns the thread unchanged when there is no assistant turn to append to", () => {
    const userOnly: AdapterMessage[] = [{ id: "q", role: "user", parts: [{ type: "text", text: "hi", knownCitationIds: [] }], lifecycle: "completed", status: null }];
    const thread = toThread(userOnly, META);
    const out = withManualSearchOverride(thread, { manufacturer: "SMC", model: "SS5Y3", running: true });
    expect(out).toEqual(thread);
  });
});

// Codex round 6 F17 (#4195): a SECOND, different search must not erase the
// first search's resolved outcome. The root cause had two parts — matching
// by manufacturer/model identity alone (conflates a retry's two different
// generations), and `UnifiedChat` keeping only ONE override at a time (see
// its own `settledManualSearches` map). This file proves the pure-function
// half: generation-aware matching, and applying several overrides at once.
describe("withManualSearchOverride / withManualSearchOverrides — generation-aware matching (#4195 round 6 F17)", () => {
  const twoGenerations: AdapterMessage[] = [
    { id: "q1", role: "user", parts: [{ type: "text", text: "is this an SMC SS5Y3?", knownCitationIds: [] }], lifecycle: "completed", status: null },
    {
      id: "a1",
      role: "assistant",
      parts: [{ type: "unknown", raw: { kind: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: true, startedAt: "gen-1" } }],
      lifecycle: "completed",
      status: "insufficient_evidence",
    },
    { id: "q2", role: "user", parts: [{ type: "text", text: "retry?", knownCitationIds: [] }], lifecycle: "completed", status: null },
    {
      id: "a2",
      role: "assistant",
      parts: [{ type: "unknown", raw: { kind: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: true, startedAt: "gen-2" } }],
      lifecycle: "completed",
      status: "insufficient_evidence",
    },
  ];

  it("a generation-stamped override replaces ONLY its own generation's part, even when another part shares the same manufacturer/model (a retry)", () => {
    const thread = toThread(twoGenerations, META);
    const out = withManualSearchOverride(thread, {
      manufacturer: "SMC", model: "SS5Y3", running: false, message: "Found it (2).", startedAt: "gen-2",
    });
    expect(out.turns[1].parts.find((p) => p.type === "manual_search_status")).toEqual({
      type: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: true, startedAt: "gen-1",
    });
    expect(out.turns[3].parts.find((p) => p.type === "manual_search_status")).toEqual({
      type: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: false, message: "Found it (2).", startedAt: "gen-2",
    });
  });

  it("withManualSearchOverrides applies every historical outcome (replace-only) plus the active one (replace-or-append)", () => {
    const thread = toThread(twoGenerations, META);
    const out = withManualSearchOverrides(
      thread,
      [{ manufacturer: "SMC", model: "SS5Y3", running: false, message: "Found it (1).", startedAt: "gen-1" }],
      { manufacturer: "SMC", model: "SS5Y3", running: false, message: "Found it (2).", startedAt: "gen-2" },
    );
    expect(out.turns[1].parts).toContainEqual({
      type: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: false, message: "Found it (1).", startedAt: "gen-1",
    });
    expect(out.turns[3].parts).toContainEqual({
      type: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: false, message: "Found it (2).", startedAt: "gen-2",
    });
  });

  it("a historical (replace-only) override never appends when no matching generation exists in the thread — would otherwise leak onto an unrelated turn", () => {
    const thread = toThread(twoGenerations, META);
    const out = withManualSearchOverrides(
      thread,
      [{ manufacturer: "Siemens", model: "6ES7", running: false, message: "Found it (3).", startedAt: "gen-3" }],
      null,
    );
    expect(out).toEqual(thread);
  });

  it("the active override wins for its own generation even when a stale historical entry shares the same key", () => {
    const thread = toThread(twoGenerations, META);
    const out = withManualSearchOverrides(
      thread,
      [{ manufacturer: "SMC", model: "SS5Y3", running: false, message: "STALE.", startedAt: "gen-2" }],
      { manufacturer: "SMC", model: "SS5Y3", running: true, startedAt: "gen-2" },
    );
    expect(out.turns[3].parts.find((p) => p.type === "manual_search_status")).toEqual({
      type: "manual_search_status", manufacturer: "SMC", model: "SS5Y3", running: true, startedAt: "gen-2",
    });
  });
});
