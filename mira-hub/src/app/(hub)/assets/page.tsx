"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Search, QrCode, Wind, Zap, Cog, Thermometer, Droplets,
  Factory, Gauge, AlertCircle, CheckCircle2, AlertTriangle,
  Plus, X, Loader2, Wrench,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/* ─── Types ──────────────────────────────────────────────────────────── */
type Asset = {
  id: string;
  tag: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  type: string | null;
  location: string | null;
  department: string | null;
  criticality: string;
  workOrderCount: number;
  downtimeHours: number;
  lastMaintenance: string | null;
  lastWorkOrder: string | null;
  lastFault: string | null;
  description: string | null;
  createdAt: string | null;
  _isNew?: boolean;
};

/* ─── OEM options ────────────────────────────────────────────────────── */
const OEM_OPTIONS = [
  "Allen-Bradley", "Rockwell Automation", "Siemens", "ABB",
  "Yaskawa", "Danfoss", "AutomationDirect", "SEW-Eurodrive",
  "Mitsubishi Electric", "Schneider Electric", "Omron", "Eaton",
  "Emerson", "Parker", "Other",
];

/* ─── Status derivation ──────────────────────────────────────────────── */
function deriveStatus(a: Asset): "operational" | "warning" | "critical" | "idle" {
  if (a.downtimeHours > 0 && a.lastFault) return "warning";
  if (a.criticality === "critical" && a.lastFault) return "critical";
  if (a.workOrderCount === 0 && !a.lastWorkOrder) return "idle";
  return "operational";
}

const STATUS_CONFIG = {
  operational: { color: "#16A34A", bg: "#DCFCE7", Icon: CheckCircle2 },
  warning:     { color: "#EAB308", bg: "#FEF9C3", Icon: AlertTriangle },
  critical:    { color: "#DC2626", bg: "#FEE2E2", Icon: AlertCircle },
  idle:        { color: "#64748B", bg: "#F1F5F9", Icon: Gauge },
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  Mechanical: Cog,
  Electrical: Zap,
  HVAC: Thermometer,
  Fluid: Droplets,
  CNC: Cog,
  Thermal: Thermometer,
  Hydraulic: Droplets,
  Pneumatic: Wind,
};

const FILTER_CHIPS = [
  { key: "all",      labelKey: "filters.all" },
  { key: "critical", labelKey: "filters.active" },
  { key: "warning",  labelKey: "filters.maintenance" },
  { key: "idle",     labelKey: "filters.inactive" },
];

const CRITICALITY_OPTIONS = ["low", "medium", "high", "critical"];

const DEFAULT_FORM = {
  name: "",
  tag: "",
  manufacturer: "",
  model: "",
  serialNumber: "",
  location: "",
  criticality: "medium",
  installDate: "",
};

function isNew(asset: Asset): boolean {
  if (asset._isNew) return true;
  if (!asset.createdAt) return false;
  return Date.now() - new Date(asset.createdAt).getTime() < 24 * 60 * 60 * 1000;
}

/* ─── Toast ──────────────────────────────────────────────────────────── */
function Toast({ msg, type, onDone }: { msg: string; type: "success" | "error"; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-medium text-white shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-3 duration-200"
      style={{ backgroundColor: type === "success" ? "#16A34A" : "#DC2626", maxWidth: "calc(100vw - 2rem)" }}
    >
      {type === "success" ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      {msg}
    </div>
  );
}

/* ─── Create Asset Modal ─────────────────────────────────────────────── */
function CreateAssetModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (asset: Asset) => void;
}) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  function set(k: string, v: string) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.manufacturer.trim()) {
      setError("Manufacturer is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to create asset");
      }
      const created: Asset = await res.json();
      onCreated({ ...created, _isNew: true });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden"
        style={{ backgroundColor: "var(--surface-0)", border: "1px solid var(--border)", maxHeight: "90dvh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Create Asset</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--surface-1)] transition-colors">
            <X className="w-4 h-4" style={{ color: "var(--foreground-muted)" }} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto" style={{ maxHeight: "calc(90dvh - 120px)" }}>
          <div className="px-5 py-4 flex flex-col gap-4">

            {/* Asset Name */}
            <Field label="Asset Name" required={false}>
              <input
                ref={firstInputRef}
                type="text"
                placeholder="e.g. GS10 VFD - Line 3"
                value={form.name}
                onChange={e => set("name", e.target.value)}
                className="field-input"
              />
            </Field>

            {/* Tag */}
            <Field label="Asset Tag">
              <input
                type="text"
                placeholder="e.g. VFD-L3-001 (auto-generated if blank)"
                value={form.tag}
                onChange={e => set("tag", e.target.value)}
                className="field-input"
              />
            </Field>

            {/* Manufacturer row */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Manufacturer / OEM" required>
                <select
                  value={form.manufacturer}
                  onChange={e => set("manufacturer", e.target.value)}
                  className="field-input"
                  required
                >
                  <option value="">Select OEM…</option>
                  {OEM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Model">
                <input
                  type="text"
                  placeholder="e.g. GS10"
                  value={form.model}
                  onChange={e => set("model", e.target.value)}
                  className="field-input"
                />
              </Field>
            </div>

            {/* Serial + Location */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Serial Number">
                <input
                  type="text"
                  placeholder="S/N"
                  value={form.serialNumber}
                  onChange={e => set("serialNumber", e.target.value)}
                  className="field-input"
                />
              </Field>
              <Field label="Location">
                <input
                  type="text"
                  placeholder="e.g. Building A, Line 3"
                  value={form.location}
                  onChange={e => set("location", e.target.value)}
                  className="field-input"
                />
              </Field>
            </div>

            {/* Criticality + Install Date */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Criticality">
                <select
                  value={form.criticality}
                  onChange={e => set("criticality", e.target.value)}
                  className="field-input"
                >
                  {CRITICALITY_OPTIONS.map(c => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Install Date">
                <input
                  type="date"
                  value={form.installDate}
                  onChange={e => set("installDate", e.target.value)}
                  className="field-input"
                />
              </Field>
            </div>

            {error && (
              <p className="text-xs flex items-center gap-1.5" style={{ color: "#DC2626" }}>
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 pb-5 pt-2 flex gap-2 border-t" style={{ borderColor: "var(--border)" }}>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-9 rounded-lg text-sm font-medium transition-colors"
              style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.manufacturer.trim()}
              className="flex-1 h-9 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
              style={{ backgroundColor: "var(--brand-blue)" }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
              {saving ? "Creating…" : "Create Asset"}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .field-input {
          width: 100%;
          height: 36px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface-1);
          color: var(--foreground);
          font-size: 13px;
          padding: 0 10px;
          outline: none;
          transition: border-color 0.15s;
        }
        .field-input:focus { border-color: var(--brand-blue); }
        select.field-input { cursor: pointer; }
        input[type="date"].field-input { padding: 0 8px; }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--foreground-muted)" }}>
        {label}{required && <span style={{ color: "#DC2626" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

/* ─── Asset Tile ──────────────────────────────────────────────────────── */
function AssetTile({ asset }: { asset: Asset }) {
  const status = deriveStatus(asset);
  const statusCfg = STATUS_CONFIG[status];
  const StatusIcon = statusCfg.Icon;
  const Icon = TYPE_ICONS[asset.type ?? ""] ?? Cog;
  const newBadge = isNew(asset);

  return (
    <Link href={`/assets/${asset.id}`} className="block">
      <div className="card card-hover p-4 flex flex-col gap-3 h-full transition-all duration-150 relative">
        {newBadge && (
          <span
            className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: "#DCFCE7", color: "#16A34A" }}
          >
            NEW
          </span>
        )}

        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: statusCfg.bg }}>
            <Icon className="w-5 h-5" style={{ color: statusCfg.color }} />
          </div>
          <StatusIcon className="w-4 h-4 mt-0.5" style={{ color: statusCfg.color }} />
        </div>

        <div className="flex-1">
          <p className="text-sm font-medium leading-snug" style={{ color: "var(--foreground)" }}>
            {asset.name || `${asset.manufacturer ?? ""} ${asset.model ?? ""}`.trim() || "Unnamed Asset"}
          </p>
          <p className="text-[11px] font-mono mt-0.5" style={{ color: "var(--foreground-subtle)" }}>
            {asset.tag}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>
            {asset.location ?? "—"}
          </span>
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}
          >
            {status}
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────── */
function AssetsPageInner() {
  const t = useTranslations("assets");
  const tCommon = useTranslations("common");
  const searchParams = useSearchParams();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (searchParams.get("create") === "1") setShowCreate(true);
  }, [searchParams]);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/hub/api/assets")
      .then(r => {
        if (r.status === 401) {
          window.location.href = "/hub/login?callbackUrl=/hub/assets";
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data === null) return;
        if (Array.isArray(data)) {
          setAssets(data);
          setLoadError(null);
        } else {
          setLoadError((data as { error?: string }).error ?? "Failed to load assets");
        }
      })
      .catch((err) => setLoadError((err as Error).message ?? "Network error"))
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(asset: Asset) {
    setAssets(prev => [asset, ...prev]);
    setToast({ msg: "Asset created successfully", type: "success" });
  }

  const visible = assets.filter(a => {
    const q = query.toLowerCase();
    const matchQuery = !q
      || (a.name ?? "").toLowerCase().includes(q)
      || (a.tag ?? "").toLowerCase().includes(q)
      || (a.location ?? "").toLowerCase().includes(q);
    const matchFilter =
      filter === "all"      ? true :
      filter === "critical" ? a.criticality === "critical" :
      filter === "warning"  ? deriveStatus(a) === "warning" :
      filter === "idle"     ? deriveStatus(a) === "idle" :
      true;
    return matchQuery && matchFilter;
  });

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-20 border-b px-4 md:px-6 py-3"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
          <div className="flex items-center gap-2">
            {/* Desktop create button */}
            <button
              onClick={() => setShowCreate(true)}
              className="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--brand-blue)" }}
            >
              <Plus className="w-4 h-4" />
              New Asset
            </button>
            <Button size="sm" className="gap-1.5">
              <QrCode className="w-3.5 h-3.5" />
              {tCommon("scanQr")}
            </Button>
          </div>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
          <Input
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_CHIPS.map(chip => (
            <button
              key={chip.key}
              onClick={() => setFilter(chip.key)}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                backgroundColor: filter === chip.key ? "var(--brand-blue)" : "var(--surface-1)",
                color: filter === chip.key ? "white" : "var(--foreground-muted)",
              }}
            >
              {t(chip.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="px-4 md:px-6 py-4">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card p-4 h-32 animate-pulse" style={{ backgroundColor: "var(--surface-1)" }} />
            ))}
          </div>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: "var(--foreground-muted)" }}>
              {visible.length} asset{visible.length !== 1 ? "s" : ""}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {visible.map(asset => <AssetTile key={asset.id} asset={asset} />)}
            </div>
            {visible.length === 0 && (
              <div className="text-center py-16">
                <Search className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
                <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>{t("noAssets")}</p>
                <p className="text-xs mt-1" style={{ color: "var(--foreground-subtle)" }}>{t("tryDifferent")}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile FAB */}
      <button
        onClick={() => setShowCreate(true)}
        className="fixed bottom-20 right-5 md:hidden w-14 h-14 rounded-full text-white flex items-center justify-center z-30 shadow-xl transition-transform hover:scale-105 active:scale-95"
        style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", boxShadow: "0 4px 20px rgba(37,99,235,0.4)" }}
        aria-label="Create new asset"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Modal */}
      {showCreate && (
        <CreateAssetModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}

export default function AssetsPage() {
  return (
    <Suspense>
      <AssetsPageInner />
    </Suspense>
  );
}
