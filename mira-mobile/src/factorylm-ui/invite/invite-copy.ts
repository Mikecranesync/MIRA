import type { InviteLinkError } from "./invite-link";
import type { InviteSignInFailureReason } from "./invite-sign-in";

export function inviteLinkErrorCopy(error: InviteLinkError): string {
  switch (error) {
    case "empty":
      return "Paste the invitation link from your invite email.";
    case "untrusted_origin":
      return "That link doesn't point to FactoryLM — paste the link exactly as it was sent.";
    case "missing_token":
      return "That link is missing its invitation code.";
    default:
      return "That doesn't look like a FactoryLM invitation link.";
  }
}

export function inviteSignInFailureCopy(reason: InviteSignInFailureReason): string {
  switch (reason) {
    case "could_not_start":
      return "Could not start sign-in — try again.";
    case "network":
      return "Network problem — check connectivity and retry.";
    case "server":
      return "Sign-in service is unavailable — try again shortly.";
    default:
      return "This invitation link is invalid, expired, or already used.";
  }
}

/** Signed in, but loading the account afterwards failed; retry re-confirms the session. */
export const INVITE_HYDRATION_FAILED_COPY =
  "You're signed in, but your account didn't finish loading — tap Sign in again.";
