import { describe, expect, it } from "vitest";
import { parseWorkOrderPrefill } from "./prefill";

// Anomaly→work-order deep link (master-plan T4): MachineMemoryCard's "Create
// work order" button links to /workorders/new?prefill_title=…&prefill_description=…
// &source_run_diff_id=…. This is the parsing half of that contract.
describe("parseWorkOrderPrefill", () => {
  it("reads all three prefill params when present", () => {
    const params = new URLSearchParams({
      prefill_title: "[CV-101] anomaly_A1_COMM_STALE on cv101.motor_current",
      prefill_description: "warning — next check: verify VFD comm cable",
      source_run_diff_id: "d1",
    });

    expect(parseWorkOrderPrefill(params)).toEqual({
      title: "[CV-101] anomaly_A1_COMM_STALE on cv101.motor_current",
      description: "warning — next check: verify VFD comm cable",
      sourceRunDiffId: "d1",
    });
  });

  it("defaults every field to an empty string when no params are present (normal 'New work order' nav)", () => {
    const params = new URLSearchParams();

    expect(parseWorkOrderPrefill(params)).toEqual({
      title: "",
      description: "",
      sourceRunDiffId: "",
    });
  });

  it("URL-decodes values automatically via URLSearchParams", () => {
    const params = new URLSearchParams(
      "prefill_title=%5BCV-101%5D%20fault&prefill_description=critical%20%E2%80%94%20next%20check%3A%20inspect&source_run_diff_id=abc-123",
    );

    expect(parseWorkOrderPrefill(params)).toEqual({
      title: "[CV-101] fault",
      description: "critical — next check: inspect",
      sourceRunDiffId: "abc-123",
    });
  });
});
