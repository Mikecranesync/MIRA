// Tiny shared screen primitives — loading / empty / typed-error / retry.
import { ApiError } from "../api/client";

export function Loading({ what }: { what: string }) {
  return <div className="empty">Loading {what}…</div>;
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const msg =
    error instanceof ApiError ? error.userMessage : "Something went wrong.";
  const forbidden = error instanceof ApiError && error.kind === "forbidden";
  return (
    <div className="empty">
      <div className={forbidden ? "" : "error"}>{msg}</div>
      {onRetry && !forbidden && (
        <button onClick={onRetry} style={{ marginTop: 12, width: "auto" }}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Standard async-list state machine used by every tab. */
export type Loadable<T> =
  | { state: "loading" }
  | { state: "error"; error: unknown }
  | { state: "ready"; data: T };

export async function load<T>(fn: () => Promise<T>): Promise<Loadable<T>> {
  try {
    return { state: "ready", data: await fn() };
  } catch (error) {
    return { state: "error", error };
  }
}
