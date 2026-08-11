"use client";

// Equipment notebook — mobile-first, chat-centered. Compact identity header,
// a "Sources · N of M" sheet, chat, and citation → source viewer.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FilePlus2, Layers, X, Check } from "lucide-react";
import { API_BASE } from "@/lib/config";
import { NotebookChat, type ChatTurn } from "@/components/equipment/NotebookChat";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";

type Notebook = {
  id: string;
  displayName: string;
  manufacturer: string | null;
  model: string | null;
  locationLabel: string | null;
  identityStatus: string;
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
      (data.turns ?? []).flatMap((t: { id: string; question: string; answerStatus: string; answerText: string | null; evidence: EvidenceCitation[] }) => [
        { id: `${t.id}-q`, role: "user" as const, content: t.question },
        {
          id: `${t.id}-a`,
          role: "assistant" as const,
          content: t.answerText ?? "I couldn't find that in the selected sources.",
          status: t.answerStatus as ChatTurn["status"],
          citations: t.evidence,
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

  const openCitation = useCallback(
    (c: EvidenceCitation) => {
      const q = c.page != null ? `?page=${c.page}` : "";
      router.push(`${API_BASE}/equipment/${id}/source/${c.docId}${q}`);
    },
    [id, router],
  );

  if (notFound) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center" style={{ color: "var(--foreground-muted)" }}>
        <p>This notebook doesn&apos;t exist or isn&apos;t yours.</p>
        <Link href={`${API_BASE}/equipment`} className="mt-3 inline-block text-sm" style={{ color: "var(--brand-blue)" }}>
          Back to notebooks
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-3xl flex-col" style={{ color: "var(--foreground)" }}>
      <header className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <Link href={`${API_BASE}/equipment`} aria-label="Back" style={{ color: "var(--foreground-muted)" }}>
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{notebook?.displayName ?? "…"}</div>
          <div className="truncate text-xs" style={{ color: "var(--foreground-muted)" }}>
            {[notebook?.manufacturer, notebook?.model].filter(Boolean).join(" ") || "No model set"}
            {` · ${enabledDocIds.length} of ${usableCount} sources`}
          </div>
        </div>
        <button
          onClick={() => setSheetOpen(true)}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium"
          style={{ border: "1px solid var(--border)" }}
        >
          <Layers size={14} aria-hidden /> Sources · {enabledDocIds.length}/{usableCount}
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

      {sheetOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setSheetOpen(false)}>
          <div
            className="w-full max-w-md rounded-t-2xl p-4 sm:rounded-2xl"
            style={{ background: "var(--surface-0)", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Sources</h2>
              <button onClick={() => setSheetOpen(false)} aria-label="Close" style={{ color: "var(--foreground-muted)" }}>
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
            <Link
              href={`${API_BASE}/namespace/?node=${notebook ? "" : ""}`}
              className="mt-3 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
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
