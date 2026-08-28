// Sensor v0 S3 — READ (contract §4.2): what a resolved QR / typed tag does
// INSIDE a notebook, plus the client half of the L1→L2 bind and the ported
// identity-chip state.
//
// Run: cd mira-mobile && bunx vitest run src/lib/__tests__/sensor-read

import { describe, it, expect, vi, beforeEach } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/client")>();
  return { ...real, request };
});

import { ApiError } from "../../api/client";
import { bindNotebookAsset, toNotebook, type Asset, type Notebook } from "../../api/resources";
import { readScan, type ReadDeps } from "../sensor-read";
import { assetCardState, resolvedAssetFromNotebook } from "../notebook-asset-card";

const ASSET = { id: "asset-1", tag: "CV-101", name: "Discharge Conveyor" } as unknown as Asset;
const NB_BOUND = { id: "nb-1", displayName: "Discharge Conveyor", asset: { entityId: "asset-1", selectedVia: "qr", confirmedBy: null, confirmedAt: null } } as unknown as Notebook;
const NB_OTHER = { id: "nb-other", displayName: "Discharge Conveyor" } as unknown as Notebook;

function deps(over: Partial<ReadDeps> = {}): ReadDeps {
  return {
    getAssetByTag: vi.fn(async () => ASSET),
    openAssetNotebook: vi.fn(async () => NB_OTHER),
    bindNotebookAsset: vi.fn(async () => NB_BOUND),
    ...over,
  };
}

beforeEach(() => request.mockReset());

describe("readScan — progressive context (§2.6)", () => {
  it("L1→L2: an unbound notebook is upgraded IN PLACE, never replaced", async () => {
    const d = deps();
    const out = await readScan("CV-101", { notebookId: "nb-1", boundEntityId: null }, d, "qr");
    expect(out).toMatchObject({ kind: "bound", asset: ASSET });
    expect(d.bindNotebookAsset).toHaveBeenCalledWith("nb-1", "asset-1", "qr");
    // The conversation stays where the technician is: no other notebook opened.
    expect(d.openAssetNotebook).not.toHaveBeenCalled();
  });

  it("records a typed tag as manual_entry on the bind", async () => {
    const d = deps();
    await readScan("CV-101", { notebookId: "nb-1", boundEntityId: null }, d, "manual_entry");
    expect(d.bindNotebookAsset).toHaveBeenCalledWith("nb-1", "asset-1", "manual_entry");
  });

  it("scanning this notebook's own sticker says so and changes nothing", async () => {
    const d = deps();
    const out = await readScan("CV-101", { notebookId: "nb-1", boundEntityId: "asset-1" }, d);
    expect(out).toMatchObject({ kind: "same_machine" });
    expect(d.bindNotebookAsset).not.toHaveBeenCalled();
    expect(d.openAssetNotebook).not.toHaveBeenCalled();
  });

  it("a bound notebook scanning a DIFFERENT machine opens that machine's notebook", async () => {
    const d = deps();
    const out = await readScan("CV-101", { notebookId: "nb-1", boundEntityId: "asset-9" }, d);
    expect(out).toEqual({ kind: "notebook", notebookId: "nb-other", assetId: "asset-1" });
    expect(d.bindNotebookAsset).not.toHaveBeenCalled();
  });

  it("409 asset_already_bound falls through to that machine's own notebook", async () => {
    const d = deps({
      bindNotebookAsset: vi.fn(async () => {
        throw new ApiError("client", 409, "Another notebook is already using that machine.");
      }),
    });
    const out = await readScan("CV-101", { notebookId: "nb-1", boundEntityId: null }, d);
    expect(out).toEqual({ kind: "notebook", notebookId: "nb-other", assetId: "asset-1" });
  });

  it("other bind failures keep the server's sentence and never navigate", async () => {
    const d = deps({
      bindNotebookAsset: vi.fn(async () => {
        throw new ApiError("client", 422, "That asset hasn't been approved yet, so it can't be used as a notebook's machine.");
      }),
    });
    const out = await readScan("CV-101", { notebookId: "nb-1", boundEntityId: null }, d);
    expect(out).toMatchObject({ kind: "failed", message: /hasn't been approved/ });
    expect(d.openAssetNotebook).not.toHaveBeenCalled();
  });

  it("an unknown tag is notfound; nothing is bound or opened", async () => {
    const d = deps({ getAssetByTag: vi.fn(async () => null) });
    const out = await readScan("CV-999", { notebookId: "nb-1", boundEntityId: null }, d);
    expect(out.kind).toBe("notfound");
    expect(d.bindNotebookAsset).not.toHaveBeenCalled();
  });
});

describe("toNotebook keeps the asset binding the server stores", () => {
  it("maps asset {entityId, selectedVia, confirmedBy, confirmedAt}", () => {
    const nb = toNotebook({
      id: "nb-1",
      displayName: "CV-101",
      nodeId: "n",
      asset: { entityId: "asset-1", selectedVia: "qr", confirmedBy: null, confirmedAt: null },
    });
    expect(nb.asset).toEqual({ entityId: "asset-1", selectedVia: "qr", confirmedBy: null, confirmedAt: null });
  });
  it("is null when unbound — never an empty-string binding", () => {
    expect(toNotebook({ id: "nb-1", displayName: "x", nodeId: "n" }).asset).toBeNull();
    expect(toNotebook({ id: "nb-1", displayName: "x", nodeId: "n", asset: null }).asset).toBeNull();
  });
});

describe("bindNotebookAsset — PUT …/asset with assetRef + selectedVia only", () => {
  it("sends which asset and how; never a confirmation", async () => {
    request.mockResolvedValue({
      status: 200,
      data: { ok: true, notebook: { id: "nb-1", displayName: "CV-101", nodeId: "n", asset: { entityId: "asset-1", selectedVia: "qr", confirmedBy: null, confirmedAt: null } } },
    });
    const nb = await bindNotebookAsset("nb-1", "asset-1", "qr");
    expect(request).toHaveBeenCalledWith("/api/equipment-notebooks/nb-1/asset/", {
      method: "PUT",
      json: { assetRef: "asset-1", selectedVia: "qr" },
    });
    const body = (request.mock.calls[0][1] as { json: Record<string, unknown> }).json;
    expect("confirmedBy" in body || "confirmedAt" in body).toBe(false);
    expect(nb.asset?.entityId).toBe("asset-1");
  });
});

describe("assetCardState (ported verbatim from mira-hub/src/lib/notebook-asset-card.ts)", () => {
  it("unbound: honest, still allowed to answer (document-only)", () => {
    const c = assetCardState(resolvedAssetFromNotebook({ displayName: "Notes", asset: null }));
    expect(c).toMatchObject({ tone: "unbound", headline: "No machine selected", canDiagnose: true });
  });
  it("selected via QR but unconfirmed renders amber, names the door", () => {
    const c = assetCardState(
      resolvedAssetFromNotebook({
        displayName: "Discharge Conveyor",
        asset: { entityId: "a", selectedVia: "qr", confirmedBy: null, confirmedAt: null },
      }),
    );
    expect(c.tone).toBe("unconfirmed");
    expect(c.headline).toBe("Discharge Conveyor");
    expect(c.detail).toMatch(/QR sticker — not yet confirmed/);
  });
  it("typed-in shows 'typed in'; confirmed renders green", () => {
    const typed = assetCardState(
      resolvedAssetFromNotebook({
        displayName: "CV-101",
        asset: { entityId: "a", selectedVia: "manual_entry", confirmedBy: null, confirmedAt: null },
      }),
    );
    expect(typed.detail).toMatch(/typed in/);
    const confirmed = assetCardState(
      resolvedAssetFromNotebook({
        displayName: "CV-101",
        asset: { entityId: "a", selectedVia: "qr", confirmedBy: "u1", confirmedAt: "2026-08-28T00:00:00Z" },
      }),
    );
    expect(confirmed).toMatchObject({ tone: "confirmed", headline: "CV-101" });
  });
});
