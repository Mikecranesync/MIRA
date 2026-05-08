"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  BookOpen,
  Upload,
  Building2,
  Box,
  FileText,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { UploadPicker } from "@/components/UploadPicker";
import { UploadBlock, type UploadBlockData } from "@/components/UploadBlock";
import { API_BASE } from "@/lib/config";

/**
 * Knowledge — single tab covering ingest + browse.
 *
 * Top: upload picker + in-flight uploads (carryover from the original
 * Knowledge page).
 * Below: 3-level manufacturer → model → document tree backed by
 * /api/library/tree. Tap a doc to open a chunk-detail sheet.
 *
 * Replaces the standalone /library page (the route now redirects here).
 */

/* ─── Types from /api/library/tree ───────────────────────────────────── */

type Source = {
  url: string | null;
  title: string;
  chunkCount: number;
  sourceType: string;
};

type Model = {
  name: string;
  chunkCount: number;
  documentCount: number;
  sources: Source[];
};

type Manufacturer = {
  name: string;
  chunkCount: number;
  modelCount: number;
  models: Model[];
};

type Tree = {
  totalChunks: number;
  totalManufacturers: number;
  manufacturers: Manufacturer[];
};

type DocumentDetail = {
  document: { sourceUrl: string; title: string; totalChunks: number };
  chunks: Array<{
    id: string;
    preview: string;
    page: number | null;
    chunkIndex: number | null;
    section: string | null;
    sourceType: string | null;
  }>;
  faultCodes: Array<{ id: string; code: string; name: string; uns_path: string }>;
  pagination: { limit: number; offset: number; hasMore: boolean };
};

const NON_TERMINAL: ReadonlyArray<UploadBlockData["status"]> = [
  "queued",
  "fetching",
  "parsing",
];

/* ─── Document id helper (mirrors /api/library/documents) ────────────── */

function encodeDocumentId(sourceUrl: string): string {
  return btoa(unescape(encodeURIComponent(sourceUrl)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* ─── Page ───────────────────────────────────────────────────────────── */

export default function KnowledgePage() {
  const t = useTranslations("knowledge");

  const [tree, setTree] = useState<Tree | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [openMfrs, setOpenMfrs] = useState<Set<string>>(new Set());
  const [openModels, setOpenModels] = useState<Set<string>>(new Set());
  const [activeDoc, setActiveDoc] = useState<{ sourceUrl: string; title: string } | null>(null);

  const [uploads, setUploads] = useState<UploadBlockData[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  /* ── Tree load ─────────────────────────────────────────────────────── */

  useEffect(() => {
    fetch(`${API_BASE}/api/library/tree`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Tree>;
      })
      .then(setTree)
      .catch((e) => setTreeError(e instanceof Error ? e.message : String(e)))
      .finally(() => setTreeLoading(false));
  }, []);

  /* ── Uploads (kept from original page) ─────────────────────────────── */

  const fetchUploads = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/uploads`, { cache: "no-store" });
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
      setUploads(
        rows.map((r) => ({
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
        })),
      );
    } catch {
      /* swallow — poll will retry */
    }
  }, []);

  useEffect(() => {
    void fetchUploads();
  }, [fetchUploads]);

  useEffect(() => {
    const hasActive = uploads.some((u) => NON_TERMINAL.includes(u.status));
    if (!hasActive) return;
    const iv = setInterval(fetchUploads, 2000);
    return () => clearInterval(iv);
  }, [uploads, fetchUploads]);

  async function handleLocalFiles(files: File[], assetTag: string | null) {
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      if (assetTag) form.append("assetTag", assetTag);
      const res = await fetch(`${API_BASE}/api/uploads/local`, { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const msg =
          body.error === "unsupported_mime"
            ? `Unsupported file type: ${(body.got as string | undefined) || file.type || "unknown"}`
            : body.error === "exceeds_20mb_limit"
            ? `File too large (max 20 MB): ${file.name}`
            : typeof body.error === "string"
            ? body.error
            : `Upload failed (${res.status})`;
        throw new Error(msg);
      }
    }
    await fetchUploads();
  }

  async function handleCloudPicks(
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
  ) {
    for (const result of results) {
      await fetch(`${API_BASE}/api/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...result, assetTag: assetTag ?? undefined }),
      });
    }
    await fetchUploads();
  }

  async function handleDeleteUpload(id: string) {
    await fetch(`/hub/api/uploads/${id}`, { method: "DELETE" });
    await fetchUploads();
  }

  /* ── Tree filter (reused from old library page) ────────────────────── */

  const toggleMfr = useCallback((name: string) => {
    setOpenMfrs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleModel = useCallback((key: string) => {
    setOpenModels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const filteredManufacturers = useMemo(() => {
    if (!tree) return [];
    const q = search.trim().toLowerCase();
    if (!q) return tree.manufacturers;

    const result: Manufacturer[] = [];
    const autoOpenMfrs = new Set<string>();
    const autoOpenModels = new Set<string>();

    for (const mfr of tree.manufacturers) {
      const mfrHit = mfr.name.toLowerCase().includes(q);
      const filteredModels: Model[] = [];

      for (const model of mfr.models) {
        const modelHit = model.name.toLowerCase().includes(q);
        const sourceHits = model.sources.filter((s) =>
          (s.title ?? "").toLowerCase().includes(q),
        );

        if (mfrHit || modelHit || sourceHits.length > 0) {
          filteredModels.push({
            ...model,
            sources: sourceHits.length > 0 && !modelHit ? sourceHits : model.sources,
          });
          autoOpenModels.add(`${mfr.name}::${model.name}`);
        }
      }

      if (mfrHit || filteredModels.length > 0) {
        result.push({ ...mfr, models: filteredModels });
        autoOpenMfrs.add(mfr.name);
      }
    }

    if (autoOpenMfrs.size > 0) {
      setOpenMfrs((prev) => {
        let changed = false;
        const next = new Set(prev);
        autoOpenMfrs.forEach((m) => {
          if (!next.has(m)) {
            next.add(m);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setOpenModels((prev) => {
        let changed = false;
        const next = new Set(prev);
        autoOpenModels.forEach((m) => {
          if (!next.has(m)) {
            next.add(m);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }

    return result;
  }, [tree, search]);

  /* ── Render ────────────────────────────────────────────────────────── */

  const headerSubtitle = treeLoading
    ? "Loading…"
    : treeError
    ? "Could not load library"
    : tree
    ? `${tree.totalChunks.toLocaleString()} ${t("chunks")} ${t("inRAG")} · ${tree.totalManufacturers} ${tree.totalManufacturers === 1 ? "manufacturer" : "manufacturers"}`
    : t("emptyStateOnboarding");

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              {t("title")}
            </h1>
            <p className="truncate text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
              {headerSubtitle}
            </p>
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium h-8 px-3 rounded-lg flex-shrink-0"
            style={{ backgroundColor: "var(--brand-blue)", color: "white" }}
          >
            <Upload className="w-3.5 h-3.5" />
            {t("upload")}
          </button>
        </div>

        <div className="px-4 md:px-6 pb-3">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: "var(--foreground-subtle)" }}
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search")}
              className="w-full h-10 pl-9 pr-9 rounded-lg border text-sm outline-none"
              style={{
                backgroundColor: "var(--surface-1)",
                borderColor: "var(--border)",
                color: "var(--foreground)",
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5"
                style={{ color: "var(--foreground-subtle)" }}
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 max-w-3xl mx-auto space-y-3">
        {uploads.length > 0 && (
          <div className="space-y-2">
            {uploads.map((u) => (
              <UploadBlock key={u.id} upload={u} onDelete={handleDeleteUpload} />
            ))}
          </div>
        )}

        {treeLoading && <TreeLoading />}
        {treeError && !treeLoading && <TreeError message={treeError} />}

        {!treeLoading && !treeError && tree && (
          <>
            {filteredManufacturers.length === 0 ? (
              <TreeEmpty search={search} />
            ) : (
              <ul className="space-y-2">
                {filteredManufacturers.map((mfr) => (
                  <ManufacturerNode
                    key={mfr.name}
                    mfr={mfr}
                    open={openMfrs.has(mfr.name)}
                    openModels={openModels}
                    onToggle={() => toggleMfr(mfr.name)}
                    onToggleModel={(modelName) => toggleModel(`${mfr.name}::${modelName}`)}
                    onOpenDoc={(src) =>
                      setActiveDoc({ sourceUrl: src.url ?? "", title: src.title })
                    }
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <UploadPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onLocalFiles={handleLocalFiles}
        onCloudPicks={handleCloudPicks}
      />

      {activeDoc && (
        <DocumentSheet
          sourceUrl={activeDoc.sourceUrl}
          title={activeDoc.title}
          onClose={() => setActiveDoc(null)}
        />
      )}
    </div>
  );
}

/* ─── Tree nodes ─────────────────────────────────────────────────────── */

function ManufacturerNode({
  mfr,
  open,
  openModels,
  onToggle,
  onToggleModel,
  onOpenDoc,
}: {
  mfr: Manufacturer;
  open: boolean;
  openModels: Set<string>;
  onToggle: () => void;
  onToggleModel: (modelName: string) => void;
  onOpenDoc: (src: Source) => void;
}) {
  return (
    <li
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)" }}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors"
        style={{ minHeight: 64 }}
      >
        {open ? (
          <ChevronDown className="h-5 w-5 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
        ) : (
          <ChevronRight className="h-5 w-5 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
        )}
        <Building2 className="h-5 w-5 flex-shrink-0" style={{ color: "var(--brand-blue)" }} />
        <div className="flex-1 min-w-0">
          <p className="truncate text-base font-semibold" style={{ color: "var(--foreground)" }}>
            {mfr.name}
          </p>
          <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
            {mfr.modelCount} model{mfr.modelCount === 1 ? "" : "s"} ·{" "}
            {mfr.chunkCount.toLocaleString()} chunks
          </p>
        </div>
      </button>
      {open && (
        <ul className="border-t" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}>
          {mfr.models.map((model) => (
            <ModelNode
              key={model.name}
              model={model}
              open={openModels.has(`${mfr.name}::${model.name}`)}
              onToggle={() => onToggleModel(model.name)}
              onOpenDoc={onOpenDoc}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ModelNode({
  model,
  open,
  onToggle,
  onOpenDoc,
}: {
  model: Model;
  open: boolean;
  onToggle: () => void;
  onOpenDoc: (src: Source) => void;
}) {
  return (
    <li className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 pl-10 text-left transition-colors"
        style={{ minHeight: 56 }}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
        )}
        <Box className="h-4 w-4 flex-shrink-0" style={{ color: "#D97706" }} />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium" style={{ color: "var(--foreground)" }}>
            {model.name}
          </p>
          <p className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>
            {model.documentCount} doc{model.documentCount === 1 ? "" : "s"} ·{" "}
            {model.chunkCount.toLocaleString()} chunks
          </p>
        </div>
      </button>
      {open && (
        <ul className="border-t" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)" }}>
          {model.sources.map((src, idx) => (
            <li
              key={`${src.url ?? "no-url"}-${idx}`}
              className="border-b last:border-b-0"
              style={{ borderColor: "var(--border)" }}
            >
              <button
                onClick={() => onOpenDoc(src)}
                disabled={!src.url}
                className="flex w-full items-center gap-3 px-4 py-3 pl-16 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                style={{ minHeight: 52 }}
              >
                <FileText className="h-4 w-4 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm" style={{ color: "var(--foreground)" }}>
                    {src.title}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>
                    {src.sourceType} · {src.chunkCount.toLocaleString()} chunks
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/* ─── Document sheet ─────────────────────────────────────────────────── */

function DocumentSheet({
  sourceUrl,
  title,
  onClose,
}: {
  sourceUrl: string;
  title: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceUrl) {
      setError("This document has no source URL — chunks cannot be loaded.");
      setLoading(false);
      return;
    }
    const id = encodeDocumentId(sourceUrl);
    fetch(`${API_BASE}/api/library/chunks?document_id=${id}&limit=100`, {
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DocumentDetail>;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [sourceUrl]);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl shadow-2xl sm:h-[85vh] sm:rounded-2xl"
        style={{ backgroundColor: "var(--surface-0)" }}
      >
        <header
          className="flex items-start gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <FileText className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: "var(--brand-blue)" }} />
          <div className="flex-1 min-w-0">
            <h2 className="truncate text-base font-semibold" style={{ color: "var(--foreground)" }}>
              {data?.document.title ?? title}
            </h2>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-0.5 inline-flex items-center gap-1 text-xs hover:underline"
                style={{ color: "var(--brand-blue)" }}
              >
                Open source
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2"
            aria-label="Close"
            style={{ minWidth: 40, minHeight: 40, color: "var(--foreground-subtle)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--foreground-subtle)" }} />
          </div>
        )}
        {error && <TreeError message={error} />}

        {!loading && !error && data && (
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {data.faultCodes.length > 0 && (
              <section
                className="mb-4 rounded-xl border p-3"
                style={{ borderColor: "#F59E0B40", backgroundColor: "#FEF3C720" }}
              >
                <div
                  className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "#92400E" }}
                >
                  <AlertCircle className="h-4 w-4" />
                  Fault codes extracted ({data.faultCodes.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {data.faultCodes.map((f) => (
                    <span
                      key={f.id}
                      title={f.uns_path}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-xs"
                      style={{ backgroundColor: "#FDE68A", color: "#78350F" }}
                    >
                      {f.code || f.name}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <p className="mb-3 text-xs" style={{ color: "var(--foreground-muted)" }}>
              Showing {data.chunks.length} of {data.document.totalChunks.toLocaleString()} chunks
            </p>

            <ul className="space-y-2">
              {data.chunks.map((chunk) => (
                <li
                  key={chunk.id}
                  className="rounded-lg border p-3"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}
                >
                  <div
                    className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]"
                    style={{ color: "var(--foreground-muted)" }}
                  >
                    {chunk.page != null && (
                      <span
                        className="rounded px-1.5 py-0.5"
                        style={{ backgroundColor: "var(--surface-0)" }}
                      >
                        Page {chunk.page}
                      </span>
                    )}
                    {chunk.section && <span className="truncate">§ {chunk.section}</span>}
                    {chunk.sourceType && (
                      <span
                        className="rounded px-1.5 py-0.5"
                        style={{ backgroundColor: "var(--surface-0)" }}
                      >
                        {chunk.sourceType}
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>
                    {chunk.preview}
                    {chunk.preview.length >= 220 ? "…" : ""}
                  </p>
                </li>
              ))}
            </ul>

            {data.pagination.hasMore && (
              <p className="mt-4 text-center text-xs" style={{ color: "var(--foreground-subtle)" }}>
                Pagination beyond first 100 chunks not yet wired into UI.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── States ─────────────────────────────────────────────────────────── */

function TreeLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--foreground-subtle)" }} />
      <p className="mt-3 text-sm" style={{ color: "var(--foreground-muted)" }}>
        Loading knowledge base…
      </p>
    </div>
  );
}

function TreeError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <AlertCircle className="h-8 w-8" style={{ color: "#DC2626" }} />
      <p className="mt-3 text-sm font-medium" style={{ color: "var(--foreground)" }}>
        Could not load library
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
        {message}
      </p>
    </div>
  );
}

function TreeEmpty({ search }: { search: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <BookOpen className="h-10 w-10" style={{ color: "var(--foreground-subtle)" }} />
      <p className="mt-3 text-sm font-medium" style={{ color: "var(--foreground)" }}>
        {search ? "No matches" : "Library is empty"}
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
        {search
          ? `Nothing matches "${search}". Try fewer words.`
          : "Once manuals are ingested they will appear here."}
      </p>
    </div>
  );
}
