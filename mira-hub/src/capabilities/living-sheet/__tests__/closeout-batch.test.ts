import { describe, expect, it } from "vitest";
import { applyEdit } from "@/capabilities/work-packet/edits";
import type { PacketEdit, WorkPacket } from "@/capabilities/work-packet/types";
import { applyCloseoutDecisions, qcTargets, validatePacketIntake } from "../packet-intake";
import { field, packetFixture } from "./packet-fixture";

describe("large illustrated-packet closeout", () => {
  it("clones the full packet once, preserving sequential decisions, copies and original input", () => {
    const nb = "11111111-1111-4111-8111-111111111111";
    const small = packetFixture(nb);
    small.steps = Array.from({ length: 410 }, (_, i) => ({ section: "Fictional inspection", topic: "other", text: field(`Inspection ${i}`) }));
    small.jha = [{ task: field("Inspection"), hazard: { ...field("Stop the fixture"), copyOf: "safety.cautions[0]" }, controls: field(null) }];
    small.restoration = [{ ...field("Stop the fixture"), copyOf: "safety.cautions[0]" }];
    small.approval.supervisor = { state: "approved", by: "Imported claim", at: "2026-11-01" };
    const packet = Object.assign(structuredClone(small), { opaqueEvidence: "X".repeat(6_300_000) });
    const request = { clientRequestId: "22222222-2222-4222-8222-222222222222", packet, record: null };
    expect(validatePacketIntake(request, nb).ok).toBe(true);
    const decisions: PacketEdit[] = qcTargets(packet).map(({ path }) => path === "scope[0]" ? { path, action: "settle", value: "Corrected inspection", source: "Synthetic correction note" } :
      path === "safety.cautions[0]" ? { path, action: "strike" } : path === "equipment.serial" ? { path, action: "mark_unknown" } : { path, action: "confirm" });
    expect(decisions.length).toBeGreaterThan(400);
    let expected: WorkPacket = structuredClone(small);
    expected.approval.technicianReview.state = "draft";
    expected.approval.supervisor = { state: "pending", by: null, at: null };
    for (const d of decisions) expected = applyEdit(expected, d, "authenticated-tech", "2026-11-06");
    // Count without a spy retaining hundreds of 6MB argument objects.
    const stringify = JSON.stringify; let fullCopies = 0;
    JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
      const v = args[0];
      if (v && typeof v === "object" && "packetId" in v && "steps" in v) fullCopies++;
      return stringify(...args);
    }) as typeof JSON.stringify;
    const started = performance.now();
    let next: WorkPacket;
    try {
      next = applyCloseoutDecisions(packet, decisions, "authenticated-tech", "2026-11-06");
      console.log(JSON.stringify({ fixture: "fictional-6.3MB", targets: decisions.length, elapsedMs: performance.now() - started, fullPacketSerializations: fullCopies }));
      expect(fullCopies).toBe(1);
    } finally { JSON.stringify = stringify; }
    const { opaqueEvidence, ...content } = next! as WorkPacket & { opaqueEvidence: string };
    expect(opaqueEvidence).toBe(packet.opaqueEvidence);
    expect(content).toEqual(expected);
    expect(packet).toEqual({ ...small, opaqueEvidence: packet.opaqueEvidence });
  }, 20_000);
  it("leaves the original input untouched when a later decision fails", () => {
    const packet = packetFixture("notebook"); const original = structuredClone(packet);
    const decisions: PacketEdit[] = qcTargets(packet).map(({ path }) => ({ path, action: "confirm" }));
    decisions[decisions.length - 1] = { path: decisions.at(-1)!.path, action: "settle", value: "Invalid without source" };
    expect(() => applyCloseoutDecisions(packet, decisions, "tech", "2026-11-06")).toThrow();
    expect(packet).toEqual(original);
  });
});
