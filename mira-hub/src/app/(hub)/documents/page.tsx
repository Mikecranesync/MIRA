"use client";

import { useState } from "react";
import { Search, FileText, BookOpen, Zap, ShieldCheck, ClipboardCheck, Truck, MapPin, Bot, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/* ─── Mock data ─────────────────────────────────────────────────────── */
const CATEGORIES = [
  { key: "all",          label: "All",            Icon: FileText,      color: "#2563EB" },
  { key: "Manuals",      label: "Manuals",        Icon: BookOpen,      color: "#7C3AED" },
  { key: "Schematics",   label: "Schematics",     Icon: Zap,           color: "#0891B2" },
  { key: "Parts",        label: "Parts Lists",    Icon: ClipboardCheck, color: "#EA580C" },
  { key: "Safety",       label: "Safety",         Icon: ShieldCheck,   color: "#DC2626" },
  { key: "Inspection",   label: "Inspection",     Icon: ClipboardCheck, color: "#16A34A" },
  { key: "Vendor",       label: "Vendor",         Icon: Truck,         color: "#64748B" },
  { key: "Site",         label: "Site-Specific",  Icon: MapPin,        color: "#EAB308" },
  { key: "MIRA",         label: "MIRA-Generated", Icon: Bot,           color: "#16A34A" },
];

const DOCS = [
  { id: "d01",  title: "Ingersoll Rand R55n — OEM Service Manual",      category: "Manuals",    state: "indexed",    assets: ["Air Compressor #1"], date: "2026-01-10", pages: 248, size: "4.2 MB" },
  { id: "d02",  title: "Conveyor Belt #3 — Electrical Schematic Rev B", category: "Schematics", state: "indexed",    assets: ["Conveyor Belt #3"],  date: "2025-11-20", pages: 12,  size: "1.1 MB" },
  { id: "d03",  title: "Spare Parts List — Ingersoll Rand R Series",    category: "Parts",      state: "partial",    assets: ["Air Compressor #1"], date: "2025-08-05", pages: 64,  size: "0.8 MB" },
  { id: "d04",  title: "LOTO Procedure — Panel E-12 Arc Flash",         category: "Safety",     state: "indexed",    assets: [],                   date: "2026-02-28", pages: 8,   size: "0.3 MB" },
  { id: "d05",  title: "Annual HVAC Inspection Checklist",              category: "Inspection", state: "indexed",    assets: ["HVAC Unit #2"],      date: "2026-01-15", pages: 4,   size: "0.1 MB" },
  { id: "d06",  title: "Haas VF-4SS — CNC Mill Service Manual",         category: "Manuals",    state: "indexed",    assets: ["CNC Mill #7"],       date: "2025-09-30", pages: 512, size: "18 MB" },
  { id: "d07",  title: "Grundfos CR Series — Installation Guide",       category: "Manuals",    state: "partial",    assets: ["Pump Station A"],   date: "2025-07-12", pages: 96,  size: "2.4 MB" },
  { id: "d08",  title: "Site Safety Manual — Lake Wales Plant",         category: "Site",       state: "indexed",    assets: [],                   date: "2025-12-01", pages: 44,  size: "1.8 MB" },
  { id: "d09",  title: "Carrier 50XC — OEM Manual Rev A (Superseded)",  category: "Manuals",    state: "superseded", assets: ["HVAC Unit #2"],      date: "2022-06-10", pages: 180, size: "3.1 MB" },
  { id: "d10",  title: "MIRA Diagnostic Report — Conveyor Belt #3",     category: "MIRA",       state: "indexed",    assets: ["Conveyor Belt #3"],  date: "2026-04-21", pages: 3,   size: "0.1 MB" },
  { id: "d11",  title: "Generator #1 — Vendor Service Agreement",       category: "Vendor",     state: "indexed",    assets: ["Generator #1"],      date: "2025-10-01", pages: 16,  size: "0.4 MB" },
  { id: "d12",  title: "Monthly PM Schedule — Q2 2026",                category: "Inspection", state: "indexed",    assets: [],                   date: "2026-04-01", pages: 2,   size: "0.05 MB" },
];

const DOC_STATE_VARIANT: Record<string, "indexed" | "partial" | "superseded"> = {
  indexed: "indexed", partial: "partial", superseded: "superseded",
};

const CAT_COLOR: Record<string, string> = {
  Manuals: "#7C3AED", Schematics: "#0891B2", Parts: "#EA580C", Safety: "#DC2626",
  Inspection: "#16A34A", Vendor: "#64748B", Site: "#EAB308", MIRA: "#16A34A",
};
const CAT_BG: Record<string, string> = {
  Manuals: "#F5F3FF", Schematics: "#ECFEFF", Parts: "#FFF7ED", Safety: "#FEF2F2",
  Inspection: "#F0FDF4", Vendor: "#F8FAFC", Site: "#FEFCE8", MIRA: "#F0FDF4",
};

export default function DocumentsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const visible = DOCS.filter((d) => {
    const matchCat = category === "all" || d.category === category;
    const matchQ = !query || d.title.toLowerCase().includes(query.toLowerCase()) || d.assets.some(a => a.toLowerCase().includes(query.toLowerCase()));
    return matchCat && matchQ;
  });

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Documents</h1>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Upload className="w-3.5 h-3.5" /> Upload
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: "var(--foreground-subtle)" }} />
            <Input placeholder="Search documents or linked assets…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row">
        {/* Category sidebar (desktop) / chips (mobile) */}
        <div className="md:w-52 md:flex-shrink-0 px-4 md:px-4 py-4">
          {/* Mobile: horizontal chips */}
          <div className="flex md:hidden gap-2 overflow-x-auto scrollbar-none pb-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setCategory(cat.key)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                style={{
                  backgroundColor: category === cat.key ? cat.color : "var(--surface-1)",
                  color: category === cat.key ? "white" : "var(--foreground-muted)",
                }}
              >
                <cat.Icon className="w-3 h-3" />
                {cat.label}
              </button>
            ))}
          </div>

          {/* Desktop: sidebar list */}
          <div className="hidden md:flex flex-col gap-1">
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-2 px-2"
              style={{ color: "var(--foreground-subtle)" }}>Categories</p>
            {CATEGORIES.map((cat) => {
              const count = cat.key === "all" ? DOCS.length : DOCS.filter(d => d.category === cat.key).length;
              return (
                <button
                  key={cat.key}
                  onClick={() => setCategory(cat.key)}
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all text-left"
                  style={{
                    backgroundColor: category === cat.key ? cat.color + "15" : "transparent",
                    color: category === cat.key ? cat.color : "var(--foreground-muted)",
                    fontWeight: category === cat.key ? 600 : 400,
                  }}
                >
                  <span className="flex items-center gap-2">
                    <cat.Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    {cat.label}
                  </span>
                  <span className="text-xs opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Document grid */}
        <div className="flex-1 px-4 md:px-6 py-4 md:pt-4">
          <p className="text-xs mb-4" style={{ color: "var(--foreground-muted)" }}>
            {visible.length} document{visible.length !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visible.map((doc) => (
              <div key={doc.id} className="card card-hover p-4 flex flex-col gap-3">
                {/* Icon + state badge */}
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: CAT_BG[doc.category] ?? "#F8FAFC" }}>
                    <FileText className="w-5 h-5" style={{ color: CAT_COLOR[doc.category] ?? "#64748B" }} />
                  </div>
                  <Badge variant={DOC_STATE_VARIANT[doc.state]} className="capitalize text-[10px]">
                    {doc.state}
                  </Badge>
                </div>

                {/* Title */}
                <div className="flex-1">
                  <p className="text-sm font-medium leading-snug" style={{ color: "var(--foreground)" }}>
                    {doc.title}
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: "var(--foreground-subtle)" }}>
                    {doc.pages}p · {doc.size} · {doc.date}
                  </p>
                </div>

                {/* Category + asset chips */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: CAT_BG[doc.category] ?? "#F8FAFC", color: CAT_COLOR[doc.category] ?? "#64748B" }}>
                    {doc.category}
                  </span>
                  {doc.assets.map(a => (
                    <span key={a} className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                      {a}
                    </span>
                  ))}
                </div>

                <Button variant="ghost" size="sm" className="w-full text-xs">Open in MIRA</Button>
              </div>
            ))}
          </div>

          {visible.length === 0 && (
            <div className="text-center py-16">
              <FileText className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
              <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>No documents match</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
