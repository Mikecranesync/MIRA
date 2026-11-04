/**
 * Pure unit tests for validate.ts. Every rejection case starts from a
 * complete, valid payload and changes only the field under test (the
 * discipline in .claude/rules/prove-the-test-fails.md) so a test can't pass
 * for the wrong reason.
 */
import { describe, expect, it } from "vitest";
import { validateAppendEventInput, validateJobSheetBody, validateStartJobInput } from "../validate";
import type { JobSheetBody } from "../types";

const NOW = new Date("2026-11-03T12:00:00.000Z");
const CLIENT_EVENT_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_REVISION_ID = "22222222-2222-4222-8222-222222222222";
const READING_ID = "33333333-3333-4333-8333-333333333333";

function validTemplate(over: Record<string, unknown> = {}): JobSheetBody {
  return {
    title: "PM — Pump 07",
    machineLabel: "Pump 07",
    component: null,
    jobType: "pm",
    estHours: 1.5,
    crewSize: 1,
    isolationPoints: null,
    cautions: null,
    returnToService: ["confirm pump runs"],
    items: [{ id: "i1", kind: "part", item: "Seal kit", spec: null, qty: 1, source: null, notes: null }],
    torques: [{ id: "t1", what: "Flange bolts", value: 35, unit: "ft-lb", pattern: "star", threadLocker: null, tool: "torque wrench", source: "manual p.12" }],
    steps: [{ id: "step-1", text: "Check seal", checkoff: "none", torqueRef: null, source: null }],
    author: "tech-1",
    notes: null,
    ...over,
  } as JobSheetBody;
}

function startJobBody(over: Record<string, unknown> = {}) {
  return {
    title: "PM — Pump 07",
    templateRevisionId: TEMPLATE_REVISION_ID,
    template: validTemplate(),
    clientEventId: CLIENT_EVENT_ID,
    occurredAt: NOW.toISOString(),
    ...over,
  };
}

function appendBody(over: Record<string, unknown> = {}) {
  return {
    clientEventId: CLIENT_EVENT_ID,
    baseSeq: 1,
    kind: "step_marked",
    payload: { stepId: "step-1", done: true, note: null },
    occurredAt: NOW.toISOString(),
    workOrderId: null,
    ...over,
  };
}

describe("validateJobSheetBody", () => {
  it("accepts a complete, valid body", () => {
    const r = validateJobSheetBody(validTemplate());
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown top-level field", () => {
    const r = validateJobSheetBody({ ...validTemplate(), extra: "nope" });
    expect(r).toMatchObject({ ok: false, error: "unknown_field" });
  });

  it("accepts a torque with a value but no source in a body (drafts may carry it; it shows as 'no source — unverified' and review refuses it)", () => {
    const r = validateJobSheetBody(
      validTemplate({ torques: [{ id: "t1", what: "Flange bolts", value: 35, unit: "ft-lb", pattern: null, threadLocker: null, tool: null, source: null }] }),
    );
    expect(r.ok).toBe(true);
  });

  it("control: a torque with a null value needs no source", () => {
    const r = validateJobSheetBody(
      validTemplate({ torques: [{ id: "t1", what: "Flange bolts", value: null, unit: null, pattern: null, threadLocker: null, tool: null, source: null }] }),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown item kind", () => {
    const r = validateJobSheetBody(validTemplate({ items: [{ id: "i1", kind: "nonsense", item: "x", spec: null, qty: null, source: null, notes: null }] }));
    expect(r).toMatchObject({ ok: false, error: "invalid_item_kind", field: "items[0].kind" });
  });

  it("rejects returnToService entries that are not strings", () => {
    const r = validateJobSheetBody(validTemplate({ returnToService: [123] }));
    expect(r).toMatchObject({ ok: false, error: "invalid_return_to_service", field: "returnToService" });
  });
});

describe("validateStartJobInput", () => {
  it("accepts a complete, valid input", () => {
    const r = validateStartJobInput(startJobBody(), { now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe("PM — Pump 07");
      expect(r.value.clientEventId).toBe(CLIENT_EVENT_ID);
    }
  });

  it("rejects a missing title", () => {
    const body = startJobBody();
    delete (body as Record<string, unknown>).title;
    const r = validateStartJobInput(body, { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "invalid_title", field: "title" });
  });

  it("rejects a non-UUID clientEventId", () => {
    const r = validateStartJobInput(startJobBody({ clientEventId: "not-a-uuid" }), { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "invalid_client_event_id", field: "clientEventId" });
  });

  it("rejects a non-UUID templateRevisionId (null is allowed, garbage is not)", () => {
    const r = validateStartJobInput(startJobBody({ templateRevisionId: "not-a-uuid" }), { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "invalid_template_revision_id", field: "templateRevisionId" });
  });

  it("control: a null templateRevisionId is accepted", () => {
    const r = validateStartJobInput(startJobBody({ templateRevisionId: null }), { now: NOW });
    expect(r.ok).toBe(true);
  });

  it("rejects an occurredAt more than 5 minutes in the future", () => {
    const future = new Date(NOW.getTime() + 6 * 60 * 1000).toISOString();
    const r = validateStartJobInput(startJobBody({ occurredAt: future }), { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "invalid_occurred_at", field: "occurredAt" });
  });

  it("control: occurredAt within the 5-minute skew is accepted", () => {
    const future = new Date(NOW.getTime() + 4 * 60 * 1000).toISOString();
    const r = validateStartJobInput(startJobBody({ occurredAt: future }), { now: NOW });
    expect(r.ok).toBe(true);
  });

  it("propagates a bad template's error (invalid template is invalid input)", () => {
    const r = validateStartJobInput(startJobBody({ template: { ...validTemplate(), extra: "nope" } }), { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "unknown_field" });
  });
});

describe("validateAppendEventInput", () => {
  it("accepts a complete, valid step_marked append", () => {
    const r = validateAppendEventInput(appendBody(), { now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.kind).toBe("step_marked");
  });

  it("rejects kind=job_started (job_started is only ever produced by startJob)", () => {
    const r = validateAppendEventInput(appendBody({ kind: "job_started", payload: {} }), { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "invalid_kind", field: "kind" });
  });

  it("rejects an unknown kind string", () => {
    const r = validateAppendEventInput(appendBody({ kind: "not_a_kind" }), { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "invalid_kind", field: "kind" });
  });

  it("rejects a negative baseSeq", () => {
    const r = validateAppendEventInput(appendBody({ baseSeq: -1 }), { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "invalid_base_seq", field: "baseSeq" });
  });

  it("control: baseSeq=0 is accepted (a fresh client that hasn't seen seq 1 yet)", () => {
    const r = validateAppendEventInput(appendBody({ baseSeq: 0 }), { now: NOW });
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown top-level field", () => {
    const r = validateAppendEventInput({ ...appendBody(), extra: "nope" }, { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "unknown_field" });
  });

  it("rejects a reading_recorded payload with no unit (unit is required, not nullable)", () => {
    const r = validateAppendEventInput(
      appendBody({
        kind: "reading_recorded",
        payload: { readingId: READING_ID, what: "Discharge pressure", value: 48, unit: "", source: { kind: "tech", ref: null } },
      }),
      { now: NOW },
    );
    expect(r).toMatchObject({ ok: false, error: "unit_required", field: "payload.unit" });
  });

  it("control: a complete reading_recorded payload is accepted", () => {
    const r = validateAppendEventInput(
      appendBody({
        kind: "reading_recorded",
        payload: { readingId: READING_ID, what: "Discharge pressure", value: 48, unit: "psi", source: { kind: "tech", ref: null } },
      }),
      { now: NOW },
    );
    expect(r.ok).toBe(true);
  });

  it("rejects an invalid workOrderId type", () => {
    const r = validateAppendEventInput(appendBody({ workOrderId: 12345 }), { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "invalid_work_order_id", field: "workOrderId" });
  });

  it("control: workOrderId may be omitted entirely (defaults to null)", () => {
    const body = appendBody();
    delete (body as Record<string, unknown>).workOrderId;
    const r = validateAppendEventInput(body, { now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.workOrderId).toBeNull();
  });

  it("rejects an occurredAt more than 5 minutes in the future", () => {
    const future = new Date(NOW.getTime() + 6 * 60 * 1000).toISOString();
    const r = validateAppendEventInput(appendBody({ occurredAt: future }), { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "invalid_occurred_at", field: "occurredAt" });
  });
});
