// T2 (#4175): confirmIdentityProposal is a thin transport wrapper over the
// shared request() seam — it never guesses manualReady; the server's own
// answer is relayed verbatim.
// Run: cd mira-mobile && bunx vitest run src/api/__tests__/identity-confirm

import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdentityAlreadyConfirmedError } from "@factorylm/interaction";

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
      acceptStatuses: [409],
    });
    expect(result).toEqual({ manualReady: true, message: "Confirmed." });
  });

  it("includes catalogNumber only when the proposal carries one", async () => {
    request.mockResolvedValue({ status: 200, data: { ok: true, manualReady: false }, text: "" });

    await confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "SS5Y3", catalogNumber: "DUW01302" });

    expect(request).toHaveBeenCalledWith("/api/equipment-notebooks/nb-1/identity/confirm/", {
      method: "POST",
      json: { manufacturer: "SMC", model: "SS5Y3", catalogNumber: "DUW01302" },
      acceptStatuses: [409],
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

  // Light-review fix (PR #4195): a stale proposal card confirmed after the
  // notebook has since settled on a DIFFERENT identity.
  describe("409 identity_already_confirmed — a typed, terminal refusal", () => {
    it("throws IdentityAlreadyConfirmedError naming the CURRENT confirmed machine", async () => {
      request.mockResolvedValue({
        status: 409,
        data: { error: "identity_already_confirmed", manufacturer: "Rockwell Automation", model: "PowerFlex 525" },
        text: "",
      });
      await expect(confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "X" }))
        .rejects.toThrow(IdentityAlreadyConfirmedError);
      request.mockResolvedValue({
        status: 409,
        data: { error: "identity_already_confirmed", manufacturer: "Rockwell Automation", model: "PowerFlex 525" },
        text: "",
      });
      await expect(confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "X" }))
        .rejects.toThrow("This machine is already confirmed as Rockwell Automation PowerFlex 525.");
    });

    it("passes acceptStatuses:[409] so the transport returns the body instead of throwing a generic ApiError", async () => {
      request.mockResolvedValue({
        status: 409,
        data: { error: "identity_already_confirmed", manufacturer: "Rockwell Automation", model: "PowerFlex 525" },
        text: "",
      });
      await expect(confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "X" })).rejects.toThrow();
      expect(request).toHaveBeenCalledWith("/api/equipment-notebooks/nb-1/identity/confirm/", expect.objectContaining({ acceptStatuses: [409] }));
    });

    it("falls back to a generic message when the 409 body omits manufacturer/model", async () => {
      request.mockResolvedValue({ status: 409, data: { error: "identity_already_confirmed" }, text: "" });
      await expect(confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "X" }))
        .rejects.toThrow("This machine is already confirmed.");
    });

    // Control: a 409 with a DIFFERENT error code is the ordinary generic
    // failure path, not the typed refusal — proves the check is keyed on the
    // error string, not merely on the status code.
    it("a 409 with a different error code stays the generic (non-typed) failure", async () => {
      request.mockResolvedValue({ status: 409, data: { error: "some_other_conflict" }, text: "" });
      let caught: unknown;
      try {
        await confirmIdentityProposal("nb-1", { manufacturer: "SMC", model: "X" });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught instanceof IdentityAlreadyConfirmedError).toBe(false);
    });
  });
});
