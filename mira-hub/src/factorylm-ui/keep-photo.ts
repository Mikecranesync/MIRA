/**
 * Host-side Keep protocol (#4643 / #4648).
 *
 * The shared photo card only calls `onKeepPhoto(fileId)`. The host must:
 *  1. refuse a silent keep (the server returns the stored reading),
 *  2. show that reading for a human edit,
 *  3. put the returned docId on the next-send scope even if the notebook
 *     re-read fails, so a failed refresh cannot look like a usable keep.
 *
 * Pure — no fetch, no DOM — so both Hub and the same dance on mobile can
 * be tested without mounting the shell.
 */

export type KeepPhotoServerBody = {
  readonly error?: string;
  readonly reading?: string;
  readonly observationId?: string;
  readonly docId?: string;
  readonly alreadyKept?: boolean;
  readonly chunkCount?: number;
};

export type KeepPhotoStep =
  | { readonly action: "done"; readonly docId: string; readonly alreadyKept: boolean }
  | { readonly action: "review"; readonly reading: string }
  | { readonly action: "fail"; readonly error: string };

export const KEEP_PHOTO_REVIEW_PROMPT =
  "Check the reading before keeping it on this machine. Correct any tag or value that does not match the photo.";

export function nextKeepPhotoStep(status: number, body: KeepPhotoServerBody | null): KeepPhotoStep {
  if (status === 200 && typeof body?.docId === "string" && body.docId) {
    return { action: "done", docId: body.docId, alreadyKept: body.alreadyKept === true };
  }
  if (
    status === 409
    && body?.error === "reading_required"
    && typeof body.reading === "string"
    && body.reading.trim() !== ""
  ) {
    return { action: "review", reading: body.reading };
  }
  return { action: "fail", error: body?.error ?? `keep_photo_${status}` };
}

export function reviewedReadingFromPrompt(
  current: string,
  promptFn: (message: string, value: string) => string | null,
): string | null {
  const edited = promptFn(KEEP_PHOTO_REVIEW_PROMPT, current);
  if (edited === null) return null;
  const trimmed = edited.trim();
  return trimmed === "" ? null : trimmed;
}

export function mergeKeptDocIntoScope(
  scope: readonly string[] | null | undefined,
  docId: string,
): string[] {
  const ids = [...(scope ?? [])];
  if (docId && !ids.includes(docId)) ids.push(docId);
  return ids;
}
