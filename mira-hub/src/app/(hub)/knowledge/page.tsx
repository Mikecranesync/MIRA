"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, BookOpen, FileText, Upload, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

type IndexStatus = "indexed" | "indexing" | "failed" | "pending";

type KnowledgeDoc = {
  id: string;
  title: string;
  category: string;
  categoryKey: string;
  asset: string | null;
  pages: number;
  indexed: IndexStatus;
  indexedChunks: number;
  totalChunks: number;
  lastUpdated: string;
  size: string;
  source: string;
};

const DOCUMENTS: KnowledgeDoc[] = [
  { id: "d01", title: "Air Compressor #1 OEM Manual",         category: "Equipment Manual",     categoryKey: "manual",     asset: "Air Compressor #1", pages: 124, indexed: "indexed",  indexedChunks: 487, totalChunks: 487, lastUpdated: "Mar 15", size: "8.2 MB",  source: "Manual upload" },
  { id: "d02", title: "Conveyor Belt #3 Maintenance Manual",  category: "Equipment Manual",     categoryKey: "manual",     asset: "Conveyor Belt #3",  pages: 89,  indexed: "indexed",  indexedChunks: 312, totalChunks: 312, lastUpdated: "Feb 28", size: "5.4 MB",  source: "Manual upload" },
  { id: "d03", title: "HVAC Unit #2 Installation Guide",      category: "Equipment Manual",     categoryKey: "manual",     asset: "HVAC Unit #2",      pages: 67,  indexed: "indexed",  indexedChunks: 218, totalChunks: 218, lastUpdated: "Jan 10", size: "3.1 MB",  source: "Manual upload" },
  { id: "d04", title: "Arc Flash Safety Procedures",          category: "Safety",              categoryKey: "safety",     asset: null,                pages: 34,  indexed: "indexed",  indexedChunks: 128, totalChunks: 128, lastUpdated: "Apr 1",  size: "1.8 MB",  source: "Safety team" },
  { id: "d05", title: "CNC Mill #7 Vibration Analysis Guide", category: "Equipment Manual",     categoryKey: "manual",     asset: "CNC Mill #7",       pages: 45,  indexed: "indexed",  indexedChunks: 167, totalChunks: 167, lastUpdated: "Mar 22", size: "2.9 MB",  source: "OEM download" },
  { id: "d06", title: "LOTO Procedures — All Panels",         category: "Safety",              categoryKey: "safety",     asset: null,                pages: 28,  indexed: "indexed",  indexedChunks: 94,  totalChunks: 94,  lastUpdated: "Apr 1",  size: "1.2 MB",  source: "Safety team" },
  { id: "d07", title: "Pump Station A Seal Replacement",      category: "Procedure",           categoryKey: "procedure",  asset: "Pump Station A",    pages: 12,  indexed: "indexed",  indexedChunks: 48,  totalChunks: 48,  lastUpdated: "Feb 14", size: "0.8 MB",  source: "Manual upload" },
  { id: "d08", title: "Q1 Maintenance Report",                category: "Report",              categoryKey: "report",     asset: null,                pages: 22,  indexed: "indexed",  indexedChunks: 82,  totalChunks: 82,  lastUpdated: "Apr 5",  size: "1.5 MB",  source: "Auto-generated" },
  { id: "d09", title: "Generator #1 Load Test Checklist",     category: "Procedure",           categoryKey: "procedure",  asset: "Generator #1",      pages: 8,   indexed: "indexed",  indexedChunks: 31,  totalChunks: 31,  lastUpdated: "Mar 1",  size: "0.5 MB",  source: "Manual upload" },
  { id: "d10", title: "Press #2 OEM Manual",                  category: "Equipment Manual",     categoryKey: "manual",     asset: "Press #2",          pages: 156, indexed: "indexing", indexedChunks: 312, totalChunks: 590, lastUpdated: "Today",  size: "12.4 MB", source: "OEM download" },
  { id: "d11", title: "NFPA 110 Generator Standards",         category: "Regulation",          categoryKey: "regulation", asset: null,                pages: 48,  indexed: "pending",  indexedChunks: 0,   totalChunks: 180, lastUpdated: "Today",  size: "3.2 MB",  source: "Import queue" },
  { id: "d12", title: "Boiler Unit B Combustion Manual",      category: "Equipment Manual",     categoryKey: "manual",     asset: "Boiler Unit B",     pages: 203, indexed: "failed",   indexedChunks: 47,  totalChunks: 780, lastUpdated: "Today",  size: "18.7 MB", source: "Manual upload" },
];

const CATEGORIES = [
  { label: "All",            key: "all" },
  { label: "Equipment",      key: "manual" },
  { label: "Safety",         key: "safety" },
  { label: "Procedures",     key: "procedure" },
  { label: "Reports",        key: "report" },
  { label: "Regulations",    key: "regulation" },
];

const INDEX_CFG: Record<IndexStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  indexed:  { label: "Indexed",   color: "#16A34A", bg: "#DCFCE7", Icon: CheckCircle2 },
  indexing: { label: "Indexing…", color: "#2563EB", bg: "#EFF6FF", Icon: Clock },
  pending:  { label: "Pending",   color: "#EAB308", bg: "#FEF9C3", Icon: Clock },
  failed:   { label: "Failed",    color: "#DC2626", bg: "#FEF2F2", Icon: AlertCircle },
};

export default function KnowledgePage() {
  const t = useTranslations("knowledge");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const filtered = DOCUMENTS.filter(d =>
    (category === "all" || d.categoryKey === category) &&
    (search === "" || d.title.toLowerCase().includes(search.toLowerCase()) ||
      (d.asset?.toLowerCase().includes(search.toLowerCase()) ?? false))
  );

  const indexedCount  = DOCUMENTS.filter(d => d.indexed === "indexed").length;
  const totalChunks   = DOCUMENTS.filter(d => d.indexed === "indexed").reduce((s, d) => s + d.indexedChunks, 0);

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
              {indexedCount} {t("indexed")} · {totalChunks.toLocaleString()} {t("chunks")} {t("inRAG")}
            </p>
          </div>
          <button className="flex items-center gap-1.5 text-xs font-medium h-8 px-3 rounded-lg"
            style={{ backgroundColor: "var(--brand-blue)", color: "white" }}>
            <Upload className="w-3.5 h-3.5" />
            {t("upload")}
          </button>
        </div>

        <div className="px-4 md:px-6 pb-2">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t("search")}
              className="w-full h-9 pl-9 pr-3 rounded-lg border text-sm"
              style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border)", color: "var(--foreground)" }} />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {CATEGORIES.map(cat => (
              <button key={cat.key} onClick={() => setCategory(cat.key)}
                className="flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all"
                style={category === cat.key
                  ? { backgroundColor: "var(--brand-blue)", color: "white" }
                  : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 max-w-3xl mx-auto space-y-2">
        {filtered.map(doc => {
          const idx = INDEX_CFG[doc.indexed];
          const IdxIcon = idx.Icon;
          const pct = doc.totalChunks > 0 ? Math.round((doc.indexedChunks / doc.totalChunks) * 100) : 0;

          return (
            <Link key={doc.id} href={`/documents/${doc.id}`}
              className="card p-4 flex items-start gap-3 hover:bg-[var(--surface-1)] transition-colors block">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ backgroundColor: "var(--surface-1)" }}>
                <FileText className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-snug" style={{ color: "var(--foreground)" }}>
                  {doc.title}
                </p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>{doc.category}</span>
                  {doc.asset && (
                    <span className="text-[11px] font-medium" style={{ color: "var(--brand-blue)" }}>· {doc.asset}</span>
                  )}
                  <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>· {doc.pages}pp · {doc.size}</span>
                </div>

                {/* Index status bar */}
                <div className="flex items-center gap-2 mt-2">
                  <IdxIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: idx.color }} />
                  <span className="text-[11px] font-medium" style={{ color: idx.color }}>{idx.label}</span>
                  {doc.indexed !== "indexed" && doc.totalChunks > 0 && (
                    <>
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-2)" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: idx.color }} />
                      </div>
                      <span className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>{pct}%</span>
                    </>
                  )}
                  {doc.indexed === "indexed" && (
                    <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
                      {doc.indexedChunks.toLocaleString()} {t("chunks")} · {t("source")}: {doc.source}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <BookOpen className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
            <p style={{ color: "var(--foreground-muted)" }}>{t("noDocuments")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
