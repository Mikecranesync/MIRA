import { describe, expect, it } from "vitest";
import { buildWorkOrderDescription, WORK_ORDER_DESCRIPTION_MAX_CHARS } from "../work-order-description";
import { reduceSheet, type StoredEvent } from "../reduce";
import type { JobSheetBody, JobStartedPayload } from "../types";

const MARKER = "[MIRA:11111111-1111-1111-1111-111111111111]";

function template(over: Partial<JobSheetBody> = {}): JobSheetBody {
  return {
    title: "PM — Pump 07",
    machineLabel: "Pump 07",
    component: null,
    jobType: "pm",
    estHours: null,
    crewSize: null,
    isolationPoints: null,
    cautions: null,
    returnToService: [],
    items: [],
    torques: [],
    steps: [
      { id: "step-1", text: "Check seal", checkoff: "none", torqueRef: null, source: null },
      { id: "step-2", text: "Torque bolts", checkoff: "none", torqueRef: null, source: null },
    ],
    author: null,
    notes: null,
    ...over,
  };
}

function ev(partial: Partial<StoredEvent> & Pick<StoredEvent, "kind" | "payload" | "seq">): StoredEvent {
  return {
    id: `evt-${partial.seq}`,
    actorLabel: "Mike",
    actorUserId: "tech-1",
    occurredAt: "2026-11-04T12:00:00.000Z",
    recordedAt: "2026-11-04T12:00:00.000Z",
    workOrderId: null,
    ...partial,
  } as StoredEvent;
}

function started(over: Partial<JobStartedPayload> = {}): StoredEvent {
  const payload: JobStartedPayload = {
    title: "Light wheel bearing",
    machine: { entityId: "eq-1", name: "Pump 07" },
    templateRevisionId: null,
    template: template(),
    ...over,
  };
  return ev({ seq: 1, kind: "job_started", payload });
}

describe("buildWorkOrderDescription", () => {
  it("does NOT embed the marker — the write provider prepends it, exactly like WorkLogNote/renderWorkLogText", () => {
    const view = reduceSheet([started()], "job-1");
    const text = buildWorkOrderDescription(view);
    expect(text).not.toContain(MARKER);
    expect(text.split("\n")[0]).toBe('Work order requested from job sheet "Light wheel bearing" — asset: Pump 07.');
  });

  it("names the title and the asset", () => {
    const view = reduceSheet([started()], "job-1");
    const text = buildWorkOrderDescription(view);
    expect(text).toContain('"Light wheel bearing"');
    expect(text).toContain("Pump 07");
  });

  it("says 'unlinked asset' when the sheet's machine has no name", () => {
    const view = reduceSheet([started({ machine: { entityId: "eq-1", name: null } })], "job-1");
    const text = buildWorkOrderDescription(view);
    expect(text).toContain("unlinked asset");
  });

  it("lists every step with its done/not-done state and who/when", () => {
    const events = [
      started(),
      ev({ seq: 2, kind: "step_marked", payload: { stepId: "step-1", done: true, note: null } }),
    ];
    const view = reduceSheet(events, "job-1");
    const text = buildWorkOrderDescription(view);
    expect(text).toMatch(/\[done by Mike at 2026-11-04T12:00:00\.000Z\] "Check seal"/);
    expect(text).toContain('[not done] "Torque bolts"');
  });

  it("shows the current reading value with who, and labels a superseded value explicitly, never as current", () => {
    const events = [
      started(),
      ev({
        seq: 2,
        kind: "reading_recorded",
        payload: { readingId: "r1", what: "Bearing temp", value: 48, unit: "C", source: { kind: "tech", ref: null } },
      }),
      ev({
        seq: 3,
        kind: "reading_corrected",
        payload: { readingId: "r1", value: 4.8, unit: "C", reason: "typo", source: { kind: "tech", ref: null } },
      }),
    ];
    const view = reduceSheet(events, "job-1");
    const text = buildWorkOrderDescription(view);
    expect(text).toContain("Bearing temp: 4.8 C — Mike");
    expect(text).toContain("Replaced — not used (1 prior value)");
    // The superseded value (48) must never appear as the shown current value.
    expect(text).not.toMatch(/Bearing temp: 48 C/);
  });

  it("summarizes open items: unfinished steps and unanswered questions", () => {
    const events = [
      started(),
      ev({ seq: 2, kind: "note_added", payload: { noteId: "q1", text: "What torque spec?", noteKind: "question" } }),
    ];
    const view = reduceSheet(events, "job-1");
    const text = buildWorkOrderDescription(view);
    expect(text).toContain("Unfinished steps (2):");
    expect(text).toContain('"Check seal"');
    expect(text).toContain("Unanswered questions (1):");
    expect(text).toContain('"What torque spec?"');
  });

  it("says 'None.' under Open items when nothing is open", () => {
    const events = [
      started(),
      ev({ seq: 2, kind: "step_marked", payload: { stepId: "step-1", done: true, note: null } }),
      ev({ seq: 3, kind: "step_marked", payload: { stepId: "step-2", done: true, note: null } }),
    ];
    const view = reduceSheet(events, "job-1");
    const text = buildWorkOrderDescription(view);
    expect(text).toContain("Open items:\n  None.");
  });

  it("lists photo references by Hub file id, never a URL", () => {
    const events = [
      started(),
      ev({ seq: 2, kind: "photo_attached", payload: { photoId: "p1", fileId: "file-abc123", caption: "Leak at seal" } }),
    ];
    const view = reduceSheet(events, "job-1");
    const text = buildWorkOrderDescription(view);
    expect(text).toContain("file file-abc123");
    expect(text).toContain('"Leak at seal"');
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("never claims the asset is repaired, safe, or resolved", () => {
    const view = reduceSheet([started()], "job-1");
    const text = buildWorkOrderDescription(view).toLowerCase();
    expect(text).not.toContain("fixed");
    expect(text).not.toContain(" safe ");
    expect(text).not.toContain("repaired");
    // "resolved" is allowed only in the context of a question ("resolved"
    // literally doesn't appear in this fixture at all, but guard the word
    // generally since the renderer must never apply it to the asset).
    expect(text).not.toContain("resolved");
  });

  it("truncates with an explicit truncation line when the sheet is very large, and never embeds the marker", () => {
    const manySteps = Array.from({ length: 400 }, (_, i) => ({
      id: `step-${i}`,
      text: `Inspect fastener ${i} torque pattern thoroughly for signs of wear`,
      checkoff: "none" as const,
      torqueRef: null,
      source: null,
    }));
    const view = reduceSheet([started({ template: template({ steps: manySteps }) })], "job-1");
    const text = buildWorkOrderDescription(view);
    expect(text.length).toBeLessThanOrEqual(WORK_ORDER_DESCRIPTION_MAX_CHARS);
    expect(text).toContain("(truncated — full sheet in FactoryLM)");
    expect(text).not.toContain(MARKER);
  });
});
