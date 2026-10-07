import { describe, expect, it } from "vitest";
import type { StreamResult, PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import { ENERGIZED_ELECTRICAL_HAZARD } from "@/lib/safety-classifier";
import {
  answerTurnId,
  basisKind,
  citationIndex,
  contextFor,
  fileUrl,
  hasIdentityDispute,
  hasTerminalSafetyStop,
  identityProposalOf,
  isTerminalSafetyNotice,
  lifecycleFromStream,
  partsFromStream,
  sourceFor,
  sourceIdFor,
  threadFromPersisted,
  turnsFromPersisted,
  withManualSearchStatus,
  type HubNotebookMeta,
} from "./to-interaction";

type StreamResultWithStatusMessage = StreamResult & { statusMessage?: string | null };

const LIVE = { turnId: "live-1-a" };

const AT = "2026-09-17T12:00:00.000Z";

const meta: HubNotebookMeta = {
  notebookId: "nb-1",
  threadId: "notebook-nb-1:thread-t-1",
  title: "Conveyor CV-101",
  tenantId: "tenant-1",
  asset: { id: "asset-uuid-1", name: "GS10", unsPath: "enterprise.garage.cv_101" },
  identityConfirmed: true,
  capturedAt: AT,
};

const citation: EvidenceCitation = {
  citationId: "1",
  docId: "doc-1",
  sourceTitle: "GS10 User Manual",
  page: 47,
  fileId: null,
  quote: "Set P9.01 to 2 for Modbus control.",
};

const visual = {
  kind: "visual_observation" as const,
  fileId: "f9fdad9c",
  capturedAt: AT,
  provenance: "phone_photo" as const,
};

function stream(over: Partial<StreamResultWithStatusMessage> = {}): StreamResultWithStatusMessage {
  return {
    content: "Check the Modbus link first.",
    citations: [citation],
    status: "answered",
    basis: "oem_documentation",
    followups: ["What does P9.02 do"],
    machineEvidence: null,
    visualEvidence: null,
    safetyNotice: null,
    hazardNotice: null,
    sawStatus: true,
    ...over,
    // #3854 makes this field required on StreamResult. Keep this branch
    // compatible before and after that merge, including when a Partial
    // override contains explicit undefined.
    statusMessage: over.statusMessage ?? null,
  };
}

describe("sourceFor / basisKind", () => {
  it("maps a citation to a TURN-SCOPED SourceReference without inventing a file", () => {
    // Codex #3839 F1: the shell id is scoped to the answer turn; the visible number stays the citation's own.
    expect(sourceFor(citation, "turn-1-a")).toEqual({ id: "turn-1-a:1", title: "GS10 User Manual", kind: "oem_documentation", locator: "p. 47" });
    expect(sourceFor({ ...citation, page: null, fileId: "file-9" }, "t")).toMatchObject({ kind: "workspace_file", locator: "Set P9.01 to 2 for Modbus control." });
    expect(sourceFor({ ...citation, page: null, quote: null }, "t")).toMatchObject({ locator: "cited passage" });
    expect(sourceIdFor("turn-2-a", "1")).toBe("turn-2-a:1");
    expect(answerTurnId("turn-2")).toBe("turn-2-a");
  });

  it("never upgrades an unknown basis to a stronger claim", () => {
    expect(basisKind("oem_documentation")).toBe("oem_documentation");
    expect(basisKind("Live Machine Evidence")).toBe("live_machine_evidence");
    expect(basisKind("general_knowledge")).toBe("general_reasoning");
    expect(basisKind("")).toBe("general_reasoning");
  });
});

describe("contextFor — machine identity is server-owned", () => {
  it("confirmed binding → confirmed + authorized", () => {
    expect(contextFor(meta)).toMatchObject({ machineId: "asset-uuid-1", machineIdentity: "confirmed", evidenceAuthorization: "authorized", projectId: "project-nb-1" });
  });
  it("unconfirmed binding or a disputed turn → unconfirmed + not_authorized", () => {
    expect(contextFor({ ...meta, identityConfirmed: false })).toMatchObject({ machineIdentity: "unconfirmed", evidenceAuthorization: "not_authorized" });
    expect(contextFor(meta, true)).toMatchObject({ machineIdentity: "unconfirmed", evidenceAuthorization: "not_authorized" });
  });
  it("no binding → not_applicable, no machineId", () => {
    const ctx = contextFor({ ...meta, asset: null });
    expect(ctx.machineId).toBeUndefined();
    expect(ctx.machineIdentity).toBe("not_applicable");
  });
});

describe("partsFromStream", () => {
  it("answered: text, sources, basis (never authorized), evidence, followups — in that order", () => {
    const parts = partsFromStream(stream({
      machineEvidence: { kind: "machine_evidence", assetId: "asset-uuid-1", anchorAt: AT, pre: 30, post: 30, rowCount: 4, freshness: "stale" },
      visualEvidence: { kind: "visual_observation", fileId: "f9fdad9c", capturedAt: AT, provenance: "phone_photo" },
    }), LIVE);
    expect(parts.map((p) => p.type)).toEqual(["text", "source", "evidence_basis", "machine_evidence", "visual_observation", "followups"]);
    expect(parts[2]).toEqual({ type: "evidence_basis", basis: { kind: "oem_documentation", label: "Grounded in the cited documentation.", authorized: false } });
    expect(parts[3]).toMatchObject({ evidence: { preSeconds: 30, postSeconds: 30, rowCount: 4, freshness: "stale", source: "recorded" } });
    // The chat route carries no verification signal; the mapper must never claim one.
    expect(parts[4]).toEqual({ type: "visual_observation", observation: { fileId: "f9fdad9c", capturedAt: AT, provenance: "phone_photo", verified: false, previewUrl: fileUrl("f9fdad9c") } });
  });

  it("machine evidence with reason unavailable keeps the reason; live freshness is source live", () => {
    const [, , , me] = partsFromStream(stream({
      machineEvidence: { kind: "machine_evidence", assetId: "a", anchorAt: AT, pre: 1, post: 1, rowCount: 0, freshness: "live", reason: "unavailable" },
    }), LIVE);
    expect(me).toMatchObject({ type: "machine_evidence", evidence: { source: "live", reason: "unavailable" } });
  });

  it("a live directive (hazardNotice) renders a WARNING notice after the evidence and stays completed (#3841)", () => {
    const directive = { kind: "safety_notice" as const, trigger: ENERGIZED_ELECTRICAL_HAZARD };
    const live = stream({ hazardNotice: directive });
    const parts = partsFromStream(live, LIVE);
    expect(parts.map((p) => p.type)).toEqual(["text", "source", "evidence_basis", "safety_notice", "followups"]);
    expect(parts[3]).toMatchObject({ notice: { severity: "warning", trigger: ENERGIZED_ELECTRICAL_HAZARD, message: expect.stringContaining("NFPA 70E") } });
    expect(lifecycleFromStream(live)).toBe("completed");
  });

  it("a safety stop renders the stop notice with the trigger AND is a first-class safety_stop lifecycle, never completed (Codex #3839 F2)", () => {
    const safety = stream({ citations: [], basis: null, followups: [], safetyNotice: { kind: "safety_notice", trigger: "bypass the interlock" } });
    const parts = partsFromStream(safety, LIVE);
    expect(parts).toEqual([
      { type: "text", text: "Check the Modbus link first." },
      { type: "safety_notice", notice: { severity: "stop", message: expect.stringContaining("lockout/tagout"), trigger: "bypass the interlock" } },
    ]);
    expect(lifecycleFromStream(safety)).toBe("safety_stop");
    // Precedence: stopped and failed still outrank safety_stop; an ordinary answered status does not.
    expect(lifecycleFromStream(safety, { stopped: true })).toBe("stopped");
    expect(lifecycleFromStream({ ...safety, sawStatus: false })).toBe("failed");
    expect(lifecycleFromStream({ ...safety, status: "error" })).toBe("failed");
    expect(lifecycleFromStream(stream())).toBe("completed");
  });

  it("truncation (no terminal status frame) keeps the partial text and claims NOTHING else", () => {
    const parts = partsFromStream(stream({ sawStatus: false, status: "error" }), LIVE);
    expect(parts).toEqual([
      { type: "text", text: "Check the Modbus link first." },
      { type: "error", error: { code: "provider_failure", message: "The answer ended before it completed.", retryable: true } },
    ]);
    expect(lifecycleFromStream(stream({ sawStatus: false, status: "error" }))).toBe("failed");
  });

  it("truncation preserves an already-received Safety STOP but drops every evidence claim", () => {
    const parts = partsFromStream(stream({
      sawStatus: false,
      status: "error",
      content: "Partial stop text.",
      safetyNotice: { kind: "safety_notice", trigger: "bypass the interlock" },
      visualEvidence: visual,
    }), LIVE);
    expect(parts.map((part) => part.type)).toEqual(["text", "safety_notice", "error"]);
    expect(parts[1]).toMatchObject({
      type: "safety_notice",
      notice: { severity: "stop", trigger: "bypass the interlock" },
    });
    expect(parts.some((part) => part.type === "source" || part.type === "evidence_basis" || part.type === "visual_observation")).toBe(false);
  });

  it("a stopped turn is a stop, not an answer, even if the wire said answered", () => {
    const parts = partsFromStream(stream(), { stopped: true, ...LIVE });
    expect(parts.map((p) => p.type)).toEqual(["text", "error"]);
    expect(parts[1]).toMatchObject({ error: { code: "stopped", retryable: false } });
    expect(lifecycleFromStream(stream(), { stopped: true })).toBe("stopped");
  });

  it("a stopped turn preserves an already-received Safety STOP and no evidence claims", () => {
    const parts = partsFromStream(stream({
      safetyNotice: { kind: "safety_notice", trigger: "smoke coming" },
      visualEvidence: visual,
    }), { stopped: true, ...LIVE });
    expect(parts.map((part) => part.type)).toEqual(["text", "safety_notice", "error"]);
    expect(parts[1]).toMatchObject({ type: "safety_notice", notice: { severity: "stop", trigger: "smoke coming" } });
    expect(parts.some((part) => part.type === "source" || part.type === "evidence_basis" || part.type === "visual_observation")).toBe(false);
  });

  it("provider failure with no text yields only the error part", () => {
    expect(partsFromStream(stream({ content: "", citations: [], status: "error" }), LIVE)).toEqual([
      { type: "error", error: { code: "provider_failure", message: "The answer could not be completed.", retryable: true } },
    ]);
  });

  it("insufficient_evidence renders the abstention text and no sources", () => {
    const parts = partsFromStream(stream({ content: "I couldn't find that in the selected sources.", citations: [], basis: null, followups: [], status: "insufficient_evidence" }), LIVE);
    expect(parts).toEqual([{ type: "text", text: "I couldn't find that in the selected sources." }]);
    expect(lifecycleFromStream(stream({ status: "insufficient_evidence" }))).toBe("completed");
  });

  it("a verified-photo abstention renders the server sentence and observation card", () => {
    const copy = "I saw your photo, but I couldn't find anything about it in the selected sources.";
    const parts = partsFromStream(stream({
      content: "",
      citations: [],
      basis: null,
      followups: [],
      status: "insufficient_evidence",
      statusMessage: copy,
      visualEvidence: visual,
    }), LIVE);
    expect(parts).toEqual([
      { type: "text", text: copy },
      { type: "visual_observation", observation: { fileId: visual.fileId, capturedAt: AT, provenance: "phone_photo", verified: false, previewUrl: fileUrl(visual.fileId) } },
    ]);
  });

  it("an empty ordinary abstention keeps the generic fallback", () => {
    expect(partsFromStream(stream({
      content: "",
      citations: [],
      basis: null,
      followups: [],
      status: "insufficient_evidence",
    }), LIVE)).toEqual([{ type: "text", text: "I couldn't find that in the selected sources." }]);
  });
});

function row(over: Partial<PersistedTurn & { createdAt?: string }> = {}): PersistedTurn & { createdAt?: string } {
  return {
    id: "turn-1",
    question: "what should I check first",
    answerStatus: "answered",
    answerText: "Verify the Modbus link.",
    evidence: [citation],
    basis: "oem_documentation",
    createdAt: AT,
    ...over,
  };
}

describe("turnsFromPersisted — hydration mirrors the classic web notebook", () => {
  it("one row → a user turn and an assistant turn with sources and basis", () => {
    const [q, a] = turnsFromPersisted(row(), meta);
    expect(q).toMatchObject({ id: "turn-1-q", role: "user", parts: [{ type: "text", text: "what should I check first" }], lifecycle: "completed", threadId: "notebook-nb-1:thread-t-1" });
    expect(a.id).toBe("turn-1-a");
    expect(a.parts.map((p) => p.type)).toEqual(["text", "source", "evidence_basis"]);
    expect(a.lifecycle).toBe("completed");
    expect(a.createdAt).toBe(AT);
  });

  it("non-citation evidence entries split out as typed parts, never as dead chips", () => {
    const [, a] = turnsFromPersisted(row({
      evidence: [
        citation,
        { kind: "machine_evidence", assetId: "asset-uuid-1", anchorAt: AT, pre: 30, post: 30, rowCount: 2, freshness: "unknown" },
        { kind: "visual_observation", fileId: "f9fdad9c", capturedAt: AT, provenance: "phone_photo" },
        { kind: "safety_notice", trigger: "arc flash" },
        { kind: "identity_dispute", requestedAssetId: "x", boundAssetId: "asset-uuid-1", boundUnsPath: "enterprise.garage.cv_101" } as unknown as EvidenceCitation,
      ],
    }), meta);
    expect(a.parts.map((p) => p.type)).toEqual(["text", "identity_dispute", "source", "evidence_basis", "machine_evidence", "visual_observation", "safety_notice"]);
    // A disputed turn is rendered with the machine identity downgraded.
    expect(a.context).toMatchObject({ machineIdentity: "unconfirmed", evidenceAuthorization: "not_authorized" });
  });

  it("a persisted turn keeps the machine context it was SERVED with, not the current binding (Codex #3839 Spec P1)", () => {
    const served = { kind: "machine_evidence", assetId: "asset-uuid-1", anchorAt: AT, pre: 30, post: 30, rowCount: 2, freshness: "unknown" } as const;
    // Served with evidence for the notebook's current confirmed asset → confirmed.
    const [q1, a1] = turnsFromPersisted(row({ evidence: [citation, served] }), meta);
    expect(a1.context).toMatchObject({ machineId: "asset-uuid-1", machineIdentity: "confirmed", evidenceAuthorization: "authorized" });
    expect(q1.context).toMatchObject({ machineId: "asset-uuid-1" });
    // No machine evidence on the row → the turn was served without machine context; it is NOT
    // rewritten to the notebook's current asset.
    const [q2, a2] = turnsFromPersisted(row(), meta);
    expect(a2.context.machineIdentity).toBe("not_applicable");
    expect("machineId" in a2.context).toBe(false);
    expect(q2.context.machineIdentity).toBe("not_applicable");
    // Served against an asset the notebook has since been rebound away from → shown, never re-authorized.
    const [, a3] = turnsFromPersisted(row({ evidence: [citation, { ...served, assetId: "asset-uuid-OLD" }] }), meta);
    expect(a3.context).toMatchObject({ machineId: "asset-uuid-OLD", machineIdentity: "unconfirmed", evidenceAuthorization: "not_authorized" });
  });

  it("a persisted safety refusal hydrates as safety_stop, not completed (Codex #3839 F2)", () => {
    const [, a] = turnsFromPersisted(row({ evidence: [citation, { kind: "safety_notice", trigger: "arc flash" }] }), meta);
    expect(a.lifecycle).toBe("safety_stop");
    expect(a.parts.map((p) => p.type)).toEqual(["text", "source", "evidence_basis", "safety_notice"]);
    expect(a.parts[3]).toMatchObject({ notice: { severity: "stop", trigger: "arc flash" } });
    // A stopped or failed row with a stale safety marker keeps its stronger lifecycle.
    const [, stoppedTurn] = turnsFromPersisted(row({ answerStatus: "error", answerText: "Ver", evidence: [{ kind: "safety_notice", trigger: "x" }] }), meta);
    expect(stoppedTurn.lifecycle).toBe("stopped");
  });

  it("the energized-electrical DIRECTIVE is an answer, not a refusal: completed live AND after reload, rendered as a warning (Codex #3839 round 2 F1)", () => {
    // The server's own sentinel is the discriminator (chat/route.ts branches on the same constant).
    const directive = { kind: "safety_notice" as const, trigger: ENERGIZED_ELECTRICAL_HAZARD };
    expect(isTerminalSafetyNotice(directive)).toBe(false);
    expect(isTerminalSafetyNotice({ kind: "safety_notice", trigger: "bypass the interlock" })).toBe(true);
    // Persisted: a directive-framed answered row completes with its citations and a warning notice.
    const [, a] = turnsFromPersisted(row({ evidence: [directive, citation] }), meta);
    expect(a.lifecycle).toBe("completed");
    expect(a.parts.map((p) => p.type)).toEqual(["text", "source", "evidence_basis", "safety_notice"]);
    expect(a.parts[3]).toMatchObject({ notice: { severity: "warning", trigger: ENERGIZED_ELECTRICAL_HAZARD, message: expect.stringContaining("NFPA 70E") } });
    // Live: the directive turn streams an ordinary evidence frame (no safety frame), so it completes — identical lifecycle.
    expect(lifecycleFromStream(stream())).toBe("completed");
    // A rejected unsafe answer persists the directive AND the violation; the violation decides: safety_stop, both notices rendered.
    const [, rejected] = turnsFromPersisted(row({ evidence: [directive, { kind: "safety_notice", trigger: "unsafe_answer:live-work" }], basis: null }), meta);
    expect(rejected.lifecycle).toBe("safety_stop");
    expect(rejected.parts.filter((p) => p.type === "safety_notice")).toHaveLength(2);
    expect(hasTerminalSafetyStop([directive])).toBe(false);
    expect(hasTerminalSafetyStop([directive, { kind: "safety_notice", trigger: "x" }])).toBe(true);
  });

  it("source parts carry turn-scoped ids: two answers that both cite [1] never share a shell source (Codex #3839 F1)", () => {
    const [, a1] = turnsFromPersisted(row(), meta);
    const [, a2] = turnsFromPersisted(row({ id: "turn-2", evidence: [{ ...citation, docId: "doc-2", page: 12 }] }), meta);
    const src = (t: typeof a1) => t.parts.find((p) => p.type === "source");
    expect(src(a1)).toMatchObject({ source: { id: "turn-1-a:1", locator: "p. 47" } });
    expect(src(a2)).toMatchObject({ source: { id: "turn-2-a:1", locator: "p. 12" } });
  });

  it("STRM-2: error + text is a stopped turn — partial shown, nothing claimed", () => {
    const [, a] = turnsFromPersisted(row({ answerStatus: "error", answerText: "Verify the Mod" }), meta);
    expect(a.lifecycle).toBe("stopped");
    expect(a.parts).toEqual([
      { type: "text", text: "Verify the Mod" },
      { type: "error", error: { code: "stopped", message: "Stopped before the answer completed.", retryable: false } },
    ]);
  });

  it("STRM-2: error + null text is a provider failure", () => {
    const [, a] = turnsFromPersisted(row({ answerStatus: "error", answerText: null }), meta);
    expect(a.lifecycle).toBe("failed");
    expect(a.parts).toEqual([{ type: "error", error: { code: "provider_failure", message: "The answer could not be completed.", retryable: false } }]);
  });

  it("insufficient_evidence with null text renders the abstention copy", () => {
    const [, a] = turnsFromPersisted(row({ answerStatus: "insufficient_evidence", answerText: null, evidence: [], basis: null }), meta);
    expect(a.parts).toEqual([{ type: "text", text: "I couldn't find that in the selected sources." }]);
  });

  it("a persisted verified-photo abstention matches the live sentence and card", () => {
    const [, a] = turnsFromPersisted(row({
      answerStatus: "insufficient_evidence",
      answerText: null,
      evidence: [visual],
      basis: null,
    }), meta);
    expect(a.parts).toEqual([
      { type: "text", text: "I saw your photo, but I couldn't find anything about it in the selected sources." },
      { type: "visual_observation", observation: { fileId: visual.fileId, capturedAt: AT, provenance: "phone_photo", verified: false, previewUrl: fileUrl(visual.fileId) } },
    ]);
  });
});

// T2 (#4175): the identity_proposal entry chat/route.ts persists on EVERY
// reply path (answered AND abstained) — read straight off raw evidence[],
// same pattern as hasIdentityDispute, so reload renders the SAME confirm
// card the live turn offered.
describe("identityProposalOf / turnsFromPersisted — the confirm card on reload", () => {
  const proposal = { kind: "identity_proposal" as const, manufacturer: "SMC", model: "SS5Y3-DUW01302" };

  it("reads a persisted identity_proposal entry", () => {
    expect(identityProposalOf([citation, proposal])).toEqual({ manufacturer: "SMC", model: "SS5Y3-DUW01302" });
  });

  it("returns null when there is none, or the entry is malformed", () => {
    expect(identityProposalOf([citation])).toBeNull();
    expect(identityProposalOf([{ kind: "identity_proposal", manufacturer: "SMC" }])).toBeNull();
  });

  it("carries catalogNumber through when present", () => {
    expect(identityProposalOf([{ ...proposal, catalogNumber: "DUW01302" }]))
      .toEqual({ manufacturer: "SMC", model: "SS5Y3-DUW01302", catalogNumber: "DUW01302" });
  });

  it("renders the identity_proposal part on an ANSWERED turn", () => {
    // PersistedTurn.evidence's declared element union (notebook-chat-utils.ts,
    // guarded legacy presentation) doesn't enumerate identity_proposal, the
    // same way it doesn't enumerate identity_dispute — both are read straight
    // off the raw array at runtime regardless of the GET-side read type. Cast
    // at the fixture boundary only; `identityProposalOf`/`turnsFromPersisted`
    // themselves take `readonly unknown[]` / the real `PersistedTurn`.
    const [, a] = turnsFromPersisted(row({ evidence: [citation, proposal] as unknown as PersistedTurn["evidence"] }), meta);
    expect(a.parts).toContainEqual({ type: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" });
  });

  it("renders it on an ABSTAINED turn too — not gated by answered status (mirrors the live stream)", () => {
    const [, a] = turnsFromPersisted(
      row({
        answerStatus: "insufficient_evidence",
        answerText: null,
        evidence: [proposal] as unknown as PersistedTurn["evidence"],
        basis: null,
      }),
      meta,
    );
    expect(a.parts).toContainEqual({ type: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" });
  });

  it("does not render it when no proposal was persisted", () => {
    const [, a] = turnsFromPersisted(row(), meta);
    expect(a.parts.some((p) => p.type === "identity_proposal")).toBe(false);
  });

  // Light-review fix (PR #4195, "a stale proposal can overwrite a later
  // confirmed identity"): the card must settle itself against the
  // notebook's CURRENT confirmed identity (`meta.confirmedIdentity`), never
  // leaving a live Confirm on a card from before a later, different confirm.
  describe("priorOutcome — settled against the CURRENT confirmed identity", () => {
    const confirmedSame = { ...meta, confirmedIdentity: { manufacturer: "smc", model: "ss5y3 duw01302" } };
    const confirmedDifferent = { ...meta, confirmedIdentity: { manufacturer: "Rockwell Automation", model: "PowerFlex 525" } };

    it("flags 'confirmed' when the notebook's CURRENT identity matches (case/punctuation-insensitive)", () => {
      const [, a] = turnsFromPersisted(row({ evidence: [proposal] as unknown as PersistedTurn["evidence"] }), confirmedSame);
      expect(a.parts).toContainEqual({ type: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302", priorOutcome: "confirmed" });
    });

    it("flags 'superseded' when the notebook is NOW confirmed to a DIFFERENT identity", () => {
      const [, a] = turnsFromPersisted(row({ evidence: [proposal] as unknown as PersistedTurn["evidence"] }), confirmedDifferent);
      expect(a.parts).toContainEqual({ type: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302", priorOutcome: "superseded" });
    });

    it("carries no priorOutcome when the notebook has no confirmed identity yet (today's live card)", () => {
      const [, a] = turnsFromPersisted(row({ evidence: [proposal] as unknown as PersistedTurn["evidence"] }), meta);
      expect(a.parts).toContainEqual({ type: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" });
    });

    it("uses the CURRENT notebook identity (`meta`), never the turn's served/frozen context", () => {
      // The served machine_evidence context differs from the CURRENT confirmed
      // identity; priorOutcome must follow the CURRENT identity regardless.
      const served = { kind: "machine_evidence", assetId: "asset-uuid-OLD", anchorAt: AT, pre: 30, post: 30, rowCount: 2, freshness: "unknown" } as const;
      const [, a] = turnsFromPersisted(row({ evidence: [citation, served, proposal] as unknown as PersistedTurn["evidence"] }), confirmedDifferent);
      expect(a.parts).toContainEqual(expect.objectContaining({ type: "identity_proposal", priorOutcome: "superseded" }));
    });
  });
});

// Codex F6 (MEDIUM): the Hub never rendered manual_search_status at all.
// `withManualSearchStatus` overlays the GET route's freshly-computed
// `manualSearch` field onto the LAST assistant turn, the post-turn-refresh
// render path (the live in-flight gap stays the documented BLOCKED note).
describe("withManualSearchStatus — the post-refresh render path (#4189 F6)", () => {
  it("appends a manual_search_status part to the LAST assistant turn", () => {
    const thread = threadFromPersisted([row(), row({ id: "turn-2", createdAt: "2026-09-17T12:05:00.000Z" })], meta);
    const out = withManualSearchStatus(thread.turns, { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true });
    const lastAssistant = [...out].reverse().find((t) => t.role === "assistant")!;
    expect(lastAssistant.parts).toContainEqual({
      type: "manual_search_status",
      manufacturer: "SMC",
      model: "SS5Y3-DUW01302",
      running: true,
    });
    // Every OTHER turn (including the earlier assistant turn) is untouched.
    const otherAssistant = out.find((t) => t.role === "assistant" && t.id !== lastAssistant.id)!;
    expect(otherAssistant.parts.some((p) => p.type === "manual_search_status")).toBe(false);
  });

  it("includes the message once the search has settled (not running)", () => {
    const thread = threadFromPersisted([row()], meta);
    const out = withManualSearchStatus(thread.turns, {
      manufacturer: "SMC",
      model: "SS5Y3-DUW01302",
      running: false,
      message: "I looked for the official SMC SS5Y3-DUW01302 manual and couldn't find one.",
    });
    const lastAssistant = [...out].reverse().find((t) => t.role === "assistant")!;
    expect(lastAssistant.parts).toContainEqual({
      type: "manual_search_status",
      manufacturer: "SMC",
      model: "SS5Y3-DUW01302",
      running: false,
      message: "I looked for the official SMC SS5Y3-DUW01302 manual and couldn't find one.",
    });
  });

  it("returns the turns unchanged when there is no current status", () => {
    const thread = threadFromPersisted([row()], meta);
    const out = withManualSearchStatus(thread.turns, null);
    expect(out).toEqual(thread.turns);
  });

  it("returns the turns unchanged when there is no assistant turn at all", () => {
    const userOnly = [{ ...threadFromPersisted([row()], meta).turns[0]! }];
    const out = withManualSearchStatus(userOnly, { manufacturer: "SMC", model: "X", running: true });
    expect(out).toEqual(userOnly);
  });
});

describe("threadFromPersisted / citationIndex", () => {
  it("builds the thread with server-owned ids and the notebook's primary asset", () => {
    const thread = threadFromPersisted([row(), row({ id: "turn-2", createdAt: "2026-09-17T12:05:00.000Z" })], meta);
    expect(thread).toMatchObject({ id: "notebook-nb-1:thread-t-1", notebookId: "nb-1", projectId: "project-nb-1", primaryAssetId: "asset-uuid-1", tenantId: "tenant-1", mode: "ask", visibility: "workspace" });
    expect(thread.turns).toHaveLength(4);
    expect(thread.createdAt).toBe(AT);
    expect(thread.updatedAt).toBe("2026-09-17T12:05:00.000Z");
  });

  it("citationIndex is keyed per answer turn: persisted [1]s stay distinct and a live [1] replaces neither (Codex #3839 F1)", () => {
    const older = row(); // turn-1, doc-1 p.47
    const newer = row({ id: "turn-2", evidence: [{ ...citation, docId: "doc-2", page: 12 }] });
    const live = { ...citation, citationId: "1", docId: "doc-live", page: 48 };
    const index = citationIndex([older, newer], [live], LIVE.turnId);
    expect(index.get(sourceIdFor("turn-1-a", "1"))).toMatchObject({ docId: "doc-1", page: 47 });
    expect(index.get(sourceIdFor("turn-2-a", "1"))).toMatchObject({ docId: "doc-2", page: 12 });
    expect(index.get(sourceIdFor(LIVE.turnId, "1"))).toMatchObject({ docId: "doc-live", page: 48 });
    expect(index.has("1")).toBe(false); // no thread-wide key exists any more
    // Without a live turn id, live citations are not indexed at all (never under a guessed key).
    expect(citationIndex([older], [live]).size).toBe(1);
    expect(hasIdentityDispute([citation])).toBe(false);
  });
});

// #4025: the /v3 answer chip read "● oem_documentation" under a technician's
// own cited upload (desktop #4024 proof, Pixel prod v1.2.0 2026-10-04). The
// chip carries a caption for the basis, never the server's enum key, on the
// live stream and after a reload alike. A documentation basis names the
// notebook only when every citation is provably one of the notebook's own
// sources (Codex #4301 F1): the route sends `oem_documentation` for a
// shared-library answer too, and the label that told them apart never
// reaches this adapter.
describe("evidence basis chip — a caption, never the server key (#4025)", () => {
  const CAPTIONS = {
    general_reasoning: "General guidance — not grounded in this machine's documents.",
    workspace_evidence: "Grounded in workspace evidence.",
    identified_component: "Grounded in the identified component.",
    machine_history: "Grounded in recorded machine history — not live.",
    live_machine_evidence: "Grounded in live machine evidence.",
  } as const;
  const NOTEBOOK_SOURCES = "Grounded in this notebook's sources.";
  const CITED_DOCUMENTATION = "Grounded in the cited documentation.";
  const basisPart = (parts: readonly { type: string }[]) => parts.find((p) => p.type === "evidence_basis") as
    | { basis: { kind: string; label: string; authorized: boolean } }
    | undefined;
  /** The same answer, live (stream) and saved (persisted row), both projected with `notebookDocIds`. */
  function both(citations: EvidenceCitation[], notebookDocIds?: readonly string[], basis = "oem_documentation") {
    const live = basisPart(partsFromStream(stream({ basis, citations }), { ...LIVE, ...(notebookDocIds ? { notebookDocIds } : {}) }));
    const [, replayed] = turnsFromPersisted(row({ basis, evidence: citations }), { ...meta, ...(notebookDocIds ? { notebookDocIds } : {}) });
    return [live, basisPart(replayed.parts)];
  }
  const library: EvidenceCitation = { ...citation, citationId: "2", docId: "", sourceTitle: "Yaskawa GA500 manual", page: 889, sourceUrl: "https://example.com/ga500.pdf" };

  for (const [basis, caption] of Object.entries(CAPTIONS)) {
    it(`${basis}: live stream and persisted row both show "${caption}"`, () => {
      for (const part of both([citation], ["doc-1"], basis)) {
        expect(part?.basis.label).toBe(caption);
        expect(part?.basis.label).not.toBe(basis);
        expect(part?.basis.kind).toBe(basis);
      }
    });
  }

  it("oem_documentation citing only the notebook's own sources names the notebook, live and saved", () => {
    for (const part of both([citation], ["doc-1", "doc-9"])) {
      expect(part?.basis).toEqual({ kind: "oem_documentation", label: NOTEBOOK_SOURCES, authorized: false });
    }
  });

  it("a cited shared-library answer never claims the notebook's sources, live and saved (Codex #4301 F1)", () => {
    for (const part of both([library], ["doc-1"])) {
      expect(part?.basis).toEqual({ kind: "oem_documentation", label: CITED_DOCUMENTATION, authorized: false });
      expect(part?.basis.label).not.toMatch(/notebook/i);
    }
  });

  it("without the notebook's source ids the adapter cannot prove notebook provenance, so it does not claim it", () => {
    for (const part of both([citation])) expect(part?.basis.label).toBe(CITED_DOCUMENTATION);
  });

  it("a mixed answer (one notebook source, one library chunk) is not captioned as the notebook's", () => {
    for (const part of both([citation, library], ["doc-1"])) expect(part?.basis.label).toBe(CITED_DOCUMENTATION);
  });

  it("a cited doc that is not (or no longer) one of the notebook's sources is not captioned as the notebook's", () => {
    for (const part of both([citation], ["doc-2"])) expect(part?.basis.label).toBe(CITED_DOCUMENTATION);
  });

  it("an unknown basis is captioned as general guidance — never a stronger claim, never the raw value", () => {
    for (const part of both([citation], ["doc-1"], "verified_by_oem")) {
      expect(part?.basis).toEqual({ kind: "general_reasoning", label: CAPTIONS.general_reasoning, authorized: false });
    }
  });
});

describe("grounding_status — the turn's evidence status on reload (F004 M2, #4303)", () => {
  // The server writes this entry into evidence[]; the Hub's PersistedTurn type
  // predates it, so fixtures cast the way untyped JSON arrives.
  type Entry = PersistedTurn["evidence"][number];
  const gs = (outcome: string, fallback: Record<string, unknown> = { offered: false }, retrieval = "passages_found"): Entry => ({
    kind: "grounding_status",
    v: 1,
    outcome,
    retrieval: { status: retrieval, scopeDocIds: ["doc-1"], passageCount: 1, returnedDocIds: ["doc-1"], returnedSourceRefs: [] },
    citation: { status: "refused", linkedDocIds: [], linkedSourceRefs: [], unresolvedMarkerCount: 0 },
    manualCited: false,
    droppedRefCount: 0,
    fallback,
  }) as unknown as Entry;
  const statusPart = (parts: readonly { type: string }[]) => parts.find((p) => p.type === "grounding_status");

  it("an abstained turn carries the server's status and its offer", () => {
    const [, a] = turnsFromPersisted(
      row({ answerStatus: "insufficient_evidence", answerText: null, basis: null, evidence: [gs("abstained_no_passages", { offered: true }, "no_passages")] }),
      meta,
    );
    expect(statusPart(a.parts)).toEqual({
      type: "grounding_status",
      outcome: "abstained_no_passages",
      manualSearched: true,
      fallbackOffered: true,
      isGeneralFallback: false,
    });
  });

  it("a refusal never reads as 'General guidance': the legacy general_reasoning chip is dropped when the status says refused", () => {
    const [, a] = turnsFromPersisted(
      row({ answerStatus: "insufficient_evidence", answerText: "I can't answer that from the manual.", basis: "general_reasoning", evidence: [gs("refused_with_passages", { offered: true })] }),
      meta,
    );
    expect(a.parts.some((p) => p.type === "evidence_basis")).toBe(false);
    expect(statusPart(a.parts)).toMatchObject({ outcome: "refused_with_passages" });
  });

  it("control: an uncited answer keeps its basis chip AND gains the status line", () => {
    const [, a] = turnsFromPersisted(
      row({ answerText: "Check the supply.", basis: "general_reasoning", evidence: [gs("answered_uncited_with_passages", { offered: true })] }),
      meta,
    );
    expect(a.parts.some((p) => p.type === "evidence_basis")).toBe(true);
    expect(statusPart(a.parts)).toMatchObject({ outcome: "answered_uncited_with_passages" });
  });

  it("control: a legacy turn without the entry renders exactly as before", () => {
    const legacy = row({ answerStatus: "insufficient_evidence", answerText: null, evidence: [], basis: null });
    const [, a] = turnsFromPersisted(legacy, meta);
    expect(a.parts).toEqual([{ type: "text", text: "I couldn't find that in the selected sources." }]);
  });

  it("a malformed or future-version entry is ignored, never shown raw", () => {
    const [, a] = turnsFromPersisted(row({ evidence: [citation, { ...(gs("answered_citation_linked") as object), v: 2 } as unknown as Entry] }), meta);
    expect(statusPart(a.parts)).toBeUndefined();
    expect(a.parts.some((p) => p.type === "unknown")).toBe(false);
  });

  it("after reload, an offer a later turn already used shows no live action; the general answer is labelled", () => {
    const failed = row({ id: "11111111-1111-4111-8111-111111111111", answerStatus: "insufficient_evidence", answerText: null, basis: null, evidence: [gs("refused_with_passages", { offered: true })] });
    const general = row({
      id: "22222222-2222-4222-8222-222222222222",
      answerText: "Measure the incoming supply.",
      basis: "general_reasoning",
      evidence: [gs("answered_without_manual", { offered: false, of: "11111111-1111-4111-8111-111111111111" }, "not_attempted")],
    });
    const thread = threadFromPersisted([failed, general], meta);
    const parts = thread.turns.filter((t) => t.role === "assistant").map((t) => statusPart(t.parts));
    expect(parts[0]).toMatchObject({ fallbackOffered: true, fallbackUsed: true });
    expect(parts[1]).toMatchObject({ outcome: "answered_without_manual", isGeneralFallback: true, manualSearched: false });
    // Control: without the later turn the offer is still live.
    const alone = threadFromPersisted([failed], meta).turns.find((t) => t.role === "assistant")!;
    expect(statusPart(alone.parts)).not.toHaveProperty("fallbackUsed");
  });
});
