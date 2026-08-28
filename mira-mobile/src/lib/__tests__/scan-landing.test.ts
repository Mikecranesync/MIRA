/**
 * Scan landing (plan slice I5).
 *
 * The rule under test is not "does it navigate" but "is the technician ever
 * stranded". Someone standing at a running conveyor with a blank screen has
 * been failed twice: once by the error, and again by having nothing to tap.
 */
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { resolveScan, type ScanDeps } from "../scan-landing";
import type { Asset, Notebook } from "../../api/resources";

const ASSET = { id: "asset-1", tag: "CV-101", name: "Discharge Conveyor" } as unknown as Asset;
const NOTEBOOK = { id: "nb-1", displayName: "Discharge Conveyor" } as unknown as Notebook;

function deps(over: Partial<ScanDeps> = {}): ScanDeps {
  return {
    getAssetByTag: vi.fn(async () => ASSET),
    openAssetNotebook: vi.fn(async () => NOTEBOOK),
    ...over,
  };
}

describe("resolveScan", () => {
  it("opens the machine's notebook — the point of scanning", async () => {
    const d = deps();
    const out = await resolveScan("CV-101", d);
    expect(out).toEqual({ kind: "notebook", notebookId: "nb-1", assetId: "asset-1" });
    expect(d.openAssetNotebook).toHaveBeenCalledWith("asset-1", "qr");
  });

  it("records the scan as a QR selection, never as a confirmation", async () => {
    const d = deps();
    await resolveScan("CV-101", d);
    // A sticker proves which label was scanned, not which machine wears it.
    expect((d.openAssetNotebook as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1]).toBe("qr");
  });

  it("records a typed tag as manual_entry — still a selection, still not a confirmation", async () => {
    const d = deps();
    const out = await resolveScan("CV-101", d, "manual_entry");
    expect(out.kind).toBe("notebook");
    expect(d.openAssetNotebook).toHaveBeenCalledWith("asset-1", "manual_entry");
  });

  it("reports notfound for a tag that is not an asset here", async () => {
    const out = await resolveScan("CV-999", deps({ getAssetByTag: vi.fn(async () => null) }));
    expect(out.kind).toBe("notfound");
  });

  it("falls back to the ASSET when only the notebook step fails", async () => {
    const out = await resolveScan(
      "CV-101",
      deps({ openAssetNotebook: vi.fn(async () => { throw new ApiError("server", 500, "boom"); }) }),
    );
    // Not "failed": the scan did resolve a machine, and throwing that away
    // would leave the technician with nothing.
    expect(out).toMatchObject({ kind: "asset_only", assetId: "asset-1" });
  });

  it("prefers the server's explanation over a generic one", async () => {
    const out = await resolveScan(
      "CV-101",
      deps({
        openAssetNotebook: vi.fn(async () => {
          throw new ApiError("client", 422, "That asset hasn't been approved yet.");
        }),
      }),
    );
    expect(out).toMatchObject({ message: "That asset hasn't been approved yet." });
  });

  it("never shows a bare discriminator token to a technician", async () => {
    const out = await resolveScan(
      "CV-101",
      deps({
        openAssetNotebook: vi.fn(async () => {
          // The mobile error layer passes `data.error` through verbatim, so a
          // server returning only a code would otherwise print it on the phone.
          throw new ApiError("client", 404, "asset_not_found");
        }),
      }),
    );
    expect(out).toMatchObject({ kind: "asset_only" });
    expect("message" in out && out.message).not.toMatch(/^[a-z0-9]+(_[a-z0-9]+)+$/);
  });

  it("treats a lookup failure as failed, with a message", async () => {
    const out = await resolveScan(
      "CV-101",
      deps({ getAssetByTag: vi.fn(async () => { throw new ApiError("network", 0, ""); }) }),
    );
    expect(out.kind).toBe("failed");
    expect("message" in out && out.message.length).toBeGreaterThan(0);
  });

  it("does not attempt a notebook when no asset resolved", async () => {
    const d = deps({ getAssetByTag: vi.fn(async () => null) });
    await resolveScan("CV-999", d);
    expect(d.openAssetNotebook).not.toHaveBeenCalled();
  });

  it("every outcome leaves somewhere to go", async () => {
    const cases: ScanDeps[] = [
      deps(),
      deps({ getAssetByTag: vi.fn(async () => null) }),
      deps({ openAssetNotebook: vi.fn(async () => { throw new ApiError("server", 500, "x"); }) }),
      deps({ getAssetByTag: vi.fn(async () => { throw new ApiError("network", 0, ""); }) }),
    ];
    for (const d of cases) {
      const out = await resolveScan("CV-101", d);
      const hasRoute = out.kind === "notebook" || out.kind === "asset_only";
      const hasMessage = out.kind === "notfound" || ("message" in out && Boolean(out.message));
      expect(hasRoute || hasMessage).toBe(true);
    }
  });
});
