"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search, FileText, BookOpen, Zap, ShieldCheck, ClipboardCheck, Truck, MapPin, Bot, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DOCS, CAT_COLOR, CAT_BG } from "@/lib/documents-data";

const CATEGORIES = [
  { key: "all",        labelKey: "filterLabels.all",        Icon: FileText,       color: "#2563EB" },
  { key: "Manuals",    labelKey: "filterLabels.manuals",    Icon: BookOpen,       color: "#7C3AED" },
  { key: "Schematics", labelKey: "filterLabels.schematics", Icon: Zap,            color: "#0891B2" },
  { key: "Parts",      labelKey: "filterLabels.parts",      Icon: ClipboardCheck, color: "#EA580C" },
  { key: "Safety",     labelKey: "filterLabels.safety",     Icon: ShieldCheck,    color: "#DC2626" },
  { key: "Inspection", labelKey: "filterLabels.inspection", Icon: ClipboardCheck, color: "#16A34A" },
  { key: "Vendor",     labelKey: "filterLabels.vendor",     Icon: Truck,          color: "#64748B" },
  { key: "Site",       labelKey: "filterLabels.site",       Icon: MapPin,         color: "#EAB308" },
  { key: "MIRA",       labelKey: "filterLabels.mira",       Icon: Bot,            color: "#16A34A" },
];

const DOC_STATE_VARIANT: Record<string, "indexed" | "partial" | "superseded"> = {
  indexed: "indexed", partial: "partial", superseded: "superseded",
};

export default function DocumentsPage() {
  const t = useTranslations("documents");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const visible = DOCS.filter((d) => {
    const matchCat = category === "all" || d.category === category;
    const matchQ = !query || d.title.toLowerCase().includes(query.toLowerCase()) || d.assets.some(a => a.toLowerCase().includes(query.toLowerCase()));
    return matchCat && matchQ;
  });

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Upload className="w-3.5 h-3.5" />{t("upload")}
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
            <Input placeholder={t("searchPlaceholder")} value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row">
        {/* Category sidebar (desktop) / chips (mobile) */}
        <div className="md:w-52 md:flex-shrink-0 px-4 md:px-4 py-4">
          <div className="flex md:hidden gap-2 overflow-x-auto scrollbar-none pb-1">
            {CATEGORIES.map((cat) => (
              <button key={cat.key} onClick={() => setCategory(cat.key)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                style={{ backgroundColor: category === cat.key ? cat.color : "var(--surface-1)", color: category === cat.key ? "white" : "var(--foreground-muted)" }}>
                <cat.Icon className="w-3 h-3" />{t(cat.labelKey)}
              </button>
            ))}
          </div>

          <div className="hidden md:flex flex-col gap-1">
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-2 px-2" style={{ color: "var(--foreground-subtle)" }}>{t("categoriesHeading")}</p>
            {CATEGORIES.map((cat) => {
              const count = cat.key === "all" ? DOCS.length : DOCS.filter(d => d.category === cat.key).length;
              return (
                <button key={cat.key} onClick={() => setCategory(cat.key)}
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all text-left"
                  style={{ backgroundColor: category === cat.key ? cat.color + "15" : "transparent", color: category === cat.key ? cat.color : "var(--foreground-muted)", fontWeight: category === cat.key ? 600 : 400 }}>
                  <span className="flex items-center gap-2">
                    <cat.Icon className="w-3.5 h-3.5 flex-shrink-0" />{t(cat.labelKey)}
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
              <Link key={doc.id} href={`/documents/${doc.id}`}>
                <div className="card card-hover p-4 flex flex-col gap-3 hover:shadow-md transition-shadow cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: CAT_BG[doc.category] ?? "#F8FAFC" }}>
                      <FileText className="w-5 h-5" style={{ color: CAT_COLOR[doc.category] ?? "#64748B" }} />
                    </div>
                    <Badge variant={DOC_STATE_VARIANT[doc.state]} className="capitalize text-[10px]">{doc.state}</Badge>
                  </div>

                  <div className="flex-1">
                    <p className="text-sm font-medium leading-snug" style={{ color: "var(--foreground)" }}>{doc.title}</p>
                    <p className="text-[11px] mt-1" style={{ color: "var(--foreground-subtle)" }}>
                      {doc.pages}p · {doc.size} · {doc.date}
                    </p>
                  </div>

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
                </div>
              </Link>
            ))}
          </div>

          {visible.length === 0 && (
            <div className="text-center py-16">
              <FileText className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
              <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>{t("noDocuments")}</p>
              <p className="text-xs mt-1" style={{ color: "var(--foreground-subtle)" }}>{t("tryDifferent")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
