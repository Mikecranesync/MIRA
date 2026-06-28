import { describe, expect, it } from "vitest";
import { successList, bulk, bulkItem, errorBody } from "@/lib/i3x/response";

describe("successList", () => {
  it("wraps an array in { success, result }", () => {
    expect(successList([1, 2])).toEqual({ success: true, result: [1, 2] });
  });
  it("emits result:[] (not null) for an empty list", () => {
    expect(successList([])).toEqual({ success: true, result: [] });
  });
});

describe("bulk / bulkItem", () => {
  it("a successful item carries elementId + result", () => {
    expect(bulkItem("e1", { v: 1 })).toEqual({ success: true, elementId: "e1", result: { v: 1 } });
  });
  it("a not-found item carries an ErrorDetail and success:false", () => {
    const item = bulkItem("e2", null, { title: "Not Found", status: 404, detail: "no such element" });
    expect(item.success).toBe(false);
    expect(item.elementId).toBe("e2");
    expect(item.responseDetail).toEqual({ title: "Not Found", status: 404, detail: "no such element" });
  });
  it("bulk wraps items in { success, results }", () => {
    const b = bulk([bulkItem("e1", { v: 1 })]);
    expect(b.success).toBe(true);
    expect(b.results).toHaveLength(1);
  });
});

describe("errorBody", () => {
  it("builds an i3X ErrorResponse", () => {
    expect(errorBody(401, "Unauthorized", "missing key")).toEqual({
      success: false,
      responseDetail: { title: "Unauthorized", status: 401, detail: "missing key" },
    });
  });
});
