"use client";

// Equipment notebook — mobile-first, chat-centered. Compact identity header,
// a "Sources · N of M" sheet, chat, and citation → source viewer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FilePlus2, Layers, Loader2, X, Check, Trash2 } from "lucide-react";
import { API_BASE, MAX_UPLOAD_MB } from "@/lib/config";
import { NotebookChat, type ChatTurn } from "@/components/equipment/NotebookChat";
import { NotebookDeleteDialog } from "@/components/equipment/NotebookDeleteDialog";
import { deleteFailureMessage, createSubmitGuard } from "@/lib/notebook-delete";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";

type Notebook = {
  id: string;
  displayName: string;
  manufacturer: string | null;
  model: string | null;
  locationLabel: string | null;
  identityStatus: string;
  nodeId: string;
};
type Source = {
  docId: string;
  filename: string | null;
  status: string | null;
  enabledByDefault: boolean;
  matchState: string;
  fileId: string | null;
};

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [initialTurns, setInitialTurns] = useState<ChatTurn[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Ref, not state: the guard must reject a re-entrant call synchronously,
  // before React has committed `deleting`.
  const deleteGuard = useRef(createSubmitGuard());
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/equipment-notebooks/${id}/`, { cache: "no-store" });
    if (res.status === 404) return setNotFound(true);
    if (!res.ok) return;
    const data = await res.json();
    setNotebook(data.notebook);
    const srcs: Source[] = data.sources ?? [];
    setSources(srcs);
    setEnabled((prev) => {
      const next = { ...prev };
      for (const s of srcs) if (!(s.docId in next)) next[s.docId] = s.enabledByDefault && s.matchState !== "rejected";
      return next;
    });
    setInitialTurns(
      (data.turns ?? []).flatMap((t: { id: string; question: string; answerStatus: string; answerText: string | null; evidence: EvidenceCitation[]; basis?: string | null }) => [
        { id: `${t.id}-q`, role: "user" as const, content: t.question },
        {
          id: `${t.id}-a`,
          role: "assistant" as const,
          content: t.answerText ?? "I couldn't find that in the selected sources.",
          status: t.answerStatus as ChatTurn["status"],
          citations: t.evidence,
          // 084 (#3387): the persisted basis — the badge survives reload.
          basis: t.basis ?? null,
        },
      ]),
    );
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load (codebase precedent: namespace/page.tsx)
    void load();
  }, [load]);

  const enabledDocIds = useMemo(
    () => sources.filter((s) => enabled[s.docId] && s.matchState !== "rejected").map((s) => s.docId),
    [sources, enabled],
  );
  const usableCount = sources.filter((s) => s.matchState !== "rejected").length;

  const toggle = useCallback(
    async (docId: string) => {
      const next = !enabled[docId];
      setEnabled((p) => ({ ...p, [docId]: next })); // optimistic
      try {
        await fetch(`${API_BASE}/api/equipment-notebooks/${id}/sources/${docId}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabledByDefault: next }),
        });
      } catch {
        setEnabled((p) => ({ ...p, [docId]: !next })); // reconcile
      }
    },
    [enabled, id],
  );

  // NotebookLM loop: pick a PDF → upload to this notebook's node (parks the
  // original + chunks it via ingest-v2) → attach the indexed doc as a source →
  // reload so it's immediately askable. Reuses the node-files and sources
  // routes verbatim; no new server surface.
  const uploadPdf = useCallback(
    async (file: File) => {
      if (!notebook?.nodeId) return;
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setUploadNote(`That file is over the ${MAX_UPLOAD_MB} MB limit.`);
        return;
      }
      setUploading(true);
      setUploadNote(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${API_BASE}/api/namespace/node/${notebook.nodeId}/files/`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setUploadNote(data.error ?? "Upload failed — please try again.");
          return;
        }
        if (data.indexed && data.uploadId) {
          const att = await fetch(`${API_BASE}/api/equipment-notebooks/${id}/sources/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId: data.uploadId, sourceRole: "manual" }),
          });
          if (!att.ok) {
            setUploadNote("Uploaded, but it couldn't be attached as a source.");
            return;
          }
          await load();
          setUploadNote(
            data.duplicate
              ? "Already in the cabinet — attached to this notebook."
              : "Source added. Ask away.",
          );
        } else {
          // Parked but not indexed (image-only PDF etc.) — honest, not silent.
          setUploadNote(data.warning ?? "Saved, but this file couldn't be indexed for chat.");
        }
      } catch {
        setUploadNote("Upload failed — check the connection and try again.");
      } finally {
        setUploading(false);
      }
    },
    [notebook, id, load],
  );

  const openCitation = useCallback(
    (c: EvidenceCitation) => {
      const q = c.page != null ? `?page=${c.page}` : "";
      router.push(`/equipment/${id}/source/${c.docId}${q}`);
    },
    [id, router],
  );

  // Mobile back-button closes the sheet before leaving the page (PRD mobile
  // nav: Back closes the active surface first). Push a history entry when the
  // sheet opens; popstate closes it. Closing via X/scrim/Escape unwinds the
  // pushed entry so Back doesn't need two taps.
  const openSheet = useCallback(() => {
    setSheetOpen(true);
    window.history.pushState({ sheet: true }, "");
  }, []);
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    if (window.history.state?.sheet) window.history.back();
  }, []);
  useEffect(() => {
    if (!sheetOpen) return;
    const onPop = () => setSheetOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen, closeSheet]);

  const onDelete = useCallback(async () => {
    await deleteGuard.current.run(async () => {
      setDeleting(true);
      setDeleteError(null);
      try {
        const res = await fetch(`${API_BASE}/api/equipment-notebooks/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) throw Object.assign(new Error("delete failed"), { status: res.status });
        // Leave first, then refresh, so the list cannot re-render the row we
        // just removed from a stale client cache.
        router.replace("/equipment");
        router.refresh();
      } catch (err) {
        const status = (err as { status?: number } | null)?.status ?? 0;
        setDeleteError(deleteFailureMessage(status));
        setDeleting(false);
      }
    });
  }, [id, router]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center" style={{ color: "var(--foreground-muted)" }}>
        <p>This notebook doesn&apos;t exist or isn&apos;t yours.</p>
        <Link href="/equipment" className="mt-3 inline-block text-sm" style={{ color: "var(--brand-blue)" }}>
          Back to notebooks
        </Link>
      </div>
    );
  }

  return (
    <div
      // data-notebook-immersive → globals.css hides the mobile hub chrome (top
      // bar + bottom tabs) and zeroes the shell's bottom padding, so this is a
      // focused, full-height NotebookLM-style surface. The column owns its own
      // height; the chat log scrolls internally and the composer sits at the
      // bottom with nothing covering it.
      data-notebook-immersive
      className="mx-auto flex w-full max-w-3xl flex-col h-[100dvh]"
      style={{ color: "var(--foreground)" }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <Link href="/equipment" aria-label="Back" style={{ color: "var(--foreground-muted)" }}>
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{notebook?.displayName ?? "…"}</div>
          <div className="truncate text-xs" style={{ color: "var(--foreground-muted)" }}>
            {[[notebook?.manufacturer, notebook?.model].filter(Boolean).join(" ") || "No model set", notebook?.locationLabel]
              .filter(Boolean)
              .join(" · ")}
            {` · ${enabledDocIds.length} of ${usableCount} sources`}
          </div>
        </div>
        <button
          onClick={openSheet}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium"
          style={{ border: "1px solid var(--border)" }}
        >
          <Layers size={14} aria-hidden /> Sources · {enabledDocIds.length}/{usableCount}
        </button>
        <button
          onClick={() => {
            setDeleteError(null);
            setConfirmDelete(true);
          }}
          aria-haspopup="dialog"
          aria-expanded={confirmDelete}
          aria-label="Delete notebook"
          title="Delete notebook"
          className="flex items-center rounded-lg px-2 py-1.5"
          style={{ border: "1px solid var(--border)", color: "var(--foreground-muted)" }}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1">
        <NotebookChat
          notebookId={id}
          enabledDocIds={enabledDocIds}
          onOpenCitation={openCitation}
          initialTurns={initialTurns}
        />
      </div>


      {confirmDelete && notebook && (
        <NotebookDeleteDialog
          notebookName={notebook.displayName}
          deleting={deleting}
          error={deleteError}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={onDelete}
        />
      )}

      {sheetOpen && (
        // --z-overlay (50): above nav chrome (--z-nav 40 = bottom tab bar +
        // sidebar). At z-40 the tab bar covered the sheet's rows and swallowed
        // their taps on phones (the class of bug this token scale prevents).
        <div
          className="fixed inset-0 z-[var(--z-overlay)] flex items-end justify-center sm:items-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={closeSheet}
          role="dialog"
          aria-modal="true"
          aria-label="Sources"
        >
          <div
            data-testid="sources-sheet-panel"
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl"
            style={{ background: "var(--surface-0)", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Sources</h2>
              <button onClick={closeSheet} aria-label="Close" style={{ color: "var(--foreground-muted)" }}>
                <X size={18} />
              </button>
            </div>
            {sources.length === 0 ? (
              <p className="py-4 text-center text-sm" style={{ color: "var(--foreground-muted)" }}>
                Add a manual, drawing, or photo to start asking questions.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {sources.map((s) => {
                  const processing = s.status && !["parsed", "failed"].includes(s.status);
                  const rejected = s.matchState === "rejected";
                  const on = enabled[s.docId] && !rejected;
                  return (
                    <li key={s.docId}>
                      <button
                        onClick={() => !processing && !rejected && toggle(s.docId)}
                        disabled={Boolean(processing) || rejected}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm"
                        style={{ border: "1px solid var(--border)", opacity: processing || rejected ? 0.5 : 1 }}
                      >
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
                          style={{
                            border: "1px solid var(--border)",
                            background: on ? "var(--brand-blue)" : "transparent",
                          }}
                          aria-hidden
                        >
                          {on && <Check size={13} color="white" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{s.filename ?? "Untitled source"}</span>
                        {processing && (
                          <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
                            {s.status === "failed" ? "failed" : "processing"}
                          </span>
                        )}
                        {rejected && (
                          <span className="text-xs" style={{ color: "var(--status-red)" }}>
                            rejected
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadPdf(f);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !notebook?.nodeId}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
              style={{ background: "var(--brand-blue)", color: "white", opacity: uploading || !notebook?.nodeId ? 0.6 : 1 }}
            >
              {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <FilePlus2 size={16} aria-hidden />}
              {uploading ? "Processing…" : "Upload PDF"}
            </button>
            {uploadNote && (
              <p className="mt-2 text-center text-xs" role="status" style={{ color: "var(--foreground-muted)" }}>
                {uploadNote}
              </p>
            )}
            <Link
              href="/namespace/"
              className="mt-2 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
              style={{ border: "1px dashed var(--border)", color: "var(--foreground-muted)" }}
            >
              <FilePlus2 size={16} aria-hidden /> Add source in filing cabinet
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
