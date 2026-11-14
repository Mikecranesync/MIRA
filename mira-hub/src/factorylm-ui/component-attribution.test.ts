import { describe, expect, it } from "vitest";
import type { PersistedTurn, StreamResult } from "@/components/equipment/notebook-chat-utils";
import { livePartsWhileRunning, partsFromStream, threadFromPersisted, turnsFromPersisted, type HubNotebookMeta } from "./to-interaction";

/**
 * #5504 Codex r2 F1: each answer shows the component it was asked under, from its own record
 * (the frame its stream sent, or the attribution saved with it), never from the header. The
 * header shows what the NEXT question is about and moves whenever the technician picks again.
 *
 * Run: npx vitest run src/factorylm-ui/component-attribution.test.ts
 */
const AT = "2026-11-14T04:00:00.000Z";
const meta: HubNotebookMeta = {
  notebookId: "nb-1",
  threadId: "notebook-nb-1:thread-t-1",
  title: "ZZ-BENCH CV-101",
  tenantId: "tenant-1",
  asset: null,
  identityConfirmed: true,
  capturedAt: AT,
};
const VFD_LABEL = "VFD1 · AutomationDirect GS11N-20P2";
const Q1_LABEL = "Q1 · Schneider Electric CA3KN22BD";
const attribution = (componentId: string, label: string) => ({ kind: "component_attribution", componentId, revision: 2, selectionVersion: 3, label });
const row = (id: string, answerText: string, evidence: unknown[]): PersistedTurn => ({
  id, question: `${id} question`, answerStatus: "answered", answerText, basis: null,
  evidence: evidence as PersistedTurn["evidence"],
});
const textParts = (parts: readonly { type: string; text?: string }[]) => parts.filter((p) => p.type === "text").map((p) => p.text);
const result = (over: Partial<StreamResult> = {}) => ({
  content: "The nominal input is 230 V.", citations: [], status: "answered", basis: null, followups: [],
  machineEvidence: null, visualEvidence: null, safetyNotice: null, hazardNotice: null, sawStatus: true, statusMessage: null, ...over,
}) as StreamResult & { statusMessage: string | null };

describe("a reloaded answer names its own component", () => {
  it("the saved attribution leads the answer", () => {
    const [, a] = turnsFromPersisted(row("t1", "The nominal input is 230 V.", [attribution("vfd", VFD_LABEL)]), meta);
    expect(textParts(a.parts)).toEqual([`About: ${VFD_LABEL}`, "The nominal input is 230 V."]);
  });

  it("two answers under different components keep their own labels in one thread, whatever is selected now", () => {
    const thread = threadFromPersisted(
      [row("t1", "VFD answer", [attribution("vfd", VFD_LABEL)]), row("t2", "Q1 answer", [attribution("q1", Q1_LABEL)])],
      meta,
    );
    const answers = thread.turns.filter((t) => t.role === "assistant").map((t) => textParts(t.parts)[0]);
    expect(answers).toEqual([`About: ${VFD_LABEL}`, `About: ${Q1_LABEL}`]);
  });

  it("a safety notice still leads; the label comes next", () => {
    const [, a] = turnsFromPersisted(row("t1", "Stop.", [attribution("vfd", VFD_LABEL), { kind: "safety_notice", trigger: "bypass the interlock" }]), meta);
    expect(a.parts[0].type).toBe("safety_notice");
    expect(a.parts[1]).toEqual({ type: "text", text: `About: ${VFD_LABEL}` });
  });

  it("control: a turn with no component shows no label (unchanged)", () => {
    const [, a] = turnsFromPersisted(row("t1", "The nominal input is 230 V.", []), meta);
    expect(textParts(a.parts)).toEqual(["The nominal input is 230 V."]);
  });
});

describe("a live answer names the component its own stream named", () => {
  it("live and reloaded answers render the same parts", () => {
    const live = partsFromStream(result(), { turnId: "live-1-a", componentLabel: VFD_LABEL });
    const [, reloaded] = turnsFromPersisted(row("t1", "The nominal input is 230 V.", [attribution("vfd", VFD_LABEL)]), meta);
    expect(live).toEqual(reloaded.parts);
  });

  it("text asked under a component waits until the stream has named the component", () => {
    const progress = { stage: "retrieving" } as unknown as Parameters<typeof livePartsWhileRunning>[1];
    expect(livePartsWhileRunning("The nominal", progress, { expected: true, label: null })).toEqual([{ type: "progress", stage: progress }]);
    expect(livePartsWhileRunning("The nominal", progress, { expected: true, label: VFD_LABEL })).toEqual([
      { type: "text", text: `About: ${VFD_LABEL}` },
      { type: "text", text: "The nominal" },
    ]);
  });

  it("control: a turn with no component streams its text at once, unlabelled", () => {
    expect(livePartsWhileRunning("The nominal", undefined, { expected: false, label: null })).toEqual([{ type: "text", text: "The nominal" }]);
    expect(livePartsWhileRunning("The nominal", undefined)).toEqual([{ type: "text", text: "The nominal" }]);
    expect(partsFromStream(result(), { turnId: "live-1-a" })).toEqual(partsFromStream(result(), { turnId: "live-1-a", componentLabel: null }));
  });
});
