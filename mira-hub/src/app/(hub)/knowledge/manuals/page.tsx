"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  FileText,
  Upload,
  Clock,
  ChevronRight,
  ArrowLeft,
  Factory,
  Layers,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { UploadPicker } from "@/components/UploadPicker";
import { UploadBlock, type UploadBlockData } from "@/components/UploadBlock";
import { API_BASE, MAX_UPLOAD_MB } from "@/lib/config";
import { KbGrowthDashboard } from "../KbGrowthDashboard";
import { UploadSummaryCard } from "@/components/UploadSummaryCard";

type Manufacturer = {
  name: string;
  chunkCount: number;
  docCount: number;
  lastIndexed: string | null;
};

type LibraryStats = {
  totalChunks: number;
  totalDocs: number;
  manufacturerCount: number;
  lastIngested: string | null;
  fetchedAt: string | null;
};

const LIVE_POLL_MS = 30_000;

const EMPTY_STATS: LibraryStats = {
  totalChunks: 0,
  totalDocs: 0,
  manufacturerCount: 0,
  lastIngested: null,
  fetchedAt: null,
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

type ManualDoc = {
  sourceUrl: string;
  title: string;
  modelNumber: string | null;
  sourceType: string | null;
  equipmentType: string;
  chunkCount: number;
  lastIndexed: string | null;
};

type ManualModel = {
  modelNumber: string;
  chunkCount: number;
  docCount: number;
  docs: ManualDoc[];
  unsPath: string;
};

type ManualGroup = {
  equipmentType: string;
  chunkCount: number;
  docCount: number;
  modelCount: number;
  models: ManualModel[];
  unsPath: string;
};

const NON_TERMINAL: ReadonlyArray<UploadBlockData["status"]> = [
  "queued",
  "fetching",
  "parsing",
];

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

export default function KnowledgePage() {
  const t = useTranslations("knowledge");
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [stats, setStats] = useState<LibraryStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploads, setUploads] = useState<UploadBlockData[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [summaryUploadId, setSummaryUploadId] = useState<string | null>(null);

  const [selectedMfr, setSelectedMfr] = useState<string | null>(null);
  const [groups, setGroups] = useState<ManualGroup[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [openTypes, setOpenTypes] = useState<Set<string>>(new Set());

  type ContentResult = {
    sourceUrl: string;
    title: string;
    manufacturer: string;
    modelNumber: string | null;
    sourceType: string | null;
    snippet: string;
  };
  const [contentResults, setContentResults] = useState<ContentResult[]>([]);
  const [contentSearching, setContentSearching] = useState(false);

  // Debounced full-text search: fires 350 ms after the user stops typing,
  // only in the manufacturer list view (not drilled in) and only with a query.
  useEffect(() => {
    if (selectedMfr || !search.trim()) {
      setContentResults([]);
      return;
    }
    setContentSearching(true);
    const timer = setTimeout(() => {
      fetch(`${API_BASE}/api/knowledge/search?q=${encodeURIComponent(search.trim())}`, {
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((data) => setContentResults(data.results ?? []))
        .catch(() => setContentResults([]))
        .finally(() => setContentSearching(false));
    }, 350);
    return () => {
      clearTimeout(timer);
      setContentSearching(false);
    };
  }, [search, selectedMfr]);

  type LinkedAsset = {
    id: string;
    tag: string;
    name: string;
    manufacturer: string | null;
    model: string | null;
    type: string | null;
    parentAssetId: string | null;
  };
  type AssetDoc = {
    sourceUrl: string;
    title: string;
    chunkCount: number;
    modelNumber: string | null;
    verified: boolean;
  };
  const [linkedAssets, setLinkedAssets] = useState<LinkedAsset[]>([]);
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
  const [assetChildren, setAssetChildren] = useState<Record<string, LinkedAsset[]>>({});
  const [assetDocs, setAssetDocs] = useState<Record<string, AssetDoc[]>>({});

  // Tick every 15s so "Last updated" relative time stays current between polls.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => clearInterval(iv);
  }, []);

  const fetchManufacturers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/knowledge/`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      // API now returns A-Z; sort defensively in case any caller mutates.
      const list: Manufacturer[] = data.manufacturers ?? [];
      list.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
      setManufacturers(list);
      setStats(data.stats ?? EMPTY_STATS);
    } catch {
      /* swallow — next poll retries */
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void fetchManufacturers().finally(() => setLoading(false));
  }, [fetchManufacturers]);

  // Live polling: refresh on focus + tab-visibility, plus a 30s heartbeat.
  // Pauses while drilled into a manufacturer detail view to avoid re-fetching
  // the list mid-interaction.
  useEffect(() => {
    if (selectedMfr) return;
    const onFocus = () => void fetchManufacturers();
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchManufacturers();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") void fetchManufacturers();
    }, LIVE_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(iv);
    };
  }, [selectedMfr, fetchManufacturers]);

  const openManufacturer = useCallback((name: string) => {
    setSelectedMfr(name);
    setGroups([]);
    setOpenTypes(new Set());
    setDocsLoading(true);
    setLinkedAssets([]);
    setExpandedAsset(null);
    setAssetChildren({});
    setAssetDocs({});
    fetch(`${API_BASE}/api/knowledge/manufacturer/?name=${encodeURIComponent(name)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        const incoming: ManualGroup[] = data.groups ?? [];
        setGroups(incoming);
        if (incoming.length > 0) {
          setOpenTypes(new Set([incoming[0].equipmentType]));
        }
      })
      .catch(console.error)
      .finally(() => setDocsLoading(false));

    // Fetch root-level assets for this manufacturer (parent_asset_id IS NULL).
    fetch(
      `${API_BASE}/api/assets?manufacturer=${encodeURIComponent(name)}&roots=true`,
      { cache: "no-store" },
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setLinkedAssets(Array.isArray(data) ? data : []))
      .catch(console.error);
  }, []);

  const toggleAsset = useCallback(
    async (id: string) => {
      if (expandedAsset === id) {
        setExpandedAsset(null);
        return;
      }
      setExpandedAsset(id);
      if (!assetChildren[id]) {
        try {
          const r = await fetch(`${API_BASE}/api/assets/${id}/children/`, {
            cache: "no-store",
          });
          if (r.ok) {
            const data = await r.json();
            setAssetChildren((prev) => ({ ...prev, [id]: data }));
          }
        } catch {
          /* ignore */
        }
      }
      if (!assetDocs[id]) {
        try {
          const r = await fetch(`${API_BASE}/api/assets/${id}/documents/`, {
            cache: "no-store",
          });
          if (r.ok) {
            const data = await r.json();
            setAssetDocs((prev) => ({ ...prev, [id]: data }));
          }
        } catch {
          /* ignore */
        }
      }
    },
    [expandedAsset, assetChildren, assetDocs],
  );

  const toggleType = useCallback((equipmentType: string) => {
    setOpenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(equipmentType)) next.delete(equipmentType);
      else next.add(equipmentType);
      return next;
    });
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
    let firstId: string | null = null;
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      if (assetTag) form.append("assetTag", assetTag);
      const res = await fetch(`${API_BASE}/api/uploads/local/`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const msg =
          body.error === "unsupported_mime"
            ? `Can't upload "${file.name}" — ${(body.got as string | undefined) || file.type || "that file type"} isn't supported. Upload a PDF, JPEG, PNG, WebP, or HEIC (convert other formats to PDF first).`
            : body.error === "exceeds_size_limit"
              ? `"${file.name}" is too large (max ${MAX_UPLOAD_MB} MB). Split or compress it and try again.`
              : body.error === "content_does_not_match_declared_mime"
                ? `"${file.name}" looks corrupted or renamed — its contents don't match its extension. Re-export it as a real PDF and try again.`
                : typeof body.error === "string"
                  ? body.error
                  : `Upload failed (${res.status})`;
        throw new Error(msg);
      }
      if (!firstId) {
        const data = (await res.json().catch(() => null)) as { id?: string } | null;
        if (data?.id) firstId = data.id;
      }
    }
    if (firstId) setSummaryUploadId(firstId);
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
    let firstId: string | null = null;
    for (const result of results) {
      const res = await fetch(`${API_BASE}/api/uploads/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...result, assetTag: assetTag ?? undefined }),
      });
      if (!firstId && res.ok) {
        const data = (await res.json().catch(() => null)) as { id?: string } | null;
        if (data?.id) firstId = data.id;
      }
    }
    if (firstId) setSummaryUploadId(firstId);
    await fetchUploads();
  }

  async function handleDeleteUpload(id: string) {
    await fetch(`/hub/api/uploads/${id}/`, { method: "DELETE" });
    await fetchUploads();
  }

  async function handleRetryUpload(id: string) {
    const res = await fetch(`${API_BASE}/api/uploads/${id}/retry/`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      // Local buffer expired/lost — the only case where retry can't proceed.
      if (body.error === "local_retry_requires_re_upload") {
        alert("This file's saved copy has expired — please upload it again from disk.");
      }
    }
    await fetchUploads();
  }

  const filteredMfrs = manufacturers.filter(
    (m) => search === "" || m.name.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredGroups = groups
    .map((g) => ({
      ...g,
      models: g.models
        .map((m) => ({
          ...m,
          docs: m.docs.filter(
            (d) =>
              search === "" ||
              d.title.toLowerCase().includes(search.toLowerCase()) ||
              (d.modelNumber?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
              d.sourceUrl.toLowerCase().includes(search.toLowerCase()) ||
              m.modelNumber.toLowerCase().includes(search.toLowerCase()) ||
              g.equipmentType.toLowerCase().includes(search.toLowerCase()),
          ),
        }))
        .filter((m) => m.docs.length > 0),
    }))
    .filter((g) => g.models.length > 0);

  const visibleDocCount = filteredGroups.reduce(
    (s, g) => s + g.models.reduce((ms, m) => ms + m.docs.length, 0),
    0,
  );

  const headerSubtitle = loading
    ? "Loading…"
    : selectedMfr
      ? docsLoading
        ? `Loading ${selectedMfr}…`
        : `${selectedMfr} · ${visibleDocCount} ${
            visibleDocCount === 1 ? "document" : "documents"
          } across ${filteredGroups.length} ${
            filteredGroups.length === 1 ? "category" : "categories"
          }`
      : stats.totalChunks === 0
        ? t("emptyStateOnboarding")
        : `${stats.totalChunks.toLocaleString()} ${t("chunks")} · ${stats.manufacturerCount} manufacturers · last ingest ${timeAgo(stats.lastIngested)}`;

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div
        className="sticky top-0 z-20 border-b"
        style={{
          backgroundColor: "var(--surface-0)",
          borderColor: "var(--border)",
        }}
      >
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div className="flex items-center gap-2 min-w-0">
            {selectedMfr && (
              <button
                onClick={() => {
                  setSelectedMfr(null);
                  setGroups([]);
                  setOpenTypes(new Set());
                  setSearch("");
                }}
                className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
                style={{ backgroundColor: "var(--surface-1)" }}
                aria-label="Back"
              >
                <ArrowLeft className="w-4 h-4" style={{ color: "var(--foreground)" }} />
              </button>
            )}
            <div className="min-w-0">
              <h1
                className="text-base font-semibold truncate"
                style={{ color: "var(--foreground)" }}
              >
                {selectedMfr ?? t("title")}
              </h1>
              {selectedMfr ? (
                <p
                  className="text-[11px] mt-0.5 truncate font-mono"
                  style={{ color: "var(--foreground-subtle)" }}
                >
                  knowledge_base &gt; {selectedMfr}
                </p>
              ) : null}
              <p
                className="text-xs mt-0.5 truncate"
                style={{ color: "var(--foreground-muted)" }}
              >
                {headerSubtitle}
              </p>
            </div>
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

        <div className="px-4 md:px-6 pb-2">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: "var(--foreground-subtle)" }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={selectedMfr ? `Search ${selectedMfr} documents…` : "Search manufacturers or content…"}
              className="w-full h-9 pl-9 pr-3 rounded-lg border text-sm"
              style={{
                backgroundColor: "var(--surface-1)",
                borderColor: "var(--border)",
                color: "var(--foreground)",
              }}
            />
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 max-w-5xl mx-auto">
        {/* KB telemetry dashboard is admin-grade and crowds the mobile viewport,
            pushing uploads + manufacturers below the fold. Show it from md+ only.
            See Mike's 2026-05-17 expo report. */}
        {!selectedMfr && (
          <div className="hidden md:block">
            <KbGrowthDashboard />
          </div>
        )}

        {!selectedMfr && summaryUploadId && (
          <UploadSummaryCard uploadId={summaryUploadId} />
        )}

        {!selectedMfr && (
          <div className="space-y-2 mb-4">
            {uploads.map((u) => (
              <UploadBlock
                key={u.id}
                upload={u}
                onDelete={handleDeleteUpload}
                onRetry={handleRetryUpload}
              />
            ))}
          </div>
        )}

        {!selectedMfr && !loading && filteredMfrs.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-2">
              <h2
                className="text-[11px] uppercase tracking-wider font-semibold"
                style={{ color: "var(--foreground-subtle)" }}
              >
                Manufacturers (A–Z)
              </h2>
              <p className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
                {filteredMfrs.length} of {manufacturers.length}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filteredMfrs.map((m) => (
                <button
                  key={m.name}
                  onClick={() => openManufacturer(m.name)}
                  className="card p-4 text-left hover:scale-[1.02] active:scale-[0.98] transition-transform"
                  style={{ backgroundColor: "var(--surface-1)" }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                    style={{ backgroundColor: "var(--surface-2)" }}
                  >
                    <Factory
                      className="w-4 h-4"
                      style={{ color: "var(--brand-blue)" }}
                    />
                  </div>
                  <p
                    className="text-sm font-semibold leading-tight line-clamp-2"
                    style={{ color: "var(--foreground)" }}
                  >
                    {m.name}
                  </p>
                  <p
                    className="text-[11px] mt-1"
                    style={{ color: "var(--foreground-muted)" }}
                  >
                    {formatNumber(m.chunkCount)} {t("chunks")}
                  </p>
                  <p
                    className="text-[11px]"
                    style={{ color: "var(--foreground-subtle)" }}
                  >
                    {m.docCount.toLocaleString()}{" "}
                    {m.docCount === 1 ? "manual" : "manuals"}
                  </p>
                </button>
              ))}
            </div>
          </>
        )}

        {selectedMfr && linkedAssets.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <h3
                className="text-[10px] uppercase tracking-wider font-semibold"
                style={{ color: "var(--foreground-subtle)" }}
              >
                Linked Assets ({linkedAssets.length})
              </h3>
            </div>
            <div className="space-y-2">
              {linkedAssets.map((a) => {
                const open = expandedAsset === a.id;
                const children = assetChildren[a.id] ?? [];
                const docs = assetDocs[a.id] ?? [];
                return (
                  <div key={a.id} className="card overflow-hidden">
                    <button
                      onClick={() => toggleAsset(a.id)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-[var(--surface-1)] transition-colors"
                    >
                      <Layers
                        className="w-4 h-4 flex-shrink-0"
                        style={{ color: "var(--brand-blue)" }}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-semibold leading-tight"
                          style={{ color: "var(--foreground)" }}
                        >
                          {a.name || a.tag}
                        </p>
                        <p
                          className="text-[11px] mt-0.5"
                          style={{ color: "var(--foreground-muted)" }}
                        >
                          {a.tag}
                          {a.model ? ` · ${a.model}` : ""}
                          {a.type ? ` · ${a.type}` : ""}
                        </p>
                      </div>
                      <ChevronRight
                        className={`w-4 h-4 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                        style={{ color: "var(--foreground-subtle)" }}
                      />
                    </button>
                    {open && (
                      <div className="px-3 pb-3 border-t" style={{ borderColor: "var(--border)" }}>
                        {children.length > 0 && (
                          <div className="mt-3">
                            <p
                              className="text-[10px] uppercase tracking-wider font-semibold mb-1.5"
                              style={{ color: "var(--foreground-subtle)" }}
                            >
                              Components ({children.length})
                            </p>
                            <div className="space-y-1">
                              {children.map((c) => (
                                <div
                                  key={c.id}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded"
                                  style={{ backgroundColor: "var(--surface-1)" }}
                                >
                                  <Layers
                                    className="w-3 h-3 flex-shrink-0"
                                    style={{ color: "var(--foreground-subtle)" }}
                                  />
                                  <span
                                    className="text-xs flex-1 min-w-0 truncate"
                                    style={{ color: "var(--foreground)" }}
                                  >
                                    {c.name || c.tag}
                                  </span>
                                  {c.type && (
                                    <span
                                      className="text-[10px]"
                                      style={{ color: "var(--foreground-muted)" }}
                                    >
                                      {c.type}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="mt-3">
                          <p
                            className="text-[10px] uppercase tracking-wider font-semibold mb-1.5"
                            style={{ color: "var(--foreground-subtle)" }}
                          >
                            Linked Documents ({docs.length})
                          </p>
                          {docs.length === 0 ? (
                            <p
                              className="text-[11px] italic"
                              style={{ color: "var(--foreground-subtle)" }}
                            >
                              No documents linked yet.
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {docs.map((d) => (
                                <a
                                  key={d.sourceUrl}
                                  href={d.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--surface-1)] transition-colors"
                                >
                                  <FileText
                                    className="w-3 h-3 flex-shrink-0"
                                    style={{ color: "var(--foreground-subtle)" }}
                                  />
                                  <span
                                    className="text-xs flex-1 min-w-0 truncate"
                                    style={{ color: "var(--foreground)" }}
                                  >
                                    {d.title}
                                  </span>
                                  <span
                                    className="text-[10px]"
                                    style={{ color: "var(--foreground-muted)" }}
                                  >
                                    {d.chunkCount} chunks
                                  </span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {selectedMfr && !docsLoading && filteredGroups.length > 0 && (
          <div className="space-y-3">
            {filteredGroups.map((g) => {
              const isOpen = openTypes.has(g.equipmentType);
              return (
                <div
                  key={g.equipmentType}
                  className="card overflow-hidden"
                  style={{ backgroundColor: "var(--surface-1)" }}
                >
                  <button
                    onClick={() => toggleType(g.equipmentType)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-black/5 transition-colors"
                    aria-expanded={isOpen}
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: "var(--surface-2)" }}
                    >
                      <Layers
                        className="w-4 h-4"
                        style={{ color: "var(--brand-blue)" }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-semibold leading-tight"
                        style={{ color: "var(--foreground)" }}
                      >
                        {g.equipmentType}
                      </p>
                      <p
                        className="text-[11px] mt-0.5 truncate font-mono"
                        style={{ color: "var(--foreground-subtle)" }}
                      >
                        {g.unsPath}
                      </p>
                      <p
                        className="text-[11px] mt-0.5"
                        style={{ color: "var(--foreground-muted)" }}
                      >
                        {g.modelCount} {g.modelCount === 1 ? "model" : "models"} ·{" "}
                        {g.docCount} {g.docCount === 1 ? "manual" : "manuals"} ·{" "}
                        {formatNumber(g.chunkCount)} {t("chunks")}
                      </p>
                    </div>
                    <ChevronRight
                      className="w-4 h-4 flex-shrink-0 transition-transform"
                      style={{
                        color: "var(--foreground-muted)",
                        transform: isOpen ? "rotate(90deg)" : "none",
                      }}
                    />
                  </button>

                  {isOpen && (
                    <div
                      className="border-t px-3 py-2 space-y-3"
                      style={{ borderColor: "var(--border)" }}
                    >
                      {g.models.map((m) => (
                        <div key={`${g.equipmentType}-${m.modelNumber}`}>
                          <div className="flex items-baseline gap-2 mb-1">
                            <p
                              className="text-xs font-semibold"
                              style={{ color: "var(--foreground)" }}
                            >
                              {m.modelNumber}
                            </p>
                            <p
                              className="text-[11px]"
                              style={{ color: "var(--foreground-subtle)" }}
                            >
                              {m.docCount} {m.docCount === 1 ? "manual" : "manuals"} ·{" "}
                              {formatNumber(m.chunkCount)} {t("chunks")}
                            </p>
                          </div>
                          <p
                            className="text-[10px] mb-2 font-mono truncate"
                            style={{ color: "var(--foreground-subtle)" }}
                          >
                            {m.unsPath}
                          </p>
                          <div className="space-y-1.5">
                            {m.docs.map((d) => (
                              <div
                                key={d.sourceUrl + d.title}
                                className="flex items-start gap-2 p-2 rounded-md"
                                style={{ backgroundColor: "var(--surface-2)" }}
                              >
                                <FileText
                                  className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                                  style={{ color: "var(--brand-blue)" }}
                                />
                                <div className="flex-1 min-w-0">
                                  <p
                                    className="text-xs leading-snug font-medium"
                                    style={{ color: "var(--foreground)" }}
                                  >
                                    {d.title}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    {d.sourceType && (
                                      <span
                                        className="text-[10px]"
                                        style={{ color: "var(--foreground-subtle)" }}
                                      >
                                        {d.sourceType}
                                      </span>
                                    )}
                                    <span
                                      className="text-[10px]"
                                      style={{ color: "var(--foreground-subtle)" }}
                                    >
                                      · {d.chunkCount.toLocaleString()} {t("chunks")}
                                    </span>
                                  </div>
                                </div>
                                {d.sourceUrl && (
                                  <a
                                    href={d.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0"
                                    style={{ backgroundColor: "var(--surface-1)" }}
                                    aria-label="Open source"
                                  >
                                    <ChevronRight
                                      className="w-3.5 h-3.5"
                                      style={{ color: "var(--foreground-muted)" }}
                                    />
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && !selectedMfr && filteredMfrs.length === 0 && uploads.length === 0 && (
          search.trim() ? (
            // Full-text content search results — shown when no manufacturer name matches.
            <div>
              {contentSearching && (
                <div className="text-center py-8">
                  <Clock
                    className="w-6 h-6 mx-auto mb-2 animate-spin"
                    style={{ color: "var(--foreground-subtle)" }}
                  />
                  <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                    Searching document content…
                  </p>
                </div>
              )}
              {!contentSearching && contentResults.length > 0 && (
                <div className="space-y-2">
                  <p
                    className="text-[11px] uppercase tracking-wider font-semibold mb-2"
                    style={{ color: "var(--foreground-subtle)" }}
                  >
                    Document content results ({contentResults.length})
                  </p>
                  {contentResults.map((r) => (
                    <button
                      key={r.sourceUrl}
                      onClick={() => openManufacturer(r.manufacturer)}
                      className="w-full text-left p-3 rounded-lg border transition-colors hover:opacity-80"
                      style={{
                        backgroundColor: "var(--surface-1)",
                        borderColor: "var(--border)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p
                            className="text-sm font-medium truncate"
                            style={{ color: "var(--foreground)" }}
                          >
                            {r.title}
                          </p>
                          <p
                            className="text-[11px] mt-0.5"
                            style={{ color: "var(--foreground-subtle)" }}
                          >
                            {r.manufacturer}
                            {r.modelNumber ? ` · ${r.modelNumber}` : ""}
                            {r.sourceType ? ` · ${r.sourceType}` : ""}
                          </p>
                          {r.snippet && (
                            <p
                              className="text-[11px] mt-1.5 line-clamp-2"
                              style={{ color: "var(--foreground-muted)" }}
                            >
                              {r.snippet}
                            </p>
                          )}
                        </div>
                        <ChevronRight
                          className="w-4 h-4 flex-shrink-0 mt-0.5"
                          style={{ color: "var(--foreground-subtle)" }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!contentSearching && contentResults.length === 0 && (
                <div className="text-center py-10">
                  <FileText
                    className="w-8 h-8 mx-auto mb-3"
                    style={{ color: "var(--foreground-subtle)" }}
                  />
                  <p className="text-sm font-semibold mb-1" style={{ color: "var(--foreground)" }}>
                    No matching documents
                  </p>
                  <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                    No manufacturers or document content matched &quot;{search}&quot;.
                  </p>
                  <button
                    onClick={() => setPickerOpen(true)}
                    className="mt-4 text-xs font-medium underline underline-offset-2"
                    style={{ color: "var(--brand-blue)" }}
                  >
                    Upload a manual
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full flex flex-col items-center justify-center text-center py-10 px-6 rounded-xl border-2 border-dashed transition-colors hover:bg-[var(--surface-1)]"
              style={{ borderColor: "var(--border)" }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                style={{ backgroundColor: "var(--surface-1)" }}
              >
                <Upload
                  className="w-6 h-6"
                  style={{ color: "var(--brand-blue)" }}
                />
              </div>
              <p
                className="text-sm font-semibold mb-1"
                style={{ color: "var(--foreground)" }}
              >
                {t("noDocuments")}
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--foreground-muted)" }}
              >
                Tap to upload a PDF manual or photo — PDF, JPEG, PNG up to {MAX_UPLOAD_MB} MB.
              </p>
            </button>
          )
        )}

        {selectedMfr && !docsLoading && filteredGroups.length === 0 && (
          <div className="text-center py-16">
            <FileText
              className="w-10 h-10 mx-auto mb-3"
              style={{ color: "var(--foreground-subtle)" }}
            />
            <p style={{ color: "var(--foreground-muted)" }}>{t("noDocuments")}</p>
          </div>
        )}

        {(loading || docsLoading) && (
          <div className="text-center py-16">
            <Clock
              className="w-8 h-8 mx-auto mb-3 animate-spin"
              style={{ color: "var(--foreground-subtle)" }}
            />
            <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>
              Loading…
            </p>
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
