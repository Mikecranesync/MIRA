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

type Source = {
  docId: string;
  filename: string | null;
  fileId: string | null;
  /** Canonical origin (085) — the photograph a derived doc came from. When
   *  present it IS the original the technician should see. */
  originFileId: string | null;
};

export default function SourceViewerPage() {
  const { id, docId } = useParams<{ id: string; docId: string }>();
  const page = useSearchParams().get("page");
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      // Server-resolved (085, Invariant 3): one endpoint returns the byte door
      // AND the canonical origin, including superseded derived docs — a
      // historical citation must keep opening, and must open the photograph.
      // The old sources-list join broke on any doc no longer listed.
      const res = await fetch(
        `${API_BASE}/api/equipment-notebooks/${id}/sources/${docId}/`,
        { cache: "no-store" },
      );
      if (res.status === 404) return setError("This source isn't in the notebook.");
      if (!res.ok) return setError("Couldn't load the source.");
      setSource(await res.json());
    })();
  }, [id, docId]);

  // The canonical ORIGIN wins (085): for a photo-derived doc the technician's
  // original is the photograph, never the OCR sidecar. Page anchors only make
  // sense on the doc's own file (a photo has no cited page).
  const viewFileId = source?.originFileId ?? source?.fileId ?? null;
  const fileHref = viewFileId
    ? `${API_BASE}/api/namespace/files/${viewFileId}/${!source?.originFileId && page ? `#page=${page}` : ""}`
    : null;

  return (
    <div data-notebook-immersive className="mx-auto flex h-[100dvh] w-full max-w-4xl flex-col" style={{ color: "var(--foreground)" }}>
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
