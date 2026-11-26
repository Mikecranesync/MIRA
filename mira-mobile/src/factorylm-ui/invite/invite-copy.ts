import type { InviteLinkError } from "./invite-link";
import type { InviteSignInFailureReason } from "./invite-sign-in";
import type { SignInLinkFailureReason } from "./sign-in-link";

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

/** #5942: the Hub answers the same whether or not the account exists, so the
 *  notice never claims a link was sent. */
export function signInLinkSentCopy(email: string): string {
  return `If ${email} has a FactoryLM account, a sign-in link is on its way. It works once, for 15 minutes. Open the email, copy the link, then paste it here.`;
}

export function signInLinkFailureCopy(reason: SignInLinkFailureReason): string {
  switch (reason) {
    case "invalid_email":
      return "Enter a valid email address.";
    case "rate_limited":
      return "Too many sign-in links requested. Try again later.";
    case "unavailable":
      return "Email sign-in links are unavailable right now. Contact support@factorylm.com.";
    case "network":
      return "Network problem — check connectivity and retry.";
    default:
      return "Could not send the link — try again shortly.";
  }
}
