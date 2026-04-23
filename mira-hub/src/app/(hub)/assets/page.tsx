"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Search, QrCode, Wind, Zap, Cog, Thermometer, Droplets,
  Factory, Gauge, AlertCircle, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/* ─── Mock assets ───────────────────────────────────────────────────── */
const ASSETS = [
  { id: "1",  name: "Air Compressor #1",  tag: "MC-AC-001", type: "Mechanical",  status: "operational", location: "Building A",  icon: Wind,        criticality: "High",   lastPM: "2026-03-15", nextPM: "2026-04-15" },
  { id: "2",  name: "Conveyor Belt #3",   tag: "MC-CB-003", type: "Electrical",  status: "warning",     location: "Building B",  icon: Zap,         criticality: "High",   lastPM: "2026-01-20", nextPM: "2026-02-20" },
  { id: "3",  name: "CNC Mill #7",        tag: "MC-CN-007", type: "CNC",         status: "operational", location: "Shop Floor",  icon: Cog,         criticality: "Medium", lastPM: "2026-04-01", nextPM: "2026-05-01" },
  { id: "4",  name: "HVAC Unit #2",       tag: "MC-HV-002", type: "HVAC",        status: "critical",    location: "Roof",        icon: Thermometer, criticality: "Medium", lastPM: "2025-12-10", nextPM: "2026-03-10" },
  { id: "5",  name: "Pump Station A",     tag: "MC-PS-00A", type: "Fluid",       status: "operational", location: "Basement",    icon: Droplets,    criticality: "High",   lastPM: "2026-02-28", nextPM: "2026-05-28" },
  { id: "6",  name: "Press #2",           tag: "MC-PR-002", type: "Mechanical",  status: "idle",        location: "Building C",  icon: Factory,     criticality: "Low",    lastPM: "2026-01-05", nextPM: "2026-04-05" },
  { id: "7",  name: "Boiler Unit B",      tag: "MC-BL-00B", type: "Thermal",     status: "warning",     location: "Utility",     icon: Thermometer, criticality: "High",   lastPM: "2026-03-01", nextPM: "2026-04-01" },
  { id: "8",  name: "Generator #1",       tag: "MC-GN-001", type: "Electrical",  status: "operational", location: "Yard",        icon: Gauge,       criticality: "Critical", lastPM: "2026-04-10", nextPM: "2026-07-10" },
];

const STATUS_CONFIG = {
  operational: { labelKey: "statusLabels.operational", color: "#16A34A", bg: "#DCFCE7", Icon: CheckCircle2 },
  warning:     { labelKey: "statusLabels.warning",     color: "#EAB308", bg: "#FEF9C3", Icon: AlertTriangle },
  critical:    { labelKey: "statusLabels.critical",    color: "#DC2626", bg: "#FEE2E2", Icon: AlertCircle },
  idle:        { labelKey: "statusLabels.idle",        color: "#64748B", bg: "#F1F5F9", Icon: Gauge },
};

const FILTER_CHIP_KEYS = [
  { key: "all" },
  { key: "critical" },
  { key: "warning" },
  { key: "idle" },
];

const FILTER_CHIP_LABELS: Record<string, string> = {
  all: "filters.all",
  critical: "filters.active",
  warning: "filters.maintenance",
  idle: "filters.inactive",
};

export default function AssetsPage() {
  const t = useTranslations("assets");
  const tCommon = useTranslations("common");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const visible = ASSETS.filter((a) => {
    const matchQuery = !query || a.name.toLowerCase().includes(query.toLowerCase()) || a.tag.toLowerCase().includes(query.toLowerCase());
    const matchFilter =
      filter === "all" ? true :
      filter === "critical" ? a.criticality === "Critical" :
      filter === "warning" ? a.status === "warning" :
      filter === "idle" ? (a.status === "idle" || a.status === "critical") :
      true;
    return matchQuery && matchFilter;
  });

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b px-4 md:px-6 py-3"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
          <Button size="sm" className="gap-1.5">
            <QrCode className="w-3.5 h-3.5" />
            {tCommon("scanQr")}
          </Button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
          <Input
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_CHIP_KEYS.map((chip) => (
            <button
              key={chip.key}
              onClick={() => setFilter(chip.key)}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                backgroundColor: filter === chip.key ? "var(--brand-blue)" : "var(--surface-1)",
                color: filter === chip.key ? "white" : "var(--foreground-muted)",
              }}
            >
              {t(FILTER_CHIP_LABELS[chip.key])}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="px-4 md:px-6 py-4">
        <p className="text-xs mb-3" style={{ color: "var(--foreground-muted)" }}>
          {visible.length} asset{visible.length !== 1 ? "s" : ""}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {visible.map((asset) => (
            <AssetTile key={asset.id} asset={asset} />
          ))}
        </div>

        {visible.length === 0 && (
          <div className="text-center py-16">
            <Search className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
            <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>{t("noAssets")}</p>
            <p className="text-xs mt-1" style={{ color: "var(--foreground-subtle)" }}>{t("tryDifferent")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AssetTile({ asset }: { asset: typeof ASSETS[number] }) {
  const t = useTranslations("assets");
  const statusCfg = STATUS_CONFIG[asset.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.idle;
  const status = statusCfg;
  const Icon = asset.icon;
  const StatusIcon = status.Icon;

  return (
    <Link href={`/assets/${asset.id}`} className="block">
      <div className="card card-hover p-4 flex flex-col gap-3 h-full transition-all duration-150">
        {/* Icon + status dot */}
        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: status.bg }}>
            <Icon className="w-5 h-5" style={{ color: status.color }} />
          </div>
          <StatusIcon className="w-4 h-4 mt-0.5" style={{ color: status.color }} />
        </div>

        {/* Name + tag */}
        <div className="flex-1">
          <p className="text-sm font-medium leading-snug" style={{ color: "var(--foreground)" }}>
            {asset.name}
          </p>
          <p className="text-[11px] font-mono mt-0.5" style={{ color: "var(--foreground-subtle)" }}>
            {asset.tag}
          </p>
        </div>

        {/* Location + status */}
        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>
            {asset.location}
          </span>
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: status.bg, color: status.color }}
          >
            {t(status.labelKey).split(" ")[0]}
          </span>
        </div>
      </div>
    </Link>
  );
}
