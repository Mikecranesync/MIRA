"use client";

// ARPK Phase 1d — production-backed documents surface.
// PRD (docs/plans/2026-08-10-prd-agent-readable-product-knowledge-t2108.md
// § "Document-scoped chat"): "Ship a production-backed document list/detail
// surface with a per-document Chat action." Replaces the Labs-gated DOCS mock
// grid: the list is the real /api/documents rollup (hybrid corpus — the
// caller's private v2 uploads + the shared OEM library), and every row that
// carries doc_id + node_id (a v2 upload) gets a Chat action deep-linking into
// NodeChat with `doc=` scope. No mock data, no Telegram deep link.

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search, FileText, Bot, Upload, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UploadPicker } from "@/components/UploadPicker";
import { UploadBlock, type UploadBlockData } from "@/components/UploadBlock";
import { useToast } from "@/providers/toast-provider";
import { API_BASE, MAX_UPLOAD_MB } from "@/lib/config";
import { docChatHref, isDocChattable } from "@/lib/doc-chat-link";

const NON_TERMINAL: ReadonlyArray<UploadBlockData["status"]> = [
  "queued",
  "fetching",
  "parsing",
];

interface DocumentRow {
  source_url: string;
  title: string;
  manufacturer: string | null;
  model_number: string | null;
  equipment_type: string | null;
  chunk_count: number;
  last_indexed: string | null;
  verified: boolean;
  doc_id: string | null;
  node_id: string | null;
  filename: string | null;
  pages: number | null;
  mine: boolean;
}

export default function DocumentsPage() {
  const t = useTranslations("documents");
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploads, setUploads] = useState<UploadBlockData[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const prevStatuses = useRef<Map<string, UploadBlockData["status"]>>(new Map());

  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/documents/?limit=200`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { documents?: DocumentRow[] };
      setDocs(body.documents ?? []);
    } catch {
      /* swallow — refetched on upload completion */
    } finally {
      setDocsLoading(false);
    }
  }, []);

  const fetchUploads = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/uploads/`, { cache: "no-store" });
      if (!res.ok) return;
      const rows = (await res.json()) as Array<{
        id: string;
        provider: "google" | "dropbox" | "local";
        kind?: "document" | "photo";
        filename: string;
        sizeBytes: number | null;
        externalCreatedAt: string | null;
        status: UploadBlockData["status"];
        statusDetail: string | null;
        kbChunkCount: number | null;
        assetTag: string | null;
      }>;
      const next: UploadBlockData[] = rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        kind: r.kind ?? "document",
        filename: r.filename,
        sizeBytes: r.sizeBytes,
        externalCreatedAt: r.externalCreatedAt,
        status: r.status,
        statusDetail: r.statusDetail,
        kbChunkCount: r.kbChunkCount,
        assetTag: r.assetTag,
      }));

      // Toast on terminal-state transitions; refresh the doc list when an
      // upload finishes so the new document appears without a reload.
      const seen = prevStatuses.current;
      let anyParsed = false;
      for (const u of next) {
        const prev = seen.get(u.id);
        if (prev && prev !== u.status) {
          if (u.status === "parsed") {
            anyParsed = true;
            const chunks = u.kbChunkCount != null ? ` · ${u.kbChunkCount} chunks indexed` : "";
            toast(`Processed: ${u.filename}${chunks}`, "success");
          } else if (u.status === "failed") {
            toast(`Failed: ${u.filename}${u.statusDetail ? ` — ${u.statusDetail}` : ""}`, "error");
          }
        }
        seen.set(u.id, u.status);
      }
      setUploads(next);
      if (anyParsed) void fetchDocs();
    } catch {
      /* swallow — poll will retry */
    }
  }, [toast, fetchDocs]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchUploads();
      void fetchDocs();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchUploads, fetchDocs]);

  useEffect(() => {
    const hasActive = uploads.some((u) => NON_TERMINAL.includes(u.status));
    if (!hasActive) return;
    const iv = setInterval(fetchUploads, 2000);
    return () => clearInterval(iv);
  }, [uploads, fetchUploads]);

  const handleLocalFiles = useCallback(
    async (files: File[], assetTag: string | null) => {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        if (assetTag) form.append("assetTag", assetTag);
        const res = await fetch(`${API_BASE}/api/uploads/local/`, { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          const msg =
            body.error === "unsupported_mime"
              ? `Unsupported file type: ${(body.got as string | undefined) || file.type || "unknown"}`
              : body.error === "exceeds_size_limit"
                ? `File too large (max ${MAX_UPLOAD_MB} MB): ${file.name}`
                : typeof body.error === "string"
                  ? body.error
                  : `Upload failed (${res.status})`;
          toast(msg, "error");
          throw new Error(msg);
        }
      }
      toast(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`, "info");
      await fetchUploads();
    },
    [fetchUploads, toast],
  );

  const handleCloudPicks = useCallback(
    async (
      results: Array<{
        provider: "google" | "dropbox";
        externalFileId?: string;
        externalDownloadUrl?: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
        externalCreatedAt: string | null;
      }>,
      assetTag: string | null,
    ) => {
      for (const result of results) {
        await fetch(`${API_BASE}/api/uploads/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...result, assetTag: assetTag ?? undefined }),
        });
      }
      toast(`Queued ${results.length} file${results.length === 1 ? "" : "s"} from cloud`, "info");
      await fetchUploads();
    },
    [fetchUploads, toast],
  );

  const handleRetry = useCallback(
    async (id: string) => {
      const res = await fetch(`${API_BASE}/api/uploads/${id}/retry/`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        toast(typeof body.error === "string" ? body.error : "Retry failed", "error");
        return;
      }
      toast("Retrying…", "info");
      await fetchUploads();
    },
    [fetchUploads, toast],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await fetch(`${API_BASE}/api/uploads/${id}/`, { method: "DELETE" });
      await fetchUploads();
    },
    [fetchUploads],
  );

  const recentUploads = uploads.slice(0, 8);
  const hasActiveUpload = uploads.some((u) => NON_TERMINAL.includes(u.status));

  const q = query.trim().toLowerCase();
  const visible = docs.filter((d) => {
    if (!q) return true;
    return (
      d.title.toLowerCase().includes(q) ||
      (d.manufacturer ?? "").toLowerCase().includes(q) ||
      (d.model_number ?? "").toLowerCase().includes(q)
    );
  });
  const mine = visible.filter((d) => d.mine);
  const library = visible.filter((d) => !d.mine);

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPickerOpen(true)}>
              <Upload className="w-3.5 h-3.5" />{t("upload")}
              {hasActiveUpload && (
                <span
                  className="ml-1 inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: "var(--brand-blue)" }}
                />
              )}
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
            <Input placeholder={t("searchPlaceholder")} value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4">
        {recentUploads.length > 0 && (
          <div className="mb-5">
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--foreground-subtle)" }}>
              Recent Uploads
            </p>
            <div className="flex flex-col gap-2">
              {recentUploads.map((u) => (
                <UploadBlock key={u.id} upload={u} onDelete={handleDelete} onRetry={handleRetry} />
              ))}
            </div>
          </div>
        )}

        {/* My documents — the caller's private v2 uploads; each is chattable. */}
        <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--foreground-subtle)" }}>
          My Documents
        </p>
        {docsLoading ? (
          <p className="text-xs mb-6" style={{ color: "var(--foreground-subtle)" }}>Loading…</p>
        ) : mine.length === 0 ? (
          <p className="text-xs mb-6" style={{ color: "var(--foreground-subtle)" }}>
            No documents yet — upload a manual and chat with it.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            {mine.map((doc) => (
              <DocCard key={doc.source_url} doc={doc} />
            ))}
          </div>
        )}

        {/* Shared OEM library — read-only reference rows (no doc-scoped chat). */}
        <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--foreground-subtle)" }}>
          OEM Library
        </p>
        {!docsLoading && library.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--foreground-subtle)" }}>{t("noDocuments")}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {library.slice(0, 60).map((doc) => (
              <DocCard key={doc.source_url} doc={doc} />
            ))}
          </div>
        )}
      </div>

      <UploadPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onLocalFiles={handleLocalFiles}
        onCloudPicks={handleCloudPicks}
      />
    </div>
  );
}

function DocCard({ doc }: { doc: DocumentRow }) {
  const chattable = isDocChattable(doc);
  const meta = [
    doc.pages ? `${doc.pages}p` : null,
    `${doc.chunk_count} chunks`,
    doc.last_indexed ? new Date(doc.last_indexed).toLocaleDateString() : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const subtitle = [doc.manufacturer, doc.model_number].filter(Boolean).join(" ");

  const body = (
    <div className="card card-hover p-4 flex flex-col gap-3 transition-shadow h-full" data-testid="doc-card">
      <div className="flex items-start justify-between gap-2">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "var(--surface-1)" }}
        >
          <FileText className="w-5 h-5" style={{ color: "var(--foreground-muted)" }} />
        </div>
        <div className="flex items-center gap-1.5">
          {doc.verified && (
            <span
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "var(--surface-1)", color: "var(--ok, #16A34A)" }}
            >
              <ShieldCheck className="w-3 h-3" /> verified
            </span>
          )}
          {doc.mine && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}
            >
              private
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug break-words" style={{ color: "var(--foreground)" }}>
          {doc.title}
        </p>
        <p className="text-[11px] mt-1" style={{ color: "var(--foreground-subtle)" }}>
          {subtitle ? `${subtitle} · ` : ""}
          {meta}
        </p>
      </div>

      {chattable && (
        <div>
          <Link
            href={docChatHref(doc)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
            style={{ borderColor: "var(--accent, var(--brand-blue))", color: "var(--accent, var(--brand-blue))" }}
            data-testid="doc-chat-action"
          >
            <Bot className="w-3.5 h-3.5" /> Chat with this document
          </Link>
        </div>
      )}
    </div>
  );

  return body;
}
