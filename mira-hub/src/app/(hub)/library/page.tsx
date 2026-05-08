"use client";

/**
 * KB Library — Phase 4 of the UNS+KG unification spec.
 *
 * Mobile-first tree browser over `knowledge_entries` (74K+ chunks).
 * Renders a 3-level hierarchy: Manufacturer → Model → Document, with
 * a chunk detail view at the leaf.
 *
 * Design notes
 * ------------
 * - Single page, no client-side routing — modal-style detail view
 *   keeps the back-button working naturally on mobile.
 * - All tap targets are at least 44px tall (Apple HIG minimum).
 * - Tree state lives in component state; no localStorage/cookies so a
 *   shared link from a tech's phone always opens to the same view.
 * - Search filters the tree client-side (the tree fits in memory at
 *   our scale; ~74K chunks roll up to roughly 100s of leaves).
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search,
  Library as LibraryIcon,
  ChevronDown,
  ChevronRight,
  FileText,
  ExternalLink,
  AlertCircle,
  Loader2,
  X,
  Building2,
  Box,
  BookOpen,
} from "lucide-react";
import { API_BASE } from "@/lib/config";

/* ─── Types ──────────────────────────────────────────────────────────── */

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

/* ─── Document id helper (mirrors /api/library/documents) ────────────── */

function encodeDocumentId(sourceUrl: string): string {
  // btoa works in the browser; base64 → URL-safe.
  return btoa(unescape(encodeURIComponent(sourceUrl)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* ─── Page ───────────────────────────────────────────────────────────── */

export default function LibraryPage() {
  const [tree, setTree] = useState<Tree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openMfrs, setOpenMfrs] = useState<Set<string>>(new Set());
  const [openModels, setOpenModels] = useState<Set<string>>(new Set());
  const [activeDoc, setActiveDoc] = useState<{ sourceUrl: string; title: string } | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/library/tree`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Tree>;
      })
      .then((data) => setTree(data))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

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

  // Filter the tree by search term. Matches against manufacturer, model,
  // or any source title. Auto-expands matching branches.
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

    // Sync open-state — without this, tapping a search result inside a
    // collapsed branch would silently fail to render anything.
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Sticky header (works on mobile + desktop) */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <LibraryIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <div className="flex-1 min-w-0">
            <h1 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
              Knowledge Library
            </h1>
            {tree && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {tree.totalChunks.toLocaleString()} chunks ·{" "}
                {tree.totalManufacturers} manufacturers
              </p>
            )}
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search manufacturer, model, or document…"
              className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-10 text-base text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4">
        {loading && <LoadingState />}
        {error && <ErrorState message={error} />}
        {!loading && !error && tree && (
          <>
            {filteredManufacturers.length === 0 ? (
              <EmptyState search={search} />
            ) : (
              <ul className="space-y-2">
                {filteredManufacturers.map((mfr) => (
                  <ManufacturerNode
                    key={mfr.name}
                    mfr={mfr}
                    open={openMfrs.has(mfr.name)}
                    openModels={openModels}
                    onToggle={() => toggleMfr(mfr.name)}
                    onToggleModel={(modelName) =>
                      toggleModel(`${mfr.name}::${modelName}`)
                    }
                    onOpenDoc={(src) =>
                      setActiveDoc({
                        sourceUrl: src.url ?? "",
                        title: src.title,
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </main>

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
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-700"
        style={{ minHeight: 64 }}
      >
        {open ? (
          <ChevronDown className="h-5 w-5 flex-shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-500" />
        )}
        <Building2 className="h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="flex-1 min-w-0">
          <p className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
            {mfr.name}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {mfr.modelCount} model{mfr.modelCount === 1 ? "" : "s"} ·{" "}
            {mfr.chunkCount.toLocaleString()} chunks
          </p>
        </div>
      </button>
      {open && (
        <ul className="border-t border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/40">
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
    <li className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 pl-10 text-left transition-colors hover:bg-white active:bg-slate-100 dark:hover:bg-slate-900 dark:active:bg-slate-800"
        style={{ minHeight: 56 }}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
        )}
        <Box className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
            {model.name}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {model.documentCount} doc{model.documentCount === 1 ? "" : "s"} ·{" "}
            {model.chunkCount.toLocaleString()} chunks
          </p>
        </div>
      </button>
      {open && (
        <ul className="border-t border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          {model.sources.map((src, idx) => (
            <li
              key={`${src.url ?? "no-url"}-${idx}`}
              className="border-b border-slate-100 last:border-b-0 dark:border-slate-800"
            >
              <button
                onClick={() => onOpenDoc(src)}
                disabled={!src.url}
                className="flex w-full items-center gap-3 px-4 py-3 pl-16 text-left transition-colors hover:bg-blue-50 active:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-950/40 dark:active:bg-blue-950/60"
                style={{ minHeight: 52 }}
              >
                <FileText className="h-4 w-4 flex-shrink-0 text-slate-500" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm text-slate-700 dark:text-slate-300">
                    {src.title}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
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

/* ─── Document sheet (mobile bottom-sheet, desktop side panel) ───────── */

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
    fetch(`${API_BASE}/api/library/chunks?document_id=${id}&limit=100`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DocumentDetail>;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [sourceUrl]);

  // Lock body scroll while sheet is open.
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
        className="flex h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:h-[85vh] sm:rounded-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <FileText className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="flex-1 min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
              {data?.document.title ?? title}
            </h2>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-0.5 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Open source
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            aria-label="Close"
            style={{ minWidth: 40, minHeight: 40 }}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        )}
        {error && <ErrorState message={error} />}

        {!loading && !error && data && (
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {data.faultCodes.length > 0 && (
              <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                  <AlertCircle className="h-4 w-4" />
                  Fault codes extracted ({data.faultCodes.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {data.faultCodes.map((f) => (
                    <span
                      key={f.id}
                      title={f.uns_path}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-200/70 px-2 py-1 font-mono text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                    >
                      {f.code || f.name}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Showing {data.chunks.length} of{" "}
              {data.document.totalChunks.toLocaleString()} chunks
            </p>

            <ul className="space-y-2">
              {data.chunks.map((chunk) => (
                <li
                  key={chunk.id}
                  className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {chunk.page != null && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                        Page {chunk.page}
                      </span>
                    )}
                    {chunk.section && (
                      <span className="truncate">§ {chunk.section}</span>
                    )}
                    {chunk.sourceType && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                        {chunk.sourceType}
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                    {chunk.preview}
                    {chunk.preview.length >= 220 ? "…" : ""}
                  </p>
                </li>
              ))}
            </ul>

            {data.pagination.hasMore && (
              <p className="mt-4 text-center text-xs text-slate-400">
                Pagination beyond first 100 chunks not yet wired into UI.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Empty / loading / error states ─────────────────────────────────── */

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      <p className="mt-3 text-sm text-slate-500">Loading library…</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <AlertCircle className="h-8 w-8 text-red-500" />
      <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
        Could not load library
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  );
}

function EmptyState({ search }: { search: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <BookOpen className="h-10 w-10 text-slate-300" />
      <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
        {search ? "No matches" : "Library is empty"}
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {search
          ? `Nothing matches "${search}". Try fewer words.`
          : "Once manuals are ingested they will appear here."}
      </p>
    </div>
  );
}
