import type { Dispatch } from "react";
import type { ShellAction } from "@factorylm/interaction";
import type { HostHooks } from "./parts";

/**
 * Strip an HTTP status code from a message without eating the technician's own
 * numbers. The first pass used /\b\d{3}\b/, which turns "PowerFlex 525" into
 * "PowerFlex " — a model number is three digits far more often than an error is.
 * Only 4xx/5xx are statuses, and only where a message actually reports one.
 */
export function withoutStatusCode(message: string): string {
  return message
    .replace(/\(\s*[45]\d\d\s*\)/g, "")
    .replace(/\b(?:HTTP\s*|status\s*(?:code\s*)?)[45]\d\d\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface SendErrorProps {
  readonly error: string | null;
  readonly dispatch: Dispatch<ShellAction>;
  readonly draft: string;
  /** The turn the failed send belongs to, when there is one; the host's retry is
   *  keyed on it. A send can fail before any turn exists, in which case there is
   *  nothing to name and only the draft fallback applies. */
  readonly turnId?: string;
  readonly hooks?: HostHooks;
}

/**
 * Humane error surface: no status codes, preserve the question, offer retry + dismiss.
 *
 * Retry prefers the HOST's retry path: the host is the only layer that knows what
 * actually failed and can re-send it byte-identically with its original scope.
 * Re-sending the composer draft is a fallback for hosts without one — and on a
 * real host the draft is already empty by the time the error arrives, so a
 * draft-only Retry is a dead button. Try again renders only when one of the two
 * paths exists; the same rule Stop follows.
 */
export function SendError({ error, dispatch, draft, turnId, hooks }: SendErrorProps) {
  if (!error) return null;

  const hostRetry = turnId && hooks?.onRetry ? hooks.onRetry : undefined;
  const draftRetry = Boolean(draft.trim() && hooks?.onSend);
  const canRetry = Boolean(hostRetry) || draftRetry;

  const retry = () => {
    if (hostRetry) {
      dispatch({ type: "set-send-error", error: null });
      hostRetry(turnId as string);
      return;
    }
    const text = draft.trim();
    if (text && hooks?.onSend) {
      try {
        hooks.onSend(text);
        dispatch({ type: "set-draft", draft: "" });
        dispatch({ type: "set-send-error", error: null });
      } catch (err) {
        // Retry failed; keep showing error with updated message
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: "set-send-error", error: withoutStatusCode(msg) || "Couldn't reach MIRA." });
      }
    }
  };

  const dismiss = () => {
    dispatch({ type: "set-send-error", error: null });
  };

  return (
    <div className="fl-send-error" role="alert" aria-label="Send error">
      <div className="fl-send-error__icon">✕</div>
      <div className="fl-send-error__content">
        <p className="fl-send-error__message">Couldn't reach MIRA</p>
        <p className="fl-send-error__detail">{error}{draft.trim() ? " Your message is saved below." : ""}</p>
        <div className="fl-send-error__actions">
          {canRetry ? (
            <button className="fl-send-error__button" onClick={retry}>
              Try again
            </button>
          ) : null}
          <button className="fl-send-error__button" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
