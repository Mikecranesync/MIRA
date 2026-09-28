import { ApiError } from "../api/client";

/** Legacy-screen copy for structured transport errors.
 *
 * The API client deliberately owns no human-facing strings. Keeping this
 * mapping in the guarded presentation tree lets the canonical shell reuse the
 * typed transport without reopening classic-screen copy as a capability seam.
 */
export function apiErrorCopy(error: unknown, fallback = "Request failed."): string {
  if (!(error instanceof ApiError)) return fallback;
  switch (error.kind) {
    case "auth":
      return "Session expired — sign in again.";
    case "forbidden":
      if (error.detail === "source_not_in_notebook") {
        return "A source in this chat was updated — reopen the notebook and ask again.";
      }
      return "Your role doesn't allow this action.";
    case "not_found":
      return "Not found (or no access).";
    case "network":
      return "Network problem — check connectivity and retry.";
    case "server":
      return "Server error — try again shortly.";
    default: {
      const detail = error.detail.trim();
      // API discriminators are for program logic, not technician-facing copy.
      if (
        !detail ||
        /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(detail) ||
        /^HTTP \d{3}$/.test(detail)
      ) {
        return fallback;
      }
      return detail;
    }
  }
}
