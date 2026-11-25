// #5905 Codex r1 F4: a reloaded turn that no provider answered shows its fixed server card
// above the provider failure, as the live turn did, and is still a failed turn, not a stop.
//
// Run: npx vitest run src/capabilities/__tests__/advisory-card-reload.test.ts
import { describe, expect, it } from "vitest";
import type { PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import { turnsFromPersisted, type HubNotebookMeta } from "@/factorylm-ui/to-interaction";
import { OPEN_ENCLOSURE_CARD } from "@/capabilities/unsafe-practice-advisory";

const META: HubNotebookMeta = {
  notebookId: "nb-1",
  threadId: "notebook-nb-1:thread-t-1",
  title: "Conveyor CV-101",
  tenantId: "tenant-1",
  identityConfirmed: true,
  capturedAt: "2026-11-24T12:00:00.000Z",
};
function row(answerStatus: PersistedTurn["answerStatus"], answerText: string | null, evidence: unknown[]): PersistedTurn & { createdAt: string } {
  return { id: "t1", question: "can I leave the cabinet door open", answerStatus, answerText, evidence: evidence as PersistedTurn["evidence"], basis: null, createdAt: META.capturedAt };
}
const answer = (r: PersistedTurn & { createdAt: string }) => turnsFromPersisted(r, META).at(-1)!;
const CARD = { kind: "advisory_card", text: OPEN_ENCLOSURE_CARD };

describe("#5905 F4: the reloaded provider-failure turn keeps its card", () => {
  it("the card first, then the provider failure, and the turn is failed", () => {
    const a = answer(row("error", null, [CARD, { kind: "provider_failure", reason: "all_providers_failed" }]));
    expect(a.parts[0]).toEqual({ type: "text", text: OPEN_ENCLOSURE_CARD });
    expect(a.parts.filter((p) => p.type === "text")).toHaveLength(1);
    expect(a.parts.find((p) => p.type === "error")).toMatchObject({ type: "error", error: { code: "provider_failure" } });
    expect(a.lifecycle).toBe("failed");
  });

  it("without the seam's provider_failure marker too", () => {
    const a = answer(row("error", null, [CARD]));
    expect(a.parts[0]).toEqual({ type: "text", text: OPEN_ENCLOSURE_CARD });
    expect(a.lifecycle).toBe("failed");
  });

  it("control: a failure with no card shows no text, as before", () => {
    const a = answer(row("error", null, [{ kind: "provider_failure", reason: "all_providers_failed" }]));
    expect(a.parts.some((p) => p.type === "text")).toBe(false);
  });

  it("control: a stopped turn keeps its own partial text and stays stopped", () => {
    const a = answer(row("error", "Partial answ", [CARD]));
    expect(a.parts[0]).toEqual({ type: "text", text: "Partial answ" });
    expect(a.lifecycle).toBe("stopped");
  });

  it("control: a malformed marker is ignored", () => {
    const a = answer(row("error", null, [{ kind: "advisory_card", text: "" }, { kind: "advisory_card" }]));
    expect(a.parts.some((p) => p.type === "text")).toBe(false);
  });
});
