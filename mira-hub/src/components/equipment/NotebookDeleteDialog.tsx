"use client";

/**
 * Permanent-deletion confirmation for an equipment notebook.
 *
 * Extracted from the notebook page so it can be asserted with
 * renderToStaticMarkup (Hub tests run in node, no jsdom). The two things that
 * make this dialog safe — it NAMES the notebook, and it says the deletion is
 * permanent — are contract, not decoration, so they are tested.
 */
import { Loader2 } from "lucide-react";

export type NotebookDeleteDialogProps = {
  /** Shown verbatim so the operator sees WHICH notebook is being destroyed. */
  notebookName: string;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function NotebookDeleteDialog({
  notebookName,
  deleting,
  error,
  onCancel,
  onConfirm,
}: NotebookDeleteDialogProps) {
  return (
    <div
      className="fixed inset-0 z-overlay flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={() => !deleting && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-nb-title"
        aria-describedby="delete-nb-desc"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl p-4"
        style={{ background: "var(--background)", border: "1px solid var(--border)" }}
      >
        <h2 id="delete-nb-title" className="text-sm font-semibold">
          Delete this notebook?
        </h2>
        <p id="delete-nb-desc" className="mt-2 text-sm" style={{ color: "var(--foreground-muted)" }}>
          <span className="font-medium" style={{ color: "var(--foreground)" }}>
            {notebookName}
          </span>{" "}
          and its chat history will be permanently deleted. This cannot be undone.
        </p>
        <p className="mt-2 text-xs" style={{ color: "var(--foreground-muted)" }}>
          Uploaded documents are kept — they may be attached to other notebooks.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-xs" style={{ color: "var(--danger, #dc2626)" }}>
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg px-3 py-1.5 text-sm"
            style={{ border: "1px solid var(--border)" }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            aria-busy={deleting}
            data-testid="confirm-delete"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--danger, #dc2626)" }}
          >
            {deleting && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
