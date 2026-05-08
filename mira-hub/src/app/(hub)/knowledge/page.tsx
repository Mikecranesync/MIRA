"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, BookOpen, FileText, Upload, Clock, ChevronRight, ArrowLeft, Factory } from "lucide-react";
import { useTranslations } from "next-intl";
import { UploadPicker } from "@/components/UploadPicker";
import { UploadBlock, type UploadBlockData } from "@/components/UploadBlock";
import { API_BASE } from "@/lib/config";

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
  equipmentType: string | null;
  chunkCount: number;
  lastIndexed: string | null;
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

  const [selectedMfr, setSelectedMfr] = useState<string | null>(null);
  const [docs, setDocs] = useState<ManualDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // Tick every 15s so "Last updated" relative time stays current between polls.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => clearInterval(iv);
  }, []);

  const fetchManufacturers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/knowledge`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setManufacturers(data.manufacturers ?? []);
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
  // Ensures newly-ingested chunks (Celery worker, kb_growth_cron) appear
  // without manual reload. Pauses while drilled into a manufacturer detail
  // view to avoid re-fetching the list mid-interaction.
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
    setDocs([]);
    setDocsLoading(true);
    fetch(`${API_BASE}/api/knowledge/manufacturer?name=${encodeURIComponent(name)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => setDocs(data.docs ?? []))
      .catch(console.error)
      .finally(() => setDocsLoading(false));
  }, []);

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
      const res = await fetch(`${API_BASE}/api/uploads/local`, {
        method: "POST",
        body: form,
      });
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

  const filteredMfrs = manufacturers.filter(
    (m) => search === "" || m.name.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredDocs = docs.filter(
    (d) =>
      search === "" ||
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      (d.modelNumber?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      d.sourceUrl.toLowerCase().includes(search.toLowerCase()),
  );

  const headerSubtitle = loading
    ? "Loading…"
    : selectedMfr
      ? docsLoading
        ? `Loading ${selectedMfr}…`
        : `${selectedMfr} · ${docs.length} ${docs.length === 1 ? "document" : "documents"}`
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
                  setDocs([]);
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
              placeholder={selectedMfr ? `Search ${selectedMfr} documents…` : t("search")}
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
        {!selectedMfr && (
          <div className="space-y-2 mb-4">
            {uploads.map((u) => (
              <UploadBlock key={u.id} upload={u} onDelete={handleDeleteUpload} />
            ))}
          </div>
        )}

        {!selectedMfr && !loading && filteredMfrs.length > 0 && (
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
        )}

        {selectedMfr && !docsLoading && filteredDocs.length > 0 && (
          <div className="space-y-2">
            {filteredDocs.map((d) => (
              <div
                key={d.sourceUrl + d.title}
                className="card p-4 flex items-start gap-3"
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: "var(--surface-1)" }}
                >
                  <FileText
                    className="w-4 h-4"
                    style={{ color: "var(--brand-blue)" }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-semibold leading-snug"
                    style={{ color: "var(--foreground)" }}
                  >
                    {d.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {d.modelNumber && (
                      <span
                        className="text-[11px] font-medium"
                        style={{ color: "var(--brand-blue)" }}
                      >
                        {d.modelNumber}
                      </span>
                    )}
                    {d.equipmentType && (
                      <span
                        className="text-[11px]"
                        style={{ color: "var(--foreground-subtle)" }}
                      >
                        · {d.equipmentType}
                      </span>
                    )}
                    {d.sourceType && (
                      <span
                        className="text-[11px]"
                        style={{ color: "var(--foreground-subtle)" }}
                      >
                        · {d.sourceType}
                      </span>
                    )}
                  </div>
                  <p
                    className="text-[11px] mt-1.5"
                    style={{ color: "var(--foreground-muted)" }}
                  >
                    {d.chunkCount.toLocaleString()} {t("chunks")}
                  </p>
                </div>
                {d.sourceUrl && (
                  <a
                    href={d.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
                    style={{ backgroundColor: "var(--surface-1)" }}
                    aria-label="Open source"
                  >
                    <ChevronRight
                      className="w-4 h-4"
                      style={{ color: "var(--foreground-muted)" }}
                    />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && !selectedMfr && filteredMfrs.length === 0 && uploads.length === 0 && (
          <div className="text-center py-16">
            <BookOpen
              className="w-10 h-10 mx-auto mb-3"
              style={{ color: "var(--foreground-subtle)" }}
            />
            <p style={{ color: "var(--foreground-muted)" }}>{t("noDocuments")}</p>
          </div>
        )}

        {selectedMfr && !docsLoading && filteredDocs.length === 0 && (
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
