/**
 * What happens after a scan resolves — as a pure decision, so it can be tested
 * without a DOM. The screen renders this; it does not decide it.
 *
 * The rule the shapes encode: a technician standing at a running machine must
 * always have somewhere to go. A blank screen fails them twice — once with the
 * error, and again by leaving nothing to tap. So a failure that still knows the
 * asset offers the asset; only a genuinely unresolvable tag falls back to the
 * empty state.
 */
import { ApiError } from "../api/client";
import type { Asset, Notebook } from "../api/resources";

export type ScanOutcome =
  /** Resolved all the way: open the machine's notebook. The point of scanning. */
  | { kind: "notebook"; notebookId: string; assetId: string }
  /** The asset resolved but its notebook did not — keep the asset reachable. */
  | { kind: "asset_only"; assetId: string; message: string }
  /** The tag is not an asset in this workspace. */
  | { kind: "notfound" }
  /** The lookup itself failed (offline, server error). */
  | { kind: "failed"; message: string };

export type ScanDeps = {
  getAssetByTag: (tag: string) => Promise<Asset | null>;
  openAssetNotebook: (assetId: string, via: "qr") => Promise<Notebook>;
};

const FALLBACK_LOOKUP = "Could not resolve the tag — check connectivity.";
const FALLBACK_NOTEBOOK = "Could not open a notebook for this machine.";

/** A server message is preferred over ours: the server knows WHY. */
function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const m = err.userMessage;
    // Never surface a bare discriminator: the mobile error layer passes
    // `data.error` through verbatim, so a token would reach the technician as
    // the literal string "asset_not_found".
    if (m && m.trim() && !/^[a-z0-9]+(_[a-z0-9]+)+$/.test(m.trim())) return m;
  }
  return fallback;
}

export async function resolveScan(tag: string, deps: ScanDeps): Promise<ScanOutcome> {
  let asset: Asset | null;
  try {
    asset = await deps.getAssetByTag(tag);
  } catch (err) {
    return { kind: "failed", message: messageFrom(err, FALLBACK_LOOKUP) };
  }
  if (!asset?.id) return { kind: "notfound" };

  try {
    const nb = await deps.openAssetNotebook(asset.id, "qr");
    if (!nb?.id) return { kind: "asset_only", assetId: asset.id, message: FALLBACK_NOTEBOOK };
    return { kind: "notebook", notebookId: nb.id, assetId: asset.id };
  } catch (err) {
    return { kind: "asset_only", assetId: asset.id, message: messageFrom(err, FALLBACK_NOTEBOOK) };
  }
}

/**
 * The shell state a resolved notebook must produce — pure, so the transition is
 * testable without a DOM (the same reason `resolveScan` lives here).
 *
 * `assetsRoute` is the load-bearing field. TagLanding resolves its tag in a
 * MOUNT effect, so a `{name:"tag"}` route left armed after the hand-off is not
 * inert: tapping Assets remounts the landing, it re-resolves, re-POSTs a
 * notebook, and throws the technician straight back to chat. They can never
 * reach the asset list again without restarting the app. A scan route is
 * single-use — consuming it is part of the transition, not cleanup.
 */
export type NotebookTransition = {
  tab: "chat";
  notebookRoute: { name: "notebook"; id: string };
  assetsRoute: { name: "list" };
};

export function openNotebookTransition(notebookId: string): NotebookTransition {
  return {
    tab: "chat",
    notebookRoute: { name: "notebook", id: notebookId },
    assetsRoute: { name: "list" },
  };
}
