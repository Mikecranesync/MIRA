import { describe, expect, it } from "vitest";
import type { StreamResult, PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import {
  basisKind,
  citationIndex,
  contextFor,
  hasIdentityDispute,
  lifecycleFromStream,
  partsFromStream,
  sourceFor,
  threadFromPersisted,
  turnsFromPersisted,
  type HubNotebookMeta,
} from "./to-interaction";

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

function stream(over: Partial<StreamResult> = {}): StreamResult {
  return {
    content: "Check the Modbus link first.",
    citations: [citation],
    status: "answered",
    basis: "oem_documentation",
    followups: ["What does P9.02 do"],
    machineEvidence: null,
    visualEvidence: null,
    safetyNotice: null,
    sawStatus: true,
    ...over,
  };
}

describe("sourceFor / basisKind", () => {
  it("maps a citation to a SourceReference without inventing a file", () => {
    expect(sourceFor(citation)).toEqual({ id: "1", title: "GS10 User Manual", kind: "oem_documentation", locator: "p. 47" });
    expect(sourceFor({ ...citation, page: null, fileId: "file-9" })).toMatchObject({ kind: "workspace_file", locator: "Set P9.01 to 2 for Modbus control." });
    expect(sourceFor({ ...citation, page: null, quote: null })).toMatchObject({ locator: "cited passage" });
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
    }));
    expect(parts.map((p) => p.type)).toEqual(["text", "source", "evidence_basis", "machine_evidence", "visual_observation", "followups"]);
    expect(parts[2]).toEqual({ type: "evidence_basis", basis: { kind: "oem_documentation", label: "oem_documentation", authorized: false } });
    expect(parts[3]).toMatchObject({ evidence: { preSeconds: 30, postSeconds: 30, rowCount: 4, freshness: "stale", source: "recorded" } });
    // The chat route carries no verification signal; the mapper must never claim one.
    expect(parts[4]).toEqual({ type: "visual_observation", observation: { fileId: "f9fdad9c", capturedAt: AT, provenance: "phone_photo", verified: false } });
  });

  it("machine evidence with reason unavailable keeps the reason; live freshness is source live", () => {
    const [, , , me] = partsFromStream(stream({
      machineEvidence: { kind: "machine_evidence", assetId: "a", anchorAt: AT, pre: 1, post: 1, rowCount: 0, freshness: "live", reason: "unavailable" },
    }));
    expect(me).toMatchObject({ type: "machine_evidence", evidence: { source: "live", reason: "unavailable" } });
  });

  it("a safety stop renders the stop notice with the trigger, still as an answered turn", () => {
    const parts = partsFromStream(stream({ citations: [], basis: null, followups: [], safetyNotice: { kind: "safety_notice", trigger: "bypass the interlock" } }));
    expect(parts).toEqual([
      { type: "text", text: "Check the Modbus link first." },
      { type: "safety_notice", notice: { severity: "stop", message: expect.stringContaining("lockout/tagout"), trigger: "bypass the interlock" } },
    ]);
  });

  it("truncation (no terminal status frame) keeps the partial text and claims NOTHING else", () => {
    const parts = partsFromStream(stream({ sawStatus: false, status: "error" }));
    expect(parts).toEqual([
      { type: "text", text: "Check the Modbus link first." },
      { type: "error", error: { code: "provider_failure", message: "The answer ended before it completed.", retryable: true } },
    ]);
    expect(lifecycleFromStream(stream({ sawStatus: false, status: "error" }))).toBe("failed");
  });

  it("a stopped turn is a stop, not an answer, even if the wire said answered", () => {
    const parts = partsFromStream(stream(), { stopped: true });
    expect(parts.map((p) => p.type)).toEqual(["text", "error"]);
    expect(parts[1]).toMatchObject({ error: { code: "stopped", retryable: false } });
    expect(lifecycleFromStream(stream(), { stopped: true })).toBe("stopped");
  });

  it("provider failure with no text yields only the error part", () => {
    expect(partsFromStream(stream({ content: "", citations: [], status: "error" }))).toEqual([
      { type: "error", error: { code: "provider_failure", message: "The answer could not be completed.", retryable: true } },
    ]);
  });

  it("insufficient_evidence renders the abstention text and no sources", () => {
    const parts = partsFromStream(stream({ content: "I couldn't find that in the selected sources.", citations: [], basis: null, followups: [], status: "insufficient_evidence" }));
    expect(parts).toEqual([{ type: "text", text: "I couldn't find that in the selected sources." }]);
    expect(lifecycleFromStream(stream({ status: "insufficient_evidence" }))).toBe("completed");
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
});

describe("threadFromPersisted / citationIndex", () => {
  it("builds the thread with server-owned ids and the notebook's primary asset", () => {
    const thread = threadFromPersisted([row(), row({ id: "turn-2", createdAt: "2026-09-17T12:05:00.000Z" })], meta);
    expect(thread).toMatchObject({ id: "notebook-nb-1:thread-t-1", notebookId: "nb-1", projectId: "project-nb-1", primaryAssetId: "asset-uuid-1", tenantId: "tenant-1", mode: "ask", visibility: "workspace" });
    expect(thread.turns).toHaveLength(4);
    expect(thread.createdAt).toBe(AT);
    expect(thread.updatedAt).toBe("2026-09-17T12:05:00.000Z");
  });

  it("citationIndex resolves a shell source id back to the real citation, live rows winning", () => {
    const live = { ...citation, citationId: "1", page: 48 };
    const index = citationIndex([row()], [live]);
    expect(index.get("1")?.page).toBe(48);
    expect(hasIdentityDispute([citation])).toBe(false);
  });
});
