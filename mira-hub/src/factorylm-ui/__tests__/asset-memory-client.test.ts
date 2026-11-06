import { describe, expect, it, vi } from "vitest";
import { apiAssetMemoryRecord, createAssetMemoryLoadGate, createFrozenSheetSend, withAssetMemorySelector, scopedAssetMemorySelection, type AssetMemorySelection } from "../living-sheet-client";
import { withLivingSheetRider } from "../hub-host-logic";
const selector = { seq: 3, snapshotId: `sha256:${"a".repeat(64)}`, candidate: null };
const selected: AssetMemorySelection = { notebookId: "nb-a", jobId: "job-a", selector };
describe("Asset Memory client ownership and immutable retry", () => {
  it("transports exact source-only selection only with its matching notebook/job rider", () => {
    const body = { message: "Synthetic question" };
    expect(withAssetMemorySelector(withLivingSheetRider(body, "nb-a", selected), "nb-a", selected)).toMatchObject({ livingSheetJobId: "job-a", livingSheetSelector: selector });
    expect(withAssetMemorySelector(withLivingSheetRider(body, "nb-b", selected), "nb-b", selected)).toEqual(body);
  });
  it("freezes decorated bytes and target once; retry bypasses new rider, selector, target and mutations", () => {
    const prepare = createFrozenSheetSend<{ message: string; livingSheetJobId?: string; livingSheetSelector?: typeof selector }>();
    const decorate = vi.fn(() => ({ message: "Question", livingSheetJobId: "job-a", livingSheetSelector: structuredClone(selector) }));
    const first = prepare({ message: "Question" }, { notebookId: "nb-a", threadId: "thread-a" }, decorate)!;
    const bytes = first.serialized; first.body.livingSheetSelector!.seq = 99;
    const retry = prepare(first.body, { notebookId: "nb-b", threadId: "thread-b" }, () => { throw new Error("retry must bypass today's rider"); })!;
    expect(retry.serialized).toBe(bytes); expect(JSON.parse(retry.serialized).livingSheetSelector.seq).toBe(3);
    expect(retry.target).toEqual({ notebookId: "nb-a", threadId: "thread-a" }); expect(decorate).toHaveBeenCalledTimes(1);
  });
  it("invalidates late sequence/job loads and prevents old cleanup clearing the new generation", () => {
    const gate = createAssetMemoryLoadGate(); const old = gate.begin("nb-a:job-a:3:saved");
    const pending = gate.begin("nb-a:job-a:3:pending"); expect(gate.current("nb-a:job-a:3:saved", old)).toBe(false);
    const newer = gate.begin("nb-a:job-a:4:saved"); expect(gate.invalidate("nb-a:job-a:3:pending", pending)).toBe(false);
    expect(gate.current("nb-a:job-a:4:saved", newer)).toBe(true);
    const other = gate.begin("nb-b:job-b:1:saved"); expect(gate.invalidate("nb-a:job-a:4:saved", newer)).toBe(false);
    expect(gate.current("nb-b:job-b:1:saved", other)).toBe(true);
  });
  it("ignores stale unmount callbacks and wrong-notebook publications", () => {
    const newer = { ...selected, selector: { ...selector, seq: 4 } };
    expect(scopedAssetMemorySelection(newer, null, { notebookId: "nb-a", jobId: "job-a", seq: 3 }, "nb-a")).toBe(newer);
    expect(scopedAssetMemorySelection(newer, selected, { notebookId: "nb-a", jobId: "job-a", seq: 3 }, "nb-b")).toBe(newer);
    expect(scopedAssetMemorySelection(newer, null, { notebookId: "nb-b" }, "nb-a")).toBe(newer);
    expect(scopedAssetMemorySelection(newer, null, { notebookId: "nb-a", jobId: "job-a", seq: 4 }, "nb-a")).toBeNull();
    expect(scopedAssetMemorySelection(selected, null, { notebookId: "nb-a", jobId: "job-a", seq: 4 }, "nb-a")).toBeNull();
  });
  it("requests enriched v2 explicitly and sends exact null rather than reselecting latest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ assetMemory: { selector } }))));
    try { await apiAssetMemoryRecord("nb-a", "job-a", selector); const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]), "http://test");
      expect(url.searchParams.get("format")).toBe("instruction-record-v2"); expect(url.searchParams.get("assetMemory")).toBe("1"); expect(JSON.parse(url.searchParams.get("memorySelector")!)).toEqual(selector);
    } finally { vi.unstubAllGlobals(); }
  });
});
