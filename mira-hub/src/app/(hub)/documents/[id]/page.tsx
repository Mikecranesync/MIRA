"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, FileText, Bot, Download, ExternalLink, AlertTriangle, Clock, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DOCS, CAT_COLOR, CAT_BG } from "@/lib/documents-data";

const STATE_VARIANT: Record<string, "indexed" | "partial" | "superseded"> = {
  indexed: "indexed", partial: "partial", superseded: "superseded",
};

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("documents");
  const tc = useTranslations("common");
  const doc = DOCS.find(d => d.id === id) ?? DOCS[0];

  const catColor = CAT_COLOR[doc.category] ?? "#64748B";
  const catBg = CAT_BG[doc.category] ?? "#F8FAFC";

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <Link href="/documents" className="inline-flex items-center gap-1 text-xs mb-2" style={{ color: "var(--brand-blue)" }}>
            <ArrowLeft className="w-3.5 h-3.5" />{t("title")}
          </Link>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: catBg }}>
              <FileText className="w-5 h-5" style={{ color: catColor }} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold leading-snug" style={{ color: "var(--foreground)" }}>{doc.title}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: catBg, color: catColor }}>
                  {doc.category}
                </span>
                <Badge variant={STATE_VARIANT[doc.state]} className="text-[10px] capitalize">{doc.state}</Badge>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-5 max-w-2xl space-y-4">
        {/* Superseded warning */}
        {doc.state === "superseded" && (
          <div className="flex items-start gap-2 p-3 rounded-xl" style={{ backgroundColor: "#FEF9C3" }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#EAB308" }} />
            <div>
              <p className="text-xs font-semibold" style={{ color: "#92400E" }}>{t("supersededTitle")}</p>
              <p className="text-xs mt-0.5" style={{ color: "#92400E" }}>{doc.revisionNote ?? t("supersededDefault")}</p>
            </div>
          </div>
        )}

        {/* Partial index warning */}
        {doc.state === "partial" && (
          <div className="flex items-start gap-2 p-3 rounded-xl" style={{ backgroundColor: "#EFF6FF" }}>
            <BookOpen className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#2563EB" }} />
            <p className="text-xs" style={{ color: "#1E40AF" }}>{doc.revisionNote ?? t("partialDefault")}</p>
          </div>
        )}

        {/* Ask MIRA */}
        <a href="https://t.me/FactoryLMDiagnose_bot" target="_blank" rel="noopener noreferrer">
          <Button className="w-full h-10 gap-2 text-sm font-semibold"
            style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}>
            <Bot className="w-4 h-4" />{t("askMira")}
          </Button>
        </a>

        {/* Document preview placeholder */}
        <div className="card aspect-video flex flex-col items-center justify-center gap-2" style={{ backgroundColor: "var(--surface-1)" }}>
          <FileText className="w-12 h-12" style={{ color: "var(--foreground-subtle)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--foreground-muted)" }}>{doc.title}</p>
          <p className="text-xs" style={{ color: "var(--foreground-subtle)" }}>{doc.pages} pages · {doc.size}</p>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <ExternalLink className="w-3.5 h-3.5" />{tc("open")}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Download className="w-3.5 h-3.5" />{tc("download")}
            </Button>
          </div>
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: t("metaCategory"), value: doc.category },
            { label: t("metaAdded"),    value: doc.date },
            { label: t("metaPages"),    value: String(doc.pages) },
            { label: t("metaFileSize"), value: doc.size },
          ].map(({ label, value }) => (
            <div key={label} className="card p-3">
              <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--foreground-subtle)" }}>{label}</p>
              <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Description */}
        {doc.description && (
          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--foreground-subtle)" }}>{t("aboutHeading")}</h3>
            <p className="text-sm leading-relaxed" style={{ color: "var(--foreground-muted)" }}>{doc.description}</p>
          </div>
        )}

        {/* Linked assets */}
        {doc.assets.length > 0 && (
          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-subtle)" }}>{t("linkedAssets")}</h3>
            <div className="flex flex-wrap gap-2">
              {doc.assets.map((asset, i) => (
                <Link key={asset} href={`/assets/${doc.assetIds[i] ?? "1"}`}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                  style={{ backgroundColor: "var(--surface-1)", color: "var(--brand-blue)" }}>
                  {asset}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Version history */}
        {doc.versions && doc.versions.length > 0 && (
          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-subtle)" }}>{t("versionHistory")}</h3>
            <div className="space-y-2">
              {doc.versions.map((v, i) => (
                <div key={v.rev} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3" style={{ color: "var(--foreground-subtle)" }} />
                    <span className="text-xs font-medium" style={{ color: "var(--foreground)" }}>{v.rev}</span>
                    <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>{v.note}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>{v.date}</span>
                    {i === 0 && <Badge variant="green" className="text-[10px]">{t("current")}</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
