import { describe, expect, it } from "vitest";
import { deriveObservedState, type ObservationRow } from "../project";

const NOW = new Date("2026-06-15T18:00:00.000Z");
const ENTITY_ROW = (over: Partial<ObservationRow> & { id: string }): ObservationRow => ({
  factKey: "seal_leak",
  factValue: "present",
  observedAt: "2026-06-15T10:00:00.000Z",
  recordedAt: "2026-06-15T10:05:00.000Z",
  recordedBy: "tech-a",
  verificationMethod: "self_reported",
  uncertainty: "unverified",
  supersedesId: null,
  ...over,
});

describe("deriveObservedState (pure projection, A3/A4)", () => {
  it("newer_observed_wins_over_late_arriving_old_report", () => {
    const newer = ENTITY_ROW({ id: "a" });
    const lateOld = ENTITY_ROW({
      id: "b",
      factValue: "absent",
      observedAt: "2026-06-15T07:00:00.000Z",
      recordedAt: "2026-06-15T12:00:00.000Z",
    });
    const s = deriveObservedState([lateOld, newer], { now: NOW });
    const fact = s.facts.find((f) => f.factKey === "seal_leak")!;
    expect(fact.current.observationId).toBe("a");
    expect(fact.state).toBe("leak_reported");
    expect(fact.contested).toBe(false);
  });

  it("negated_old_report_kept_in_history", () => {
    const current = ENTITY_ROW({ id: "a", factValue: "present" });
    const oldNegated = ENTITY_ROW({
      id: "b",
      factValue: "absent",
      observedAt: "2026-06-14T08:00:00.000Z",
      recordedAt: "2026-06-14T08:02:00.000Z",
    });
    const s = deriveObservedState([current, oldNegated], { now: NOW });
    expect(s.facts[0]!.current.observationId).toBe("a");
    const hist = s.history.find((h) => h.id === "b");
    expect(hist).toBeDefined();
    expect(hist!.factValue).toBe("absent");
    expect(hist!.superseded).toBe(false);
  });

  it("correction_excludes_superseded_but_keeps_history", () => {
    // The original is observed LATER than its correction, so only the
    // supersession exclusion (not newest-first ordering) keeps it from winning.
    const original = ENTITY_ROW({
      id: "a",
      factValue: "present",
      observedAt: "2026-06-15T10:30:00.000Z",
      recordedAt: "2026-06-15T10:31:00.000Z",
    });
    const correction = ENTITY_ROW({
      id: "b",
      factValue: "absent",
      observedAt: "2026-06-15T10:00:00.000Z",
      recordedAt: "2026-06-15T11:00:00.000Z",
      supersedesId: "a",
    });
    const s = deriveObservedState([original, correction], { now: NOW });
    expect(s.facts).toHaveLength(1);
    expect(s.facts[0]!.current.observationId).toBe("b");
    expect(s.facts[0]!.state).toBe("seal_leak_not_observed");
    const kept = s.history.find((h) => h.id === "a");
    expect(kept?.superseded).toBe(true);
    expect(s.history).toHaveLength(2);
  });

  it("opposite_current_reports_are_contested", () => {
    const present = ENTITY_ROW({ id: "a", factValue: "present" });
    const absent = ENTITY_ROW({
      id: "b",
      factValue: "absent",
      observedAt: "2026-06-15T10:30:00.000Z",
      recordedAt: "2026-06-15T10:31:00.000Z",
    });
    const s = deriveObservedState([present, absent], { now: NOW });
    const fact = s.facts[0]!;
    expect(fact.state).toBe("contested");
    expect(fact.contested).toBe(true);
    expect(fact.conflicting.map((e) => e.observationId).sort()).toEqual(["a", "b"]);
  });

  // #5092 (Codex #5091 F1): a fault then a repair inside the contest window is a
  // sequence, not a disagreement. Neither row supersedes the other (the panel
  // sends no supersedesId), and both stay in history.
  it("leak_then_repair_within_window_is_repair_reported_not_contested", () => {
    const leak = ENTITY_ROW({ id: "a", factValue: "present", observedAt: "2026-06-15T09:10:00.000Z", recordedAt: "2026-06-15T09:11:00.000Z" });
    const repair = ENTITY_ROW({ id: "b", factValue: "repaired", observedAt: "2026-06-15T09:20:00.000Z", recordedAt: "2026-06-15T09:21:00.000Z", recordedBy: "tech-b" });
    const s = deriveObservedState([leak, repair], { now: NOW });
    const fact = s.facts[0]!;
    expect(fact.current.observationId).toBe("b");
    expect(fact.state).toBe("repair_reported");
    expect(fact.contested).toBe(false);
    expect(s.history.map((h) => h.id).sort()).toEqual(["a", "b"]);
    expect(s.health).toBe("not_established");
    expect(s.safeToOperate).toBe("not_established");
  });

  it("recurrence_after_repair_within_window_is_leak_reported_not_contested", () => {
    const repair = ENTITY_ROW({ id: "a", factValue: "repaired", observedAt: "2026-06-15T09:10:00.000Z" });
    const leakAgain = ENTITY_ROW({ id: "b", factValue: "present", observedAt: "2026-06-15T09:40:00.000Z", recordedAt: "2026-06-15T09:41:00.000Z" });
    const s = deriveObservedState([repair, leakAgain], { now: NOW });
    expect(s.facts[0]!.state).toBe("leak_reported");
    expect(s.facts[0]!.contested).toBe(false);
  });

  // #5091 Codex r2 F1: a repair is a boundary. Reports before it cannot contest
  // the state after it, but every row stays in history.
  it("absent_then_repair_then_leak_is_a_post_repair_recurrence_not_contested", () => {
    const absent = ENTITY_ROW({ id: "a", factValue: "absent", observedAt: "2026-06-15T09:00:00.000Z", recordedAt: "2026-06-15T09:01:00.000Z" });
    const repair = ENTITY_ROW({ id: "b", factValue: "repaired", observedAt: "2026-06-15T09:20:00.000Z", recordedAt: "2026-06-15T09:21:00.000Z" });
    const leak = ENTITY_ROW({ id: "c", factValue: "present", observedAt: "2026-06-15T09:30:00.000Z", recordedAt: "2026-06-15T09:31:00.000Z" });
    const s = deriveObservedState([absent, repair, leak], { now: NOW });
    expect(s.facts[0]!.state).toBe("leak_reported");
    expect(s.facts[0]!.contested).toBe(false);
    expect(s.history).toHaveLength(3);
  });

  it("leak_then_repair_then_not_seen_is_not_contested", () => {
    const leak = ENTITY_ROW({ id: "a", factValue: "present", observedAt: "2026-06-15T09:00:00.000Z", recordedAt: "2026-06-15T09:01:00.000Z" });
    const repair = ENTITY_ROW({ id: "b", factValue: "repaired", observedAt: "2026-06-15T09:20:00.000Z", recordedAt: "2026-06-15T09:21:00.000Z" });
    const clear = ENTITY_ROW({ id: "c", factValue: "absent", observedAt: "2026-06-15T09:30:00.000Z", recordedAt: "2026-06-15T09:31:00.000Z" });
    const s = deriveObservedState([leak, repair, clear], { now: NOW });
    expect(s.facts[0]!.state).toBe("seal_leak_not_observed");
    expect(s.facts[0]!.contested).toBe(false);
  });

  it("contradiction_after_the_same_repair_is_still_contested", () => {
    const repair = ENTITY_ROW({ id: "a", factValue: "repaired", observedAt: "2026-06-15T09:00:00.000Z" });
    const leak = ENTITY_ROW({ id: "b", factValue: "present", observedAt: "2026-06-15T09:20:00.000Z", recordedAt: "2026-06-15T09:21:00.000Z" });
    const clear = ENTITY_ROW({ id: "c", factValue: "absent", observedAt: "2026-06-15T09:30:00.000Z", recordedAt: "2026-06-15T09:31:00.000Z" });
    const s = deriveObservedState([repair, leak, clear], { now: NOW });
    expect(s.facts[0]!.state).toBe("contested");
  });

  it("repair_reported_never_sets_health_root_cause_or_safe", () => {
    const repaired = ENTITY_ROW({ id: "a", factValue: "repaired" });
    const s = deriveObservedState([repaired], { now: NOW });
    expect(s.facts[0]!.state).toBe("repair_reported");
    expect(s.rootCause).toBeNull();
    expect(s.safeToOperate).toBe("not_established");
    expect(s.health).toBe("not_established");
  });

  it("state_version_changes_only_with_contributing_rows", () => {
    const base = ENTITY_ROW({ id: "a", factValue: "present" });
    const v1 = deriveObservedState([base], { now: NOW }).stateVersion;

    // A stale, non-conflicting older row does not shape the state.
    const staleAgree = ENTITY_ROW({
      id: "c",
      factValue: "absent",
      observedAt: "2026-06-01T08:00:00.000Z",
      recordedAt: "2026-06-01T08:01:00.000Z",
    });
    const v2 = deriveObservedState([base, staleAgree], { now: NOW }).stateVersion;
    expect(v2).toBe(v1);

    // A newer row changes the current report, so the version changes.
    const newer = ENTITY_ROW({
      id: "d",
      factValue: "present",
      observedAt: "2026-06-15T11:00:00.000Z",
      recordedAt: "2026-06-15T11:01:00.000Z",
    });
    const v3 = deriveObservedState([base, newer], { now: NOW }).stateVersion;
    expect(v3).not.toBe(v1);
  });
});
