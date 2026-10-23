/**
 * Mobile Keep transport for a print/photo reading. Self-contained: mobile
 * cannot import from mira-hub. Same review-before-store and failed-refresh
 * honesty contract as Hub `keep-photo-review.ts`.
 */

export type PhotoKeepReview = {
  readonly observationId: string;
  readonly reading: string;
};

export type PhotoKeepPostBody = {
  readonly threadId?: string;
  readonly reviewedReading?: string;
};

export type PhotoKeepPostResult = {
  readonly ok: boolean;
  readonly status: number;
  readonly body: {
    readonly error?: string;
    readonly reading?: string;
    readonly observationId?: string;
    readonly docId?: string;
  };
};

export type PhotoKeepTransport = {
  readonly post: (body: PhotoKeepPostBody) => Promise<PhotoKeepPostResult>;
  readonly refresh: () => Promise<boolean>;
  readonly review: (proposed: PhotoKeepReview) => Promise<string | null>;
};

/**
 * Two-step Keep: first POST asks the server for the stored reading (409
 * `reading_required`); the technician edits or confirms that text; the second
 * POST stores only the reviewed value through `correctVisualObservations`.
 * A Keep that already succeeded is idempotent (200). A successful write whose
 * notebook refresh then fails throws, so the card cannot show "kept".
 */
export async function keepPhotoWithReview(
  threadId: string | undefined,
  transport: PhotoKeepTransport,
): Promise<void> {
  const first = await transport.post(threadId ? { threadId } : {});
  if (!first.ok) {
    if (
      first.status !== 409
      || first.body.error !== "reading_required"
      || typeof first.body.reading !== "string"
      || !first.body.reading.trim()
      || typeof first.body.observationId !== "string"
    ) {
      throw new Error(`keep_photo_${first.status}`);
    }
    const reviewed = await transport.review({
      observationId: first.body.observationId,
      reading: first.body.reading,
    });
    if (reviewed == null || !reviewed.trim()) throw new Error("keep_photo_cancelled");
    const second = await transport.post({
      ...(threadId ? { threadId } : {}),
      reviewedReading: reviewed.trim(),
    });
    if (!second.ok) throw new Error(`keep_photo_${second.status}`);
  }
  let refreshed: boolean;
  try {
    refreshed = await transport.refresh();
  } catch {
    throw new Error("keep_photo_refresh_failed");
  }
  if (!refreshed) throw new Error("keep_photo_refresh_failed");
}

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
