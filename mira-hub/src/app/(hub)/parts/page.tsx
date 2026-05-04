"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search, Package, ChevronRight, AlertCircle, AlertTriangle, CheckCircle2, ChevronsUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PARTS, CATEGORIES, OEMS, getStockStatus } from "@/lib/parts-data";

const STOCK_CONFIG = {
  ok:  { color: "#16A34A", bg: "#DCFCE7", Icon: CheckCircle2, badgeVariant: "green"  as const },
  low: { color: "#EAB308", bg: "#FEF9C3", Icon: AlertTriangle, badgeVariant: "yellow" as const },
  out: { color: "#DC2626", bg: "#FEE2E2", Icon: AlertCircle,   badgeVariant: "red"    as const },
};

const STATUS_FILTER_KEYS = ["all", "ok", "low", "out"] as const;

type SortCol = "description" | "qtyOnHand" | "unitCost" | "status";
type SortDir = "asc" | "desc";

export default function PartsPage() {
  const t = useTranslations("parts");
  const tCommon = useTranslations("common");
  const [query, setQuery]         = useState("");
  const [oem, setOem]             = useState("all");
  const [category, setCategory]   = useState("all");
  const [stockFilter, setStock]   = useState("all");
  const [sortCol, setSortCol]     = useState<SortCol | null>(null);
  const [sortDir, setSortDir]     = useState<SortDir>("asc");

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  const filtered = PARTS.filter(p => {
    const status = getStockStatus(p);
    const matchQ    = !query   || p.description.toLowerCase().includes(query.toLowerCase()) || p.partNumber.toLowerCase().includes(query.toLowerCase());
    const matchOem  = oem === "all"      || p.oem === oem;
    const matchCat  = category === "all" || p.category === category;
    const matchStock = stockFilter === "all" || status === stockFilter;
    return matchQ && matchOem && matchCat && matchStock;
  });

  const STATUS_ORDER = { out: 0, low: 1, ok: 2 };
  const visible = sortCol ? [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "description") cmp = a.description.localeCompare(b.description);
    else if (sortCol === "qtyOnHand") cmp = a.qtyOnHand - b.qtyOnHand;
    else if (sortCol === "unitCost") cmp = a.unitCost - b.unitCost;
    else if (sortCol === "status") cmp = STATUS_ORDER[getStockStatus(a)] - STATUS_ORDER[getStockStatus(b)];
    return sortDir === "asc" ? cmp : -cmp;
  }) : filtered;

  const STOCK_LABELS = {
    ok:  t("stockStatus.ok"),
    low: t("stockStatus.low"),
    out: t("stockStatus.out"),
  };

  const outCount = PARTS.filter(p => getStockStatus(p) === "out").length;
  const lowCount = PARTS.filter(p => getStockStatus(p) === "low").length;

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
              <div className="flex gap-2 mt-0.5">
                {outCount > 0 && <span className="text-[11px] font-medium" style={{ color: "var(--status-red)" }}>{outCount} {t("filters.out")}</span>}
                {lowCount > 0 && <span className="text-[11px] font-medium" style={{ color: "var(--status-yellow)" }}>{lowCount} {t("filters.low")}</span>}
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
            <Input placeholder={t("searchPlaceholder")} value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
          </div>

          {/* Filter row */}
          <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
            {/* Stock status */}
            {STATUS_FILTER_KEYS.map(key => (
              <button key={key} onClick={() => setStock(key)}
                className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                style={{ backgroundColor: stockFilter === key ? "var(--brand-blue)" : "var(--surface-1)", color: stockFilter === key ? "white" : "var(--foreground-muted)" }}>
                {key === "all" ? t("filters.all") : key === "ok" ? t("stockStatus.ok") : key === "low" ? t("filters.low") : t("filters.out")}
              </button>
            ))}
            <div className="w-px h-5 self-center" style={{ backgroundColor: "var(--border)" }} />
            {/* OEM */}
            <select value={oem} onChange={e => setOem(e.target.value)}
              className="flex-shrink-0 text-xs px-2 py-1.5 rounded-lg border cursor-pointer"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground-muted)" }}>
              <option value="all">{t("filters.all")} OEMs</option>
              {OEMS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {/* Category */}
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="flex-shrink-0 text-xs px-2 py-1.5 rounded-lg border cursor-pointer"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground-muted)" }}>
              <option value="all">{t("filters.all")} Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="px-4 md:px-6 py-4">
        {visible.length === 0 ? (
          <div className="text-center py-20">
            <Package className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
            <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>{t("noParts")}</p>
            <p className="text-xs mt-1" style={{ color: "var(--foreground-subtle)" }}>Try clearing filters or a different search</p>
          </div>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: "var(--foreground-muted)" }}>{visible.length} part{visible.length !== 1 ? "s" : ""}</p>

            {/* Mobile: Cards */}
            <div className="md:hidden space-y-3">
              {visible.map(part => <PartCard key={part.id} part={part} />)}
            </div>

            {/* Desktop: Table */}
            <div className="hidden md:block card overflow-hidden">
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: "var(--surface-1)", borderBottom: "1px solid var(--border)" }}>
                  <tr>
                    {[
                      { label: t("partNumber"), col: null },
                      { label: t("description"), col: "description" as SortCol },
                      { label: "OEM", col: null },
                      { label: "Category", col: null },
                      { label: t("qtyOnHand"), col: "qtyOnHand" as SortCol },
                      { label: t("reorderPoint"), col: null },
                      { label: t("unitCost"), col: "unitCost" as SortCol },
                      { label: t("location"), col: null },
                      { label: tCommon("status"), col: "status" as SortCol },
                      { label: "", col: null },
                    ].map(({ label, col }) => (
                      <th key={label} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--foreground-muted)" }}>
                        {col ? (
                          <button onClick={() => handleSort(col)} className="flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                            {label}
                            {sortCol === col
                              ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                              : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
                          </button>
                        ) : label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {visible.map(part => {
                    const status = getStockStatus(part);
                    const cfg = STOCK_CONFIG[status];
                    return (
                      <tr key={part.id} className="hover:bg-[var(--surface-1)] transition-colors"
                        style={{ backgroundColor: status === "out" ? "#FFF5F5" : status === "low" ? "#FFFBEB" : undefined }}>
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--foreground-subtle)" }}>{part.partNumber}</td>
                        <td className="px-4 py-3 font-medium" style={{ color: "var(--foreground)" }}>{part.description}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--foreground-muted)" }}>{part.oem}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--foreground-muted)" }}>{part.category}</td>
                        <td className="px-4 py-3 font-bold" style={{ color: cfg.color }}>{part.qtyOnHand}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--foreground-muted)" }}>{part.reorderPoint}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--foreground-muted)" }}>${part.unitCost.toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--foreground-subtle)" }}>{part.location}</td>
                        <td className="px-4 py-3">
                          <Badge variant={cfg.badgeVariant} className="text-[10px] gap-1">
                            <cfg.Icon className="w-2.5 h-2.5" />
                            {STOCK_LABELS[status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/parts/${part.id}`} className="text-xs font-medium" style={{ color: "var(--brand-blue)" }}>
                            {tCommon("details")} →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PartCard({ part }: { part: typeof PARTS[number] }) {
  const t = useTranslations("parts");
  const status = getStockStatus(part);
  const cfg = STOCK_CONFIG[status];
  const stockLabel = status === "ok" ? t("stockStatus.ok") : status === "low" ? t("stockStatus.low") : t("stockStatus.out");
  return (
    <Link href={`/parts/${part.id}`}>
      <div className="card p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: cfg.bg }}>
          <Package className="w-5 h-5" style={{ color: cfg.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>{part.description}</p>
          <p className="text-[11px] font-mono" style={{ color: "var(--foreground-subtle)" }}>{part.partNumber}</p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={cfg.badgeVariant} className="text-[10px]">{stockLabel}</Badge>
            <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>{t("qtyOnHand")}: {part.qtyOnHand} · {part.location}</span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
      </div>
    </Link>
  );
}
