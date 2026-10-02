// Codex F4 (#4189): fetchManualSearchStatus is a thin transport wrapper
// reading the notebook-detail GET route's `manualSearch` field — the SAME
// route getNotebookDetail calls, via the shared request() seam, never a
// second endpoint or a bespoke fetch.
// Run: cd mira-mobile && bunx vitest run src/api/__tests__/manual-search-status

import { describe, it, expect, vi, beforeEach } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../client")>();
  return { ...real, request };
});

import { fetchManualSearchStatus } from "../manual-search-status";

beforeEach(() => { request.mockReset(); });

describe("fetchManualSearchStatus", () => {
  it("GETs the notebook detail route and relays manualSearch verbatim", async () => {
    request.mockResolvedValue({
      status: 200,
      data: { notebook: {}, manualSearch: { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true } },
      text: "",
    });
    const result = await fetchManualSearchStatus("nb-1");
    expect(request).toHaveBeenCalledWith("/api/equipment-notebooks/nb-1/");
    expect(result).toEqual({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true });
  });

  it("includes the threadId query param when given", async () => {
    request.mockResolvedValue({ status: 200, data: { manualSearch: null }, text: "" });
    await fetchManualSearchStatus("nb-1", { threadId: "thrd-1" });
    expect(request).toHaveBeenCalledWith("/api/equipment-notebooks/nb-1/?threadId=thrd-1");
  });

  it("Codex F12 — includes the search's generation (startedAt) through the real decoder, so the follower's budget keys on it", async () => {
    request.mockResolvedValue({
      status: 200,
      data: { manualSearch: { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-2" } },
      text: "",
    });
    const result = await fetchManualSearchStatus("nb-1");
    expect(result).toEqual({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-2" });
  });

  it("omits startedAt when the server didn't send one (an older Hub, or a generation-less record)", async () => {
    request.mockResolvedValue({
      status: 200,
      data: { manualSearch: { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true } },
      text: "",
    });
    const result = await fetchManualSearchStatus("nb-1");
    expect(result).not.toBeNull();
    expect("startedAt" in (result as object)).toBe(false);
  });

  it("includes message only when the server sent one", async () => {
    request.mockResolvedValue({
      status: 200,
      data: { manualSearch: { manufacturer: "SMC", model: "X", running: false, message: "Couldn't find one." } },
      text: "",
    });
    const result = await fetchManualSearchStatus("nb-1");
    expect(result).toEqual({ manufacturer: "SMC", model: "X", running: false, message: "Couldn't find one." });
  });

  it("returns null when the server has no manualSearch (older Hub, or nothing running)", async () => {
    request.mockResolvedValue({ status: 200, data: { manualSearch: null }, text: "" });
    expect(await fetchManualSearchStatus("nb-1")).toBeNull();
    request.mockResolvedValue({ status: 200, data: {}, text: "" });
    expect(await fetchManualSearchStatus("nb-1")).toBeNull();
  });

  it("returns null (never throws) on a non-200 or malformed response", async () => {
    request.mockResolvedValue({ status: 500, data: {}, text: "" });
    expect(await fetchManualSearchStatus("nb-1")).toBeNull();
    request.mockResolvedValue({ status: 200, data: { manualSearch: { manufacturer: "SMC" } }, text: "" });
    expect(await fetchManualSearchStatus("nb-1")).toBeNull();
  });
});
