"use client";

// Source viewer — a citation tap lands here on the exact cited page. The byte
// door is GET /api/namespace/files/[id] (parked original, inline mime); the
// browser renders the PDF and #page=N focuses the page (honest page-level
// evidence — PRD §4.7/§14, no faked highlight when only a page anchor exists).

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { API_BASE } from "@/lib/config";

type Source = { docId: string; filename: string | null; fileId: string | null };

export default function SourceViewerPage() {
  const { id, docId } = useParams<{ id: string; docId: string }>();
  const page = useSearchParams().get("page");
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${id}/`, { cache: "no-store" });
      if (!res.ok) return setError("Couldn't load the source.");
      const data = await res.json();
      const s = (data.sources ?? []).find((x: Source) => x.docId === docId);
      if (!s) return setError("This source isn't in the notebook.");
      setSource(s);
    })();
  }, [id, docId]);

  const fileHref = source?.fileId
    ? `${API_BASE}/api/namespace/files/${source.fileId}/${page ? `#page=${page}` : ""}`
    : null;

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-4xl flex-col" style={{ color: "var(--foreground)" }}>
      <header className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <Link href={`/equipment/${id}`} aria-label="Back to chat" style={{ color: "var(--foreground-muted)" }}>
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{source?.filename ?? "Source"}</div>
          {page && (
            <div className="text-xs" style={{ color: "var(--foreground-muted)" }}>
              Cited page {page}
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1" style={{ background: "var(--surface-2)" }}>
        {error ? (
          <p className="p-6 text-sm" style={{ color: "var(--status-red)" }} role="alert">
            {error}
          </p>
        ) : !source ? (
          <p className="p-6 text-sm" style={{ color: "var(--foreground-subtle)" }}>
            Loading…
          </p>
        ) : fileHref ? (
          <iframe title={source.filename ?? "Source document"} src={fileHref} className="h-full w-full border-0" />
        ) : (
          // Honest failure: chunks exist but no parked original to render.
          <div className="p-6 text-sm" style={{ color: "var(--foreground-muted)" }}>
            <p>The original file for this source isn&apos;t available to preview.</p>
            {page && <p className="mt-1">The answer cited page {page} of this document.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
