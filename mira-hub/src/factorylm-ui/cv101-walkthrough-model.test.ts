import { describe, expect, it } from "vitest";
import { addNote, setNoteResolved, setStepPerformed } from "@/capabilities/work-packet/job-record";
import { CV101_WORKFLOWS, DEMO_PACKET_ID, finishPractice, newPractice, parsePractice, persistPractice, readPractice, practicePacket, practiceStatus, practiceView, storageKey, updatePracticeRecord } from "./cv101-walkthrough-model";

const AT = "2026-11-06T12:00:00.000Z";
const make = () => newPractice("viewer-a", AT, "demo-cv101-job-1");
function ready() {
  let p = make();
  const packet = practicePacket();
  for (let i = 0; i < packet.steps.length; i++) p = updatePracticeRecord(p, setStepPerformed(p.record, i, true, "Demo technician", AT, packet.steps[i].text.value), AT);
  return updatePracticeRecord(p, addNote(p.record, { id: "demo-note-1", kind: "issue", text: "Synthetic note: physical state remains unknown.", stepIndex: null, by: "Demo technician", at: AT }), AT);
}
describe("CV-101 practice proof boundary", () => {
  it("begins without inherited work, real identity or a provider work order", () => {
    const p = make(), v = practiceView(p);
    expect(p.record.packetId).toBe(DEMO_PACKET_ID);
    expect(v.machine.entityId).toBe("DEMO-CV101");
    expect(v.steps.every(s => !s.done)).toBe(true);
    expect(v.finished).toBeNull();
    expect(p.events.every(e => e.workOrderId === null)).toBe(true);
    expect(practicePacket().workOrder.synthetic).toBe(true);
  });
  it("retains ordered checkoff and correction history through existing reducer", () => {
    let p = ready();
    p = updatePracticeRecord(p, setStepPerformed(p.record, 0, false, "Demo technician", AT), AT);
    const v = practiceView(p);
    expect(v.steps[0].history.map(h => h.done)).toEqual([true, false]);
    expect(v.steps[0].done).toBe(false);
    expect(v.questions[0].text).toContain("physical state remains unknown");
    expect(v.openQuestions).toBe(1);
  });
  it("refuses finish without explicit steps and notes; finish retry is idempotent", () => {
    expect(() => finishPractice(make(), AT)).toThrow(/steps.*note/i);
    const p = finishPractice(ready(), AT);
    expect(practiceView(p).finished?.summary).toContain("Synthetic");
    expect(finishPractice(p, AT)).toBe(p);
    expect(() => updatePracticeRecord(p, p.record, AT)).toThrow(/finished/i);
    expect(practiceView(p).openQuestions).toBe(1);
  });
  it("replays the same completed demo in the same viewer scope", () => {
    const p = finishPractice(ready(), AT);
    expect(parsePractice(JSON.stringify(p), "viewer-a")).toEqual(p);
    expect(practiceView(parsePractice(JSON.stringify(p), "viewer-a")!)).toEqual(practiceView(p));
    expect(parsePractice(JSON.stringify(p), "viewer-b")).toBeNull();
    expect(storageKey("viewer-a")).not.toBe(storageKey("viewer-b"));
  });
  it.each(["{bad", "{}", "null", "x".repeat(120001)])("rejects corrupt or oversized saved data", raw => {
    expect(parsePractice(raw, "viewer-a")).toBeNull();
  });
  it("rejects mismatched identity, event gaps, invalid payloads and unsupported versions", () => {
    const p = ready();
    for (const mutate of [
      (x: typeof p) => { x.version = 99 as 1; },
      (x: typeof p) => { x.record.packetId = "real-packet"; },
      (x: typeof p) => { x.events[1].seq = 10; },
      (x: typeof p) => { x.events[0].payload = { ...x.events[0].payload, machine: { entityId: "real-asset", name: "CV-101" } } as typeof x.events[0]["payload"]; },
      (x: typeof p) => { x.events[1].payload = null as unknown as typeof x.events[1]["payload"]; },
    ]) {
      const x = structuredClone(p); mutate(x);
      expect(parsePractice(JSON.stringify(x), "viewer-a")).toBeNull();
    }
  });
  it("never advances pinned live acceptance when practice is completed", () => {
    const original = CV101_WORKFLOWS.map(w => w.live.status);
    expect(practiceStatus(4, make())).toBe("BLOCKED");
    expect(practiceStatus(4, finishPractice(ready(), AT))).toBe("PASS");
    expect(CV101_WORKFLOWS.map(w => w.live.status)).toEqual(original);
    expect(original).toEqual(["BLOCKED", "BLOCKED", "FAIL", "BLOCKED", "BLOCKED", "BLOCKED"]);
  });
  it("reports unavailable persistence instead of claiming a saved job", () => {
    const denied = () => { throw new Error("SecurityError"); };
    expect(persistPractice(denied, ready()).status).toBe("unavailable");
    expect(readPractice(denied, "viewer-a").status).toBe("unavailable");
    const quota = () => ({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } });
    expect(persistPractice(quota, ready()).status).toBe("unavailable");
  });
  it("distinguishes a missing record, corruption and a different viewer", () => {
    const values = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } });
    expect(readPractice(storage, "viewer-a").status).toBe("missing");
    expect(persistPractice(storage, finishPractice(ready(), AT)).status).toBe("saved");
    expect(readPractice(storage, "viewer-a").status).toBe("ready");
    expect(readPractice(storage, "viewer-b").status).toBe("missing");
    values.set(storageKey("viewer-a"), "{corrupt");
    expect(readPractice(storage, "viewer-a").status).toBe("invalid");
  });
  it("does not accept a fabricated finished event without explicit work", () => {
    const finished = finishPractice(ready(), AT), untouched = make();
    const last = structuredClone(finished.events.at(-1)!);
    last.seq = 2; last.id = `${untouched.jobId}-2`;
    untouched.events.push(last);
    expect(parsePractice(JSON.stringify(untouched), "viewer-a")).toBeNull();
  });
  it("rejects malformed resolution metadata before it reaches record rendering", () => {
    for (const patch of [{ resolved: "yes" }, { resolvedAt: { corrupt: true } }, { resolvedBy: 42 }, { resolved: true, resolvedBy: "Demo technician" }]) {
      const p = ready(); Object.assign(p.record.notes[0], patch);
      expect(parsePractice(JSON.stringify(p), "viewer-a")).toBeNull();
    }
  });
  it("requires saved note kind, chronology and resolution to agree with replay", () => {
    for (const patch of [{ resolved: true, resolvedBy: "Demo technician", resolvedAt: AT }, { kind: "finding" }, { at: "2026-11-06T12:01:00.000Z" }]) {
      const p = ready(); Object.assign(p.record.notes[0], patch);
      expect(parsePractice(JSON.stringify(p), "viewer-a")).toBeNull();
    }
  });
  it("round-trips a legitimate issue resolution with the same reviewer/time and zero open questions", () => {
    const p = ready(), at = "2026-11-06T12:01:00.000Z";
    const resolved = updatePracticeRecord(p, setNoteResolved(p.record, "demo-note-1", true, "Demo technician", at), at);
    expect(parsePractice(JSON.stringify(resolved), "viewer-a")).toEqual(resolved);
    expect(practiceView(resolved).openQuestions).toBe(0);
    const corrupt = structuredClone(resolved); corrupt.record.notes[0].resolvedAt = AT;
    expect(parsePractice(JSON.stringify(corrupt), "viewer-a")).toBeNull();
  });
});
