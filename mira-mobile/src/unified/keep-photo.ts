/**
 * Host-side Keep protocol (#4643 / #4648). Same pure helpers as the Hub host;
 * copied rather than imported so mobile does not take a Hub compile dependency.
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
