import type { SignInFailureReason } from "../api/resources";

/** Human-facing fallbacks for raw mobile resource values.
 *
 * Resource transport/mappers return structured or empty values. Classic
 * screens call these guarded helpers; canonical adapters own their own copy.
 */
export function signInFailureCopy(reason: SignInFailureReason): string {
  switch (reason) {
    case "could_not_start":
      return "could not start sign-in";
    case "network":
      return "Network problem — check connectivity and retry.";
    case "server":
      return "Sign-in service is unavailable — try again shortly.";
    default:
      return "invalid email or password";
  }
}

export function fileCapabilityLabel(capability: string): string {
  switch (capability) {
    case "indexable":
      return "Searchable source";
    case "viewable":
      return "Viewable attachment";
    default:
      return "Stored file—not searchable in chat";
  }
}

export function notebookDisplayName(value: string): string {
  return value.trim() || "Untitled";
}

export function pmTaskLabel(value: string): string {
  return value.trim() || "PM task";
}

export function workspaceFileName(value: string): string {
  return value.trim() || "untitled";
}

export function suggestedDocumentTitle(value: string): string {
  return value.trim() || "Untitled document";
}

export function uploadSourceWarningCopy(value: string | null | undefined): string {
  return value?.trim() || "Saved, but this file couldn't be indexed for chat.";
}
