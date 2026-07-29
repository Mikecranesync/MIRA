// Work-order photo upload — wires the WO detail "Add photo" control to the SAME
// upload endpoint the New Work Order page already uses (#1929). The button was a
// dead control (no handler); this is the minimal real flow it triggers. Kept as
// a pure, fetch-injectable function so it's unit-testable in the node test env
// (no DOM/RTL in this repo).
import { API_BASE } from "@/lib/config";

// The canonical local-upload endpoint (per-tenant store / inbox node). Trailing
// slash matches next.config `trailingSlash: true` (#1893).
export const WORK_ORDER_PHOTO_UPLOAD_PATH = "/api/uploads/local/";

export function workOrderPhotoUploadUrl(apiBase: string = API_BASE): string {
  return `${apiBase}${WORK_ORDER_PHOTO_UPLOAD_PATH}`;
}

/**
 * Upload a single work-order photo via the existing local-upload endpoint.
 * `fetchImpl` is injectable for testing. Returns the uploaded file id.
 */
export async function uploadWorkOrderPhoto(
  file: File,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetchImpl(workOrderPhotoUploadUrl(), { method: "POST", body: fd });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `upload_failed_${res.status}`);
  }
  return (await res.json()) as { id: string };
}
