"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, BookOpen, FileText, Upload, CheckCircle2, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { UploadPicker } from "@/components/UploadPicker";
import { UploadBlock, type UploadBlockData } from "@/components/UploadBlock";

type IndexStatus = "indexed";

type KnowledgeDoc = {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  manufacturer: string | null;
  docType: string;
  source: string | null;
  chunkCount: number;
  avgQuality: number | null;
  lastIndexed: string;
  sampleTitles: string[];
  indexStatus: IndexStatus;
};

const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  electrical: "Electrical",
  mechanical: "Mechanical",
  pneumatic: "Pneumatic",
  safety: "Safety",
  general: "General",
  plc: "PLC",
  hvac: "HVAC",
};

const NON_TERMINAL: ReadonlyArray<UploadBlockData["status"]> = [
  "queued",
  "fetching",
  "parsing",
];

export default function KnowledgePage() {
  const t = useTranslations("knowledge");
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [stats, setStats] = useState({ totalChunks: 0, totalDocs: 0, categories: [] as string[] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [uploads, setUploads] = useState<UploadBlockData[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    fetch("/hub/api/knowledge")
      .then((r) => r.json())
      .then((data) => {
        setDocs(data.docs ?? []);
        setStats(data.stats ?? { totalChunks: 0, totalDocs: 0, categories: [] });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const fetchUploads = useCallback(async () => {
    try {
      const res = await fetch("/hub/api/uploads", { cache: "no-store" });
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
      const res = await fetch("/hub/api/uploads/local", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
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
      await fetch("/hub/api/uploads", {
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

  const categories = [
    { label: "All", key: "all" },
    ...stats.categories.map((c) => ({ label: CATEGORY_LABELS[c] ?? c, key: c })),
  ];

  const filtered = docs.filter(
    (d) =>
      (category === "all" || d.category === category) &&
      (search === "" ||
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        (d.manufacturer?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
        d.sampleTitles.some((t) => t.toLowerCase().includes(search.toLowerCase()))),
  );

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              {t("title")}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
              {loading
                ? "Loading…"
                : stats.totalDocs === 0
                ? t("emptyStateOnboarding")
                : `${stats.totalDocs} ${t("indexed")} · ${stats.totalChunks.toLocaleString()} ${t("chunks")} ${t("inRAG")}`}
            </p>
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium h-8 px-3 rounded-lg"
            style={{ backgroundColor: "var(--brand-blue)", color: "white" }}
          >
            <Upload className="w-3.5 h-3.5" />
            {t("upload")}
          </button>
        </div>

        <div className="px-4 md:px-6 pb-2">
          <div className="relative mb-2">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: "var(--foreground-subtle)" }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search")}
              className="w-full h-9 pl-9 pr-3 rounded-lg border text-sm"
              style={{
                backgroundColor: "var(--surface-1)",
                borderColor: "var(--border)",
                color: "var(--foreground)",
              }}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setCategory(cat.key)}
                className="flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all"
                style={
                  category === cat.key
                    ? { backgroundColor: "var(--brand-blue)", color: "white" }
                    : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }
                }
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 max-w-3xl mx-auto space-y-2">
        {uploads.map((u) => (
          <UploadBlock key={u.id} upload={u} onDelete={handleDeleteUpload} />
        ))}

        {filtered.map((doc) => (
          <div key={doc.id} className="card p-4 flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ backgroundColor: "var(--surface-1)" }}
            >
              <FileText className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-snug" style={{ color: "var(--foreground)" }}>
                {doc.name}
              </p>
              {doc.sampleTitles.length > 0 && (
                <p className="text-xs mt-0.5 truncate" style={{ color: "var(--foreground-subtle)" }}>
                  e.g. {doc.sampleTitles[0]}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-[11px] capitalize" style={{ color: "var(--foreground-subtle)" }}>
                  {doc.category}
                </span>
                {doc.manufacturer && (
                  <span className="text-[11px] font-medium" style={{ color: "var(--brand-blue)" }}>
                    · {doc.manufacturer}
                  </span>
                )}
                {doc.docType && (
                  <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
                    · {doc.docType}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 mt-2">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#16A34A" }} />
                <span className="text-[11px] font-medium" style={{ color: "#16A34A" }}>
                  {t("indexed")}
                </span>
                <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
                  {doc.chunkCount.toLocaleString()} {t("chunks")}
                  {doc.avgQuality ? ` · Q${doc.avgQuality}` : ""}
                </span>
              </div>
            </div>

            <div className="text-right flex-shrink-0">
              <span className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>
                {doc.chunkCount}
              </span>
              <p className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>
                {t("chunks")}
              </p>
            </div>
          </div>
        ))}

        {!loading && filtered.length === 0 && uploads.length === 0 && (
          <div className="text-center py-16">
            <BookOpen className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
            <p style={{ color: "var(--foreground-muted)" }}>{t("noDocuments")}</p>
          </div>
        )}

        {loading && (
          <div className="text-center py-16">
            <Clock className="w-8 h-8 mx-auto mb-3 animate-spin" style={{ color: "var(--foreground-subtle)" }} />
            <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>
              Loading knowledge base…
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
