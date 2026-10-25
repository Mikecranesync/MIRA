import { describe, expect, it } from "vitest";
import {
  WORK_ORDER_STATUSES,
  normalizeWorkOrderStatus,
} from "@/capabilities/work-order-status";

// #4731: PATCH { status: "closed" } — what the phone's "Close & archive" button
// sends — reached the `::workorderstatus` cast with a value the enum doesn't
// have, so Postgres threw and the route answered 500. A status value is
// resolved here, before any query, so a bad one is a 400 and never a 500.
describe("normalizeWorkOrderStatus (#4731)", () => {
  it("maps 'closed' to the enum's terminal value 'completed'", () => {
    expect(normalizeWorkOrderStatus("closed")).toEqual({ ok: true, status: "completed" });
  });

  it("passes 'completed' through unchanged", () => {
    expect(normalizeWorkOrderStatus("completed")).toEqual({ ok: true, status: "completed" });
  });

  it("accepts every value the workorderstatus enum holds", () => {
    for (const s of WORK_ORDER_STATUSES) {
      expect(normalizeWorkOrderStatus(s)).toEqual({ ok: true, status: s });
    }
  });

  it("rejects an unknown value and names the allowed ones", () => {
    const r = normalizeWorkOrderStatus("archived");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.allowed).toEqual([...WORK_ORDER_STATUSES]);
      expect(r.error).toMatch(/archived/);
    }
  });

  it("rejects a non-string or empty status", () => {
    expect(normalizeWorkOrderStatus(42).ok).toBe(false);
    expect(normalizeWorkOrderStatus("").ok).toBe(false);
    expect(normalizeWorkOrderStatus(null).ok).toBe(false);
  });

  it("is case-sensitive like the enum (no silent 'Completed' coercion)", () => {
    expect(normalizeWorkOrderStatus("Completed").ok).toBe(false);
  });
});
