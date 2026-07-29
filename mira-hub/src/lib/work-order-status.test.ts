import { describe, expect, it } from "vitest";
import { isWorkOrderInProgressStatus, WORK_ORDER_IN_PROGRESS_STATUS } from "@/lib/work-order-status";

describe("work order status helpers", () => {
  it("uses the canonical API value for in-progress work orders", () => {
    expect(WORK_ORDER_IN_PROGRESS_STATUS).toBe("in_progress");
  });

  it("treats legacy and canonical in-progress values as active work", () => {
    expect(isWorkOrderInProgressStatus("in_progress")).toBe(true);
    expect(isWorkOrderInProgressStatus("inprogress")).toBe(true);
    expect(isWorkOrderInProgressStatus("open")).toBe(false);
    expect(isWorkOrderInProgressStatus(undefined)).toBe(false);
  });
});
