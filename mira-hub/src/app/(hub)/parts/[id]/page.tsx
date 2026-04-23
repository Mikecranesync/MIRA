"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, Package, Bot, TrendingUp, TrendingDown, MapPin, DollarSign, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PARTS, getStockStatus } from "@/lib/parts-data";

const STOCK_CONFIG = {
  ok:  { labelKey: "stockStatus.ok",  color: "#16A34A", bg: "#DCFCE7", badgeVariant: "green"  as const },
  low: { labelKey: "stockStatus.low", color: "#EAB308", bg: "#FEF9C3", badgeVariant: "yellow" as const },
  out: { labelKey: "stockStatus.out", color: "#DC2626", bg: "#FEE2E2", badgeVariant: "red"    as const },
};

export default function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("parts");
  const tc = useTranslations("common");
  const part = PARTS.find(p => p.id === id) ?? PARTS[0];
  const status = getStockStatus(part);
  const cfg = STOCK_CONFIG[status];

  const totalValue = (part.qtyOnHand * part.unitCost).toFixed(2);

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b px-4 md:px-6 py-3"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <Link href="/parts" className="inline-flex items-center gap-1 text-xs mb-2" style={{ color: "var(--brand-blue)" }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Parts Inventory
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold leading-snug" style={{ color: "var(--foreground)" }}>{part.description}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs font-mono" style={{ color: "var(--foreground-subtle)" }}>{part.partNumber}</span>
              <Badge variant={cfg.badgeVariant} className="text-[10px]">{t(cfg.labelKey)}</Badge>
              <Badge variant="secondary" className="text-[10px]">{part.category}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-5 max-w-2xl space-y-5">
        {/* Ask MIRA CTA */}
        <a href="https://t.me/FactoryLMDiagnose_bot" target="_blank" rel="noopener noreferrer">
          <Button className="w-full h-11 gap-2 font-semibold"
            style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}>
            <Bot className="w-4 h-4" />
            Ask MIRA About This Part
          </Button>
        </a>

        {/* Photo placeholder */}
        <div className="card aspect-video flex flex-col items-center justify-center gap-2"
          style={{ backgroundColor: "var(--surface-1)" }}>
          <Package className="w-12 h-12" style={{ color: "var(--foreground-subtle)" }} />
          <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>No photo on file</p>
          <button className="text-xs font-medium" style={{ color: "var(--brand-blue)" }}>+ {tc("add")}</button>
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "OEM / Manufacturer",   value: part.oem,              Icon: Package },
            { label: "Category",             value: part.category,         Icon: Package },
            { label: t("location"),          value: part.location,         Icon: MapPin },
            { label: t("unitCost"),          value: `$${part.unitCost.toFixed(2)}`, Icon: DollarSign },
            { label: t("qtyOnHand"),         value: String(part.qtyOnHand), Icon: Package },
            { label: t("reorderPoint"),      value: String(part.reorderPoint), Icon: RotateCcw },
            { label: "Stock Value",          value: `$${totalValue}`,       Icon: DollarSign },
            { label: "Stock Status",          value: t(cfg.labelKey),        Icon: Package },
          ].map(({ label, value, Icon }) => (
            <div key={label} className="card p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="w-3 h-3" style={{ color: "var(--foreground-subtle)" }} />
                <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--foreground-subtle)" }}>{label}</span>
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Linked assets */}
        {part.linkedAssets.length > 0 && (
          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-muted)" }}>Used In</h3>
            <div className="flex flex-wrap gap-2">
              {part.linkedAssets.map(asset => (
                <Link key={asset} href="/assets"
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                  style={{ backgroundColor: "var(--surface-1)", color: "var(--brand-blue)" }}>
                  {asset}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Stock history */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-muted)" }}>Stock History</h3>
          <div className="space-y-3">
            {part.stockHistory.map((evt, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {evt.change > 0
                    ? <TrendingUp className="w-4 h-4 flex-shrink-0" style={{ color: "#16A34A" }} />
                    : <TrendingDown className="w-4 h-4 flex-shrink-0" style={{ color: "#DC2626" }} />
                  }
                  <div>
                    <p className="text-xs" style={{ color: "var(--foreground)" }}>{evt.reason}</p>
                    <p className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>{evt.date}</p>
                  </div>
                </div>
                <span className="text-sm font-bold" style={{ color: evt.change > 0 ? "#16A34A" : "#DC2626" }}>
                  {evt.change > 0 ? "+" : ""}{evt.change}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
