import type { Dispatch } from "react";
import type { ShellAction } from "@factorylm/interaction";
import type { HostHooks } from "./parts";

export interface SendErrorProps {
  readonly error: string | null;
  readonly dispatch: Dispatch<ShellAction>;
  readonly draft: string;
  readonly hooks?: HostHooks;
}

/**
 * Humane error surface: no status codes, preserve the question, offer retry + dismiss.
 *
 * The question lives in `draft` (the composer's textarea value) so nothing is lost
 * while the error is displayed. Retry re-sends it. Dismiss clears the error.
 */
export function SendError({ error, dispatch, draft, hooks }: SendErrorProps) {
  if (!error) return null;

  const retry = () => {
    const text = draft.trim();
    if (text && hooks?.onSend) {
      try {
        hooks.onSend(text);
        dispatch({ type: "set-draft", draft: "" });
        dispatch({ type: "set-send-error", error: null });
      } catch (err) {
        // Retry failed; keep showing error with updated message
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: "set-send-error", error: msg.replace(/\b\d{3}\b/g, "").trim() || "Couldn't reach MIRA." });
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
        <p className="fl-send-error__detail">{error} Your message is saved below.</p>
        <div className="fl-send-error__actions">
          <button className="fl-send-error__button" onClick={retry}>
            Try again
          </button>
          <button className="fl-send-error__button" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
