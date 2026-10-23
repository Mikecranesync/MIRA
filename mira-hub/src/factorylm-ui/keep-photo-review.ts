/**
 * Host-side Keep contract for a print/photo reading (#4643, #4648).
 *
 * The shared card only calls `onKeepPhoto(fileId)` and treats resolve as
 * success. The host therefore owns the review step and the post-Keep refresh
 * so a wrong OCR value cannot be stored silently and a failed refresh cannot
 * look like a completed Keep. No shared UI package change.
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
