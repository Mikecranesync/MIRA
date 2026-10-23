/**
 * Mobile Keep transport for a print/photo reading. Reuses the Hub host
 * contract so Android and Hub cannot diverge on review-before-store or
 * failed-refresh honesty.
 */
import { keepPhotoWithReview, type PhotoKeepPostResult } from "../../../mira-hub/src/factorylm-ui/keep-photo-review";

export { keepPhotoWithReview };
export type { PhotoKeepReview, PhotoKeepTransport } from "../../../mira-hub/src/factorylm-ui/keep-photo-review";

export type MobileKeepPhotoDeps = {
  readonly notebookId: string;
  readonly threadId: string | null;
  readonly request: (path: string, opts: {
    method: string;
    json?: unknown;
    acceptStatuses?: number[];
  }) => Promise<{ status: number; data: unknown }>;
  readonly refresh: () => Promise<boolean | null>;
  readonly review: (proposed: { observationId: string; reading: string }) => Promise<string | null>;
};

function asPostResult(res: { status: number; data: unknown }): PhotoKeepPostResult {
  const body = res.data && typeof res.data === "object" ? res.data as Record<string, unknown> : {};
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    body: {
      ...(typeof body.error === "string" ? { error: body.error } : {}),
      ...(typeof body.reading === "string" ? { reading: body.reading } : {}),
      ...(typeof body.observationId === "string" ? { observationId: body.observationId } : {}),
      ...(typeof body.docId === "string" ? { docId: body.docId } : {}),
    },
  };
}

export async function keepMobilePhoto(fileId: string, deps: MobileKeepPhotoDeps): Promise<void> {
  if (!deps.notebookId) throw new Error("no_notebook");
  const path = `/api/equipment-notebooks/${encodeURIComponent(deps.notebookId)}/photos/${encodeURIComponent(fileId)}/source/`;
  await keepPhotoWithReview(deps.threadId ?? undefined, {
    post: async (body) => asPostResult(await deps.request(path, {
      method: "POST",
      json: body,
      acceptStatuses: [409],
    })),
    refresh: async () => (await deps.refresh()) === true,
    review: deps.review,
  });
}
