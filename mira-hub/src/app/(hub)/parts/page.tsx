"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Package, ChevronRight, AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PARTS, CATEGORIES, OEMS, getStockStatus } from "@/lib/parts-data";

const STOCK_CONFIG = {
  ok:  { label: "In Stock",      color: "#16A34A", bg: "#DCFCE7", Icon: CheckCircle2, badgeVariant: "green"  as const },
  low: { label: "At Reorder",    color: "#EAB308", bg: "#FEF9C3", Icon: AlertTriangle, badgeVariant: "yellow" as const },
  out: { label: "Out of Stock",  color: "#DC2626", bg: "#FEE2E2", Icon: AlertCircle,   badgeVariant: "red"    as const },
};

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "ok",  label: "In Stock" },
  { key: "low", label: "Low / At Reorder" },
  { key: "out", label: "Out of Stock" },
];

export default function PartsPage() {
  const [query, setQuery]         = useState("");
  const [oem, setOem]             = useState("all");
  const [category, setCategory]   = useState("all");
  const [stockFilter, setStock]   = useState("all");

  const visible = PARTS.filter(p => {
    const status = getStockStatus(p);
    const matchQ    = !query   || p.description.toLowerCase().includes(query.toLowerCase()) || p.partNumber.toLowerCase().includes(query.toLowerCase());
    const matchOem  = oem === "all"      || p.oem === oem;
    const matchCat  = category === "all" || p.category === category;
    const matchStock = stockFilter === "all" || status === stockFilter;
    return matchQ && matchOem && matchCat && matchStock;
  });

  const outCount = PARTS.filter(p => getStockStatus(p) === "out").length;
  const lowCount = PARTS.filter(p => getStockStatus(p) === "low").length;

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Parts & Inventory</h1>
              <div className="flex gap-2 mt-0.5">
                {outCount > 0 && <span className="text-[11px] font-medium" style={{ color: "var(--status-red)" }}>{outCount} out of stock</span>}
                {lowCount > 0 && <span className="text-[11px] font-medium" style={{ color: "var(--status-yellow)" }}>{lowCount} at reorder point</span>}
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
            <Input placeholder="Search part number or description…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
          </div>

          {/* Filter row */}
          <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
            {/* Stock status */}
            {STATUS_FILTERS.map(f => (
              <button key={f.key} onClick={() => setStock(f.key)}
                className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                style={{ backgroundColor: stockFilter === f.key ? "var(--brand-blue)" : "var(--surface-1)", color: stockFilter === f.key ? "white" : "var(--foreground-muted)" }}>
                {f.label}
              </button>
            ))}
            <div className="w-px h-5 self-center" style={{ backgroundColor: "var(--border)" }} />
            {/* OEM */}
            <select value={oem} onChange={e => setOem(e.target.value)}
              className="flex-shrink-0 text-xs px-2 py-1.5 rounded-lg border cursor-pointer"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground-muted)" }}>
              <option value="all">All OEMs</option>
              {OEMS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {/* Category */}
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="flex-shrink-0 text-xs px-2 py-1.5 rounded-lg border cursor-pointer"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground-muted)" }}>
              <option value="all">All Categories</option>
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
            <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>No parts match your filters</p>
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
                    {["Part #", "Description", "OEM", "Category", "Qty", "Reorder", "Unit Cost", "Location", "Status", ""].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--foreground-muted)" }}>{h}</th>
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
                            {cfg.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/parts/${part.id}`} className="text-xs font-medium" style={{ color: "var(--brand-blue)" }}>
                            Details →
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
  const status = getStockStatus(part);
  const cfg = STOCK_CONFIG[status];
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
            <Badge variant={cfg.badgeVariant} className="text-[10px]">{cfg.label}</Badge>
            <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>Qty: {part.qtyOnHand} · {part.location}</span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
      </div>
    </Link>
  );
}
