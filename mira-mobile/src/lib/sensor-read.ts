/**
 * Sensor READ — what a QR / typed tag does when it resolves INSIDE a notebook,
 * as a pure decision (contract §4.2, §2.6 progressive context).
 *
 * Two honest outcomes beyond the existing scan landing:
 *   • L1→L2 upgrade: this notebook has no machine yet → bind it in place
 *     (PUT …/asset) so the conversation the technician is already in gains
 *     the identity. Never a new notebook, never a lost thread.
 *   • Different machine: this notebook already IS a machine (or that machine
 *     already owns another notebook, 409) → the scanned machine's own notebook
 *     opens via the existing `resolveScan` → `openNotebookTransition` path.
 *
 * Every failure keeps a sentence — the same never-stranded rule as
 * `scan-landing.ts`.
 */
import { ApiError } from "../api/client";
import type { Asset, AssetSelectionMethod, Notebook } from "../api/resources";
import { messageFrom, resolveScan, type ScanDeps, type ScanOutcome } from "./scan-landing";

export type ReadDeps = ScanDeps & {
  bindNotebookAsset: (
    notebookId: string,
    assetRef: string,
    selectedVia: AssetSelectionMethod,
  ) => Promise<Notebook>;
};

export type ReadOutcome =
  /** This notebook was upgraded in place — refresh the identity chip. */
  | { kind: "bound"; notebook: Notebook; asset: Asset }
  /** The scanned sticker is THIS notebook's machine already. */
  | { kind: "same_machine"; asset: Asset }
  | ScanOutcome;

const FALLBACK_BIND = "Could not attach that machine to this notebook.";

export async function readScan(
  tag: string,
  ctx: { notebookId: string; boundEntityId: string | null },
  deps: ReadDeps,
  via: AssetSelectionMethod = "qr",
): Promise<ReadOutcome> {
  let asset: Asset | null;
  try {
    asset = await deps.getAssetByTag(tag);
  } catch (err) {
    return { kind: "failed", message: messageFrom(err, "Could not resolve the tag — check connectivity.") };
  }
  if (!asset?.id) return { kind: "notfound" };

  if (ctx.boundEntityId && ctx.boundEntityId === asset.id) return { kind: "same_machine", asset };

  if (!ctx.boundEntityId) {
    try {
      const notebook = await deps.bindNotebookAsset(ctx.notebookId, asset.id, via);
      return { kind: "bound", notebook, asset };
    } catch (err) {
      // Another notebook already owns that machine: go there instead of
      // failing — that notebook is where its history lives.
      const conflict = err instanceof ApiError && err.status === 409;
      if (!conflict) return { kind: "failed", message: messageFrom(err, FALLBACK_BIND) };
    }
  }

  return resolveScan(tag, deps, via);
}
