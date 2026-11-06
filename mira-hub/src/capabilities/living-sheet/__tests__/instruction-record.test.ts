import { describe, expect, it } from "vitest";
import { reduceSheet, type StoredEvent } from "../reduce";
import type { JobSheetBody, SheetEvent } from "../types";
import { instructionRecord } from "../instruction-record";

const template: JobSheetBody = {
  title: "Fictional inspection", machineLabel: "Test asset", component: null,
  jobType: "inspection", estHours: null, crewSize: null, isolationPoints: null,
  cautions: null, returnToService: [], items: [], author: null, notes: "rev/date unknown",
  torques: [{ id: "t1", what: "Fictional fixture", value: 4, unit: "test-unit", pattern: null, threadLocker: null, tool: null, source: "Example sheet" }],
  steps: [{ id: "s1", text: "Record test reading", checkoff: "measurement", torqueRef: null, source: null }],
};
function event(seq: number, e: SheetEvent): StoredEvent {
  return { ...e, seq, id: `event-${seq}`, actorUserId: "tech-id", actorLabel: "Test tech",
    occurredAt: "2026-11-06T01:00:00Z", recordedAt: "2026-11-06T01:00:01Z", workOrderId: null };
}
const events: StoredEvent[] = [
  event(1, { kind: "job_started", payload: { title: template.title, machine: { entityId: "asset-1", name: "Test asset" }, templateRevisionId: "rev-1", templateStatus: "reviewed", template } }),
  event(2, { kind: "step_marked", payload: { stepId: "s1", done: true, note: "Recorded" } }),
  event(3, { kind: "reading_recorded", payload: { readingId: "r1", what: "Gap", value: 2, unit: "test-unit", source: { kind: "manual", ref: "Example p.3" } } }),
  event(4, { kind: "reading_corrected", payload: { readingId: "r1", value: 3, unit: "test-unit", reason: "Read again" } }),
  event(5, { kind: "job_finished", payload: { summary: "Check later", openItemsAcknowledged: true } }),
];

describe("instruction-record v1", () => {
  it("preserves the exact human/print snapshot and lineage without inventing approval", () => {
    const view = reduceSheet(events, "job-1");
    const record = instructionRecord("notebook-1", view);
    expect(record).toMatchObject({ schemaVersion: 1, kind: "living_instruction_record", status: "draft",
      lineage: { notebookId: "notebook-1", jobId: "job-1", seq: 5, templateRevisionId: "rev-1", legacyTemplateStatus: "reviewed" },
      review: { technicianCloseout: "not_recorded", reusableAcceptance: "not_recorded", safetyClearance: "not_granted" } });
    expect(record.snapshot).toEqual(view);
    expect(record.steps[0]).toMatchObject({ id: "s1", state: "proposed", verification: { state: "unreviewed", reviews: [] } });
    expect(record.snapshot.steps[0]!.done).toBe(true);
    expect(record.asset.unsPath).toEqual({ value: null, state: "unknown" });
    record.snapshot.steps[0]!.text = "Changed export";
    expect(view.steps[0]!.text).toBe("Record test reading");
  });

  it("keeps corrected observations separate from specifications and their old sources", () => {
    const record = instructionRecord("nb", reduceSheet(events, "job-1"));
    expect(record.facts.find(f => f.id === "reading:r1")).toMatchObject({
      origin: "technician_observation", value: 3, unit: "test-unit",
      sources: [{ kind: "sheet_event", eventId: "event-4", by: "Test tech", at: "2026-11-06T01:00:00Z" }],
      verification: { state: "unreviewed", reviews: [] },
    });
    expect(record.snapshot.readings[0]!.history).toHaveLength(2);
    expect(record.facts.find(f => f.id === "torque:t1")!.origin).toBe("legacy_template");
    expect(record.facts.find(f => f.id === "component")!.state).toBe("unknown");
  });

  it("replays interrupted exports deterministically and distinguishes later snapshots/jobs", () => {
    const before = instructionRecord("nb", reduceSheet(events.slice(0, 3), "job-1"));
    const same = instructionRecord("nb", JSON.parse(JSON.stringify(before.snapshot)));
    const after = instructionRecord("nb", reduceSheet(events, "job-1"));
    expect(same).toEqual(before);
    expect(after.snapshotId).not.toBe(before.snapshotId);
    expect(before.snapshot.finished).toBeNull();
    expect(before.facts.find(f => f.id === "reading:r1")!.value).toBe(2);
    const fresh = instructionRecord("nb", reduceSheet([events[0]!], "job-2"));
    expect(fresh.snapshot.steps[0]!.done).toBe(false);
    expect(fresh.snapshotId).not.toBe(before.snapshotId);
  });

  it("binds exact content/history while ignoring JSON object key order", () => {
    const view = reduceSheet(events, "job-1");
    const first = instructionRecord("nb", view);
    const reordered = { ...view, machine: { name: view.machine.name, entityId: view.machine.entityId } };
    expect(instructionRecord("nb", reordered).snapshotId).toBe(first.snapshotId);
    view.steps[0]!.text += " corrected";
    expect(instructionRecord("nb", view).snapshotId).not.toBe(first.snapshotId);
    expect(instructionRecord("other-nb", view).snapshotId).not.toBe(first.snapshotId);
  });
});
