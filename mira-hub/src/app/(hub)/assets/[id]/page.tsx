"use client";

import { useState, use, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowLeft, Bot, Wrench, FileText, Package, Activity,
  CheckCircle2, AlertTriangle, AlertCircle, Clock,
  QrCode, MapPin, Cpu, Calendar, ChevronRight, ChevronDown, ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/* ─── Mock data ─────────────────────────────────────────────────────── */
const ASSETS: Record<string, {
  name: string; tag: string; oem: string; model: string; status: string;
  serial: string; installed: string; criticality: string; location: string;
  lastPM: string; nextPM: string; type: string;
}> = {
  "1": { name: "Air Compressor #1",  tag: "MC-AC-001", oem: "Ingersoll Rand", model: "R55n",   status: "operational", serial: "AC-001-2022",  installed: "2022-03-15", criticality: "High",     location: "Building A, Bay 3", lastPM: "2026-03-15", nextPM: "2026-04-15", type: "Mechanical" },
  "2": { name: "Conveyor Belt #3",   tag: "MC-CB-003", oem: "Dorner",        model: "2200",    status: "warning",     serial: "CB-003-2021",  installed: "2021-08-01", criticality: "High",     location: "Building B, Line 3", lastPM: "2026-01-20", nextPM: "2026-02-20", type: "Electrical" },
  "3": { name: "CNC Mill #7",        tag: "MC-CN-007", oem: "Haas",          model: "VF-4SS",  status: "operational", serial: "CNC-007-2020", installed: "2020-11-10", criticality: "Medium",   location: "Shop Floor, Cell 7", lastPM: "2026-04-01", nextPM: "2026-05-01", type: "CNC" },
  "4": { name: "HVAC Unit #2",       tag: "MC-HV-002", oem: "Carrier",       model: "50XC",    status: "critical",    serial: "HVAC-002-2019", installed: "2019-06-20", criticality: "Medium",  location: "Roof, Section B",   lastPM: "2025-12-10", nextPM: "2026-03-10", type: "HVAC" },
  "5": { name: "Pump Station A",     tag: "MC-PS-00A", oem: "Grundfos",      model: "CR 10-8", status: "operational", serial: "PS-A-2023",    installed: "2023-02-14", criticality: "High",     location: "Basement, Wet Well", lastPM: "2026-02-28", nextPM: "2026-05-28", type: "Fluid" },
};

const STATUS_CONFIG = {
  operational: { labelKey: "statusLabels.operational", badgeVariant: "green"  as const, Icon: CheckCircle2, color: "#16A34A" },
  warning:     { labelKey: "statusLabels.warning",     badgeVariant: "yellow" as const, Icon: AlertTriangle, color: "#EAB308" },
  critical:    { labelKey: "statusLabels.critical",    badgeVariant: "red"    as const, Icon: AlertCircle,   color: "#DC2626" },
  idle:        { labelKey: "statusLabels.idle",        badgeVariant: "gray"   as const, Icon: Clock,         color: "#64748B" },
};

const ACTIVITY_EVENTS = [
  { ts: "2026-04-22 09:05", type: "mira",    text: "MIRA detected elevated bearing temp (82°C). Recommended lubrication check." },
  { ts: "2026-04-15 14:30", type: "wo",      text: "WO-2026-007 completed. Belt tension adjusted, 2.1h, John S." },
  { ts: "2026-04-10 08:00", type: "pm",      text: "Scheduled PM completed. Oil changed, belts inspected, filters replaced." },
  { ts: "2026-04-02 16:45", type: "chat",    text: "Mike H. asked MIRA: 'What's the expected bearing life at current load?' — MIRA: ~18mo." },
  { ts: "2026-03-28 11:20", type: "photo",   text: "Photo uploaded: oil leak near shaft seal (3 photos)." },
  { ts: "2026-03-15 07:30", type: "pm",      text: "PM-2026-Q1 completed. All checks passed. Next PM: 2026-04-15." },
  { ts: "2026-02-20 13:00", type: "mira",    text: "MIRA flagged: pressure drop 8% below baseline. Checked — inlet filter partially clogged. Cleared." },
  { ts: "2026-01-10 09:00", type: "install", text: "Asset installed and commissioned. Initial performance baseline captured." },
];

const WO_LIST = [
  { id: "WO-2026-007", title: "Belt tension adjustment",   status: "completed",  priority: "Medium", date: "2026-04-15", tech: "John S." },
  { id: "WO-2026-001", title: "PM — Air Compressor #1",   status: "open",       priority: "High",   date: "2026-04-25", tech: "Mike H." },
  { id: "WO-2026-003", title: "Lubrication check",        status: "open",       priority: "High",   date: "2026-04-24", tech: "Unassigned" },
  { id: "WO-2025-089", title: "Inlet filter replacement", status: "completed",  priority: "Low",    date: "2026-02-20", tech: "Mike H." },
];

const DOCS_LIST = [
  { id: "d1", name: "Ingersoll Rand R55n — OEM Service Manual",   category: "Manuals",    state: "indexed",    date: "2026-01-10", pages: 248 },
  { id: "d2", name: "Air Compressor Wiring Diagram — Rev B",      category: "Schematics", state: "indexed",    date: "2025-11-20", pages: 12 },
  { id: "d3", name: "Spare Parts List — R55n Series",             category: "Parts",      state: "partial",    date: "2025-08-05", pages: 64 },
  { id: "d4", name: "R55n Service Manual — Rev A (Superseded)",   category: "Manuals",    state: "superseded", date: "2023-03-01", pages: 210 },
];

const PARTS_LIST = [
  { id: "P-001", name: "Air Filter",          qty: 12, reorder: 5,  unit: "ea", status: "ok" },
  { id: "P-015", name: "Drive Belt — R55n",   qty: 2,  reorder: 2,  unit: "ea", status: "low" },
  { id: "P-022", name: "Compressor Oil 46",   qty: 8,  reorder: 4,  unit: "L",  status: "ok" },
  { id: "P-031", name: "Shaft Seal Kit",      qty: 0,  reorder: 1,  unit: "ea", status: "out" },
];

const EVENT_ICON: Record<string, { Icon: React.ElementType; color: string }> = {
  mira:    { Icon: Bot,         color: "#16A34A" },
  wo:      { Icon: Wrench,      color: "#2563EB" },
  pm:      { Icon: Calendar,    color: "#7C3AED" },
  chat:    { Icon: Bot,         color: "#0891B2" },
  photo:   { Icon: Activity,    color: "#EA580C" },
  install: { Icon: Cpu,         color: "#64748B" },
};

type ApiAsset = {
  id: string; tag: string; name: string; manufacturer: string | null;
  model: string | null; serialNumber: string | null; type: string | null;
  location: string | null; criticality: string; workOrderCount: number;
  lastMaintenance: string | null; lastFault: string | null; installDate: string | null;
};

function apiToDisplay(a: ApiAsset): typeof ASSETS["1"] {
  return {
    name: a.name || "Unknown Asset",
    tag: a.tag,
    oem: a.manufacturer ?? "—",
    model: a.model ?? "—",
    status: a.lastFault ? "warning" : "operational",
    serial: a.serialNumber ?? "—",
    installed: a.installDate ? a.installDate.slice(0, 10) : "—",
    criticality: a.criticality.charAt(0).toUpperCase() + a.criticality.slice(1),
    location: a.location ?? "—",
    lastPM: a.lastMaintenance ? a.lastMaintenance.slice(0, 10) : "—",
    nextPM: "—",
    type: a.type ?? "—",
  };
}

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations("assets");
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState("overview");
  const [apiAsset, setApiAsset] = useState<ApiAsset | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/hub/api/assets/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data && !data.error) setApiAsset(data); })
      .finally(() => setLoading(false));
  }, [id]);

  const asset = apiAsset ? apiToDisplay(apiAsset) : (ASSETS[id] ?? ASSETS["1"]);
  const statusCfg = STATUS_CONFIG[asset.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.operational;

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-0">
          <Link href="/assets" className="inline-flex items-center gap-1 text-xs mb-2"
            style={{ color: "var(--brand-blue)" }}>
            <ArrowLeft className="w-3.5 h-3.5" /> {t("title")}
          </Link>

          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight" style={{ color: "var(--foreground)" }}>
                {loading ? <span className="inline-block w-48 h-5 rounded animate-pulse" style={{ backgroundColor: "var(--surface-1)" }} /> : asset.name}
              </h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs font-mono" style={{ color: "var(--foreground-subtle)" }}>{asset.tag}</span>
                <Badge variant={statusCfg.badgeVariant} className="text-[10px] px-2">
                  <statusCfg.Icon className="w-2.5 h-2.5 mr-0.5" />
                  {t(statusCfg.labelKey)}
                </Badge>
                <Badge variant="outline" className="text-[10px]">{t("criticalityLabel", { level: asset.criticality })}</Badge>
              </div>
            </div>
            <Button size="sm" variant="ghost">
              <QrCode className="w-4 h-4" />
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 overflow-x-auto scrollbar-none -mb-px">
            {["overview", "activity", "workorders", "documents", "parts"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="flex-shrink-0 px-4 py-2.5 text-xs font-medium capitalize border-b-2 transition-colors"
                style={{
                  borderColor: activeTab === tab ? "var(--brand-blue)" : "transparent",
                  color: activeTab === tab ? "var(--brand-blue)" : "var(--foreground-muted)",
                }}
              >
                {tab === "workorders" ? t("tabs.workOrders") :
                 tab === "overview"   ? t("tabs.details") :
                 tab === "activity"   ? t("tabs.activity") :
                 tab === "documents"  ? t("tabs.documents") :
                 tab === "parts"      ? t("tabs.parts") : tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="px-4 md:px-6 py-5 max-w-3xl">
        {activeTab === "overview" && <OverviewTab asset={asset} />}
        {activeTab === "activity" && <ActivityTab />}
        {activeTab === "workorders" && <WorkOrdersTab />}
        {activeTab === "documents" && <DocumentsTab />}
        {activeTab === "parts" && <PartsTab />}
      </div>
    </div>
  );
}

/* ─── Overview Tab ──────────────────────────────────────────────────── */
function OverviewTab({ asset }: { asset: typeof ASSETS["1"] }) {
  const t = useTranslations("assets");
  return (
    <div className="space-y-4">
      {/* Chat CTA */}
      <a href="https://t.me/FactoryLMDiagnose_bot" target="_blank" rel="noopener noreferrer">
        <Button className="w-full h-12 text-sm font-semibold gap-2"
          style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}>
          <Bot className="w-5 h-5" />
          {t("chatMira")}
        </Button>
      </a>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: t("manufacturer"), value: asset.oem, Icon: Cpu },
          { label: t("model"), value: asset.model, Icon: Cpu },
          { label: t("serialNumber"), value: asset.serial, Icon: Cpu },
          { label: t("category"), value: asset.type, Icon: Wrench },
          { label: t("location"), value: asset.location, Icon: MapPin },
          { label: t("installDate"), value: asset.installed, Icon: Calendar },
          { label: t("lastPM"), value: asset.lastPM, Icon: Calendar },
          { label: t("nextPM"), value: asset.nextPM, Icon: Calendar },
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
    </div>
  );
}

/* ─── Activity Tab ──────────────────────────────────────────────────── */
function ActivityTab() {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div className="space-y-1">
      {ACTIVITY_EVENTS.map((ev, i) => {
        const cfg = EVENT_ICON[ev.type] ?? EVENT_ICON.install;
        const isExp = expanded === i;
        return (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "var(--surface-1)" }}>
                <cfg.Icon className="w-4 h-4" style={{ color: cfg.color }} />
              </div>
              {i < ACTIVITY_EVENTS.length - 1 && (
                <div className="w-px flex-1 my-1" style={{ backgroundColor: "var(--border)" }} />
              )}
            </div>
            <button className="flex-1 pb-3 text-left" onClick={() => setExpanded(isExp ? null : i)}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs" style={{ color: "var(--foreground-subtle)" }}>{ev.ts}</p>
                {isExp ? <ChevronUp className="w-3 h-3 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
                        : <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />}
              </div>
              <p className="text-sm mt-0.5 leading-relaxed" style={{ color: "var(--foreground)" }}>{ev.text}</p>
              {isExp && (
                <div className="mt-2 p-2 rounded-lg text-xs" style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-subtle)" }}>
                  Type: {ev.type.toUpperCase()} · Timestamp: {ev.ts}
                  {ev.type === "wo" && <><br /><Link href="/workorders/WO-2026-007" className="font-medium" style={{ color: "var(--brand-blue)" }}>View work order →</Link></>}
                  {ev.type === "mira" && <><br /><a href="https://t.me/FactoryLMDiagnose_bot" target="_blank" rel="noopener noreferrer" className="font-medium" style={{ color: "var(--brand-blue)" }}>Chat with MIRA →</a></>}
                </div>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Work Orders Tab ───────────────────────────────────────────────── */
function WorkOrdersTab() {
  const tWo = useTranslations("workorders");
  const STATUS_VARIANT: Record<string, "open" | "inprogress" | "completed" | "overdue"> = {
    open: "open", "in-progress": "inprogress", completed: "completed", overdue: "overdue",
  };
  const PRIORITY_VARIANT: Record<string, "critical" | "high" | "medium" | "low"> = {
    Critical: "critical", High: "high", Medium: "medium", Low: "low",
  };
  return (
    <div className="space-y-3">
      <Link href="/workorders/new">
        <Button variant="outline" size="sm" className="w-full">
          <Wrench className="w-3.5 h-3.5 mr-1.5" /> {tWo("new")}
        </Button>
      </Link>
      {WO_LIST.map((wo) => (
        <Link key={wo.id} href={`/workorders/${wo.id}`}>
          <div className="card p-4 hover:shadow-md transition-shadow cursor-pointer">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono" style={{ color: "var(--foreground-subtle)" }}>{wo.id}</span>
                  <Badge variant={PRIORITY_VARIANT[wo.priority] ?? "low"}>{wo.priority}</Badge>
                  <Badge variant={STATUS_VARIANT[wo.status] ?? "open"} className="capitalize">{wo.status}</Badge>
                </div>
                <p className="text-sm font-medium mt-1" style={{ color: "var(--foreground)" }}>{wo.title}</p>
                <p className="text-xs mt-1" style={{ color: "var(--foreground-muted)" }}>
                  {wo.tech} · Due {wo.date}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 flex-shrink-0 mt-1" style={{ color: "var(--foreground-subtle)" }} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ─── Documents Tab ─────────────────────────────────────────────────── */
function DocumentsTab() {
  const DOC_STATE_VARIANT: Record<string, "indexed" | "partial" | "superseded"> = {
    indexed: "indexed", partial: "partial", superseded: "superseded",
  };
  // Map local ids to real doc ids (d01 format)
  const docIdMap: Record<string, string> = { d1: "d01", d2: "d02", d3: "d03", d4: "d09" };
  return (
    <div className="space-y-3">
      {DOCS_LIST.map((doc) => (
        <Link key={doc.id} href={`/documents/${docIdMap[doc.id] ?? "d01"}`}>
          <div className="card p-4 flex items-center gap-3 hover:shadow-md transition-shadow cursor-pointer">
            <FileText className="w-8 h-8 flex-shrink-0 p-1.5 rounded-lg"
              style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>{doc.name}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className="text-[10px]">{doc.category}</Badge>
                <Badge variant={DOC_STATE_VARIANT[doc.state]} className="capitalize text-[10px]">{doc.state}</Badge>
                <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>{doc.pages}p · {doc.date}</span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ─── Parts Tab ─────────────────────────────────────────────────────── */
function PartsTab() {
  const tParts = useTranslations("parts");
  const STOCK_STYLE = {
    ok:  { color: "#16A34A", bg: "#DCFCE7", label: tParts("stockStatus.ok") },
    low: { color: "#EAB308", bg: "#FEF9C3", label: tParts("stockStatus.low") },
    out: { color: "#DC2626", bg: "#FEE2E2", label: tParts("stockStatus.out") },
  };
  // Map local part ids to real part ids
  const partIdMap: Record<string, string> = { "P-001": "P-001", "P-015": "P-002", "P-022": "P-003", "P-031": "P-007" };
  return (
    <div className="space-y-3">
      {PARTS_LIST.map((part) => {
        const st = STOCK_STYLE[part.status as keyof typeof STOCK_STYLE];
        return (
          <Link key={part.id} href={`/parts/${partIdMap[part.id] ?? "P-001"}`}>
            <div className="card p-4 flex items-center justify-between gap-3 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center gap-3 min-w-0">
                <Package className="w-8 h-8 p-1.5 rounded-lg flex-shrink-0"
                  style={{ backgroundColor: st.bg, color: st.color }} />
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{part.name}</p>
                  <p className="text-xs font-mono mt-0.5" style={{ color: "var(--foreground-subtle)" }}>{part.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right">
                  <p className="text-lg font-bold" style={{ color: st.color }}>{part.qty}</p>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
                </div>
                <ChevronRight className="w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
              </div>
            </div>
          </Link>
        );
      })}
      <Link href="/parts" className="text-xs font-medium" style={{ color: "var(--brand-blue)" }}>
        {tParts("title")} →
      </Link>
    </div>
  );
}
