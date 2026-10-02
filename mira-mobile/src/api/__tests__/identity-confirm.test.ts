// T2 (#4175): confirmIdentityProposal is a thin transport wrapper over the
// shared request() seam — it never guesses manualReady; the server's own
// answer is relayed verbatim.
// Run: cd mira-mobile && bunx vitest run src/api/__tests__/identity-confirm

import { describe, it, expect, vi, beforeEach } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../client")>();
  return { ...real, request };
});

import { confirmIdentityProposal } from "../identity-confirm";

beforeEach(() => { request.mockReset(); });

describe("confirmIdentityProposal", () => {
  it("POSTs the proposal and relays the server's manualReady + message verbatim", async () => {
    request.mockResolvedValue({ status: 200, data: { ok: true, manualReady: true, message: "Confirmed." }, text: "" });

    const result = await confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "SS5Y3-DUW01302" });

    expect(request).toHaveBeenCalledWith("/api/equipment-notebooks/nb-1/identity/confirm/", {
      method: "POST",
      json: { manufacturer: "SMC", model: "SS5Y3-DUW01302" },
    });
    expect(result).toEqual({ manualReady: true, message: "Confirmed." });
  });

  it("includes catalogNumber only when the proposal carries one", async () => {
    request.mockResolvedValue({ status: 200, data: { ok: true, manualReady: false }, text: "" });

    await confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "SS5Y3", catalogNumber: "DUW01302" });

    expect(request).toHaveBeenCalledWith("/api/equipment-notebooks/nb-1/identity/confirm/", {
      method: "POST",
      json: { manufacturer: "SMC", model: "SS5Y3", catalogNumber: "DUW01302" },
    });
  });

  it("Codex round 2 F4 + round 3 F4 — decodes `searching` and `startedAt` through the real decoder (never scraped from message text)", async () => {
    request.mockResolvedValue({
      status: 200,
      data: { ok: true, manualReady: false, searching: true, startedAt: "gen-9", message: "Confirmed. I'll look for its manual." },
      text: "",
    });
    const result = await confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "X" });
    expect(result).toEqual({
      manualReady: false,
      message: "Confirmed. I'll look for its manual.",
      searching: true,
      startedAt: "gen-9",
    });
  });

  it("omits searching and startedAt when the server didn't send either", async () => {
    request.mockResolvedValue({ status: 200, data: { ok: true, manualReady: true, message: "Confirmed." }, text: "" });
    const result = await confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "X" });
    expect("searching" in result).toBe(false);
    expect("startedAt" in result).toBe(false);
  });

  it("never fabricates manualReady: false when the server omits it, and omits message when absent", async () => {
    request.mockResolvedValue({ status: 200, data: { ok: true }, text: "" });
    const result = await confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "X" });
    expect(result).toEqual({ manualReady: false });
    expect("message" in result).toBe(false);
  });

  it("throws on a non-200 or malformed response — never a silent false success", async () => {
    request.mockResolvedValue({ status: 404, data: { error: "notebook_not_found" }, text: "" });
    await expect(confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "X" })).rejects.toThrow();

    request.mockResolvedValue({ status: 200, data: { ok: false }, text: "" });
    await expect(confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "X" })).rejects.toThrow();
  });
});
