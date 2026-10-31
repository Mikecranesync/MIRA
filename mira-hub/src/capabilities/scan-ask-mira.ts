/**
 * Scan-page Ask MIRA — the sellable path after a QR lands on /m/:tag
 * (or /machine/:tag).
 *
 *   scanned asset → POST /api/assets/:id/notebook → /equipment/:notebookId
 *   → Hub equipment-notebook chat → manual-rag → citation SSE
 *
 * Must never route to pipeline/bots, ask_api, Open WebUI, or /api/hub/ask.
 * The Hub already owns opening THE notebook for an asset
 * (`POST /api/assets/[id]/notebook`); this only names that door and the
 * chat page it hands off to.
 */

export const SCAN_ASK_FALLBACK = "Couldn't open the notebook for this machine.";

/** How a scan-page Ask MIRA chose the machine — a sticker, not a confirmation. */
export const SCAN_ASK_SELECTED_VIA = "qr" as const;

export const FORBIDDEN_ASK_ROUTE_FRAGMENTS = [
  "/api/hub/ask",
  "ask_api",
  "t.me/",
  "telegram",
  "openwebui",
  "open-webui",
  "mira-pipeline",
  "/v1/chat/completions",
] as const;

export function notebookOpenPath(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/notebook/`;
}

export function notebookChatHref(notebookId: string): string {
  return `/equipment/${encodeURIComponent(notebookId)}`;
}

export function isForbiddenAskRoute(href: string): boolean {
  const lower = href.toLowerCase();
  return FORBIDDEN_ASK_ROUTE_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

export type OpenScannedAskMiraResult =
  | { ok: true; href: string }
  | { ok: false; message: string };

export type OpenScannedAskMiraDeps = {
  post: (
    path: string,
    body: { selectedVia: typeof SCAN_ASK_SELECTED_VIA },
  ) => Promise<{ ok: boolean; body: unknown }>;
  apiBase?: string;
};

/**
 * Open THE notebook for the scanned asset and return the Hub equipment
 * notebook chat href. Pure of fetch/window so the scan page and the tests
 * share one decision.
 */
export async function openScannedAssetAskMira(
  assetId: string,
  deps: OpenScannedAskMiraDeps,
): Promise<OpenScannedAskMiraResult> {
  const id = assetId.trim();
  if (!id) return { ok: false, message: SCAN_ASK_FALLBACK };

  let res: { ok: boolean; body: unknown };
  try {
    res = await deps.post(notebookOpenPath(id), { selectedVia: SCAN_ASK_SELECTED_VIA });
  } catch {
    return { ok: false, message: SCAN_ASK_FALLBACK };
  }

  const body = (res.body ?? {}) as { notebook?: { id?: unknown }; error?: unknown };
  if (!res.ok) {
    const message =
      typeof body.error === "string" && body.error.trim() ? body.error.trim() : SCAN_ASK_FALLBACK;
    return { ok: false, message };
  }

  const notebookId = typeof body.notebook?.id === "string" ? body.notebook.id.trim() : "";
  if (!notebookId) return { ok: false, message: SCAN_ASK_FALLBACK };

  const href = `${deps.apiBase ?? ""}${notebookChatHref(notebookId)}`;
  if (isForbiddenAskRoute(href)) return { ok: false, message: SCAN_ASK_FALLBACK };
  return { ok: true, href };
}
