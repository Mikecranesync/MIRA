"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API_BASE } from "@/lib/config";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Search, QrCode, Camera, CheckCircle2, Loader2, X, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OpenInCMMSButton } from "@/components/cmms/open-in-cmms-button";
import { useTranslations } from "next-intl";
import { parseWorkOrderPrefill } from "./prefill";

type AssetOption = { id: string; name: string; tag: string; location: string };

type PhotoState = {
  id: string;
  file: File;
  previewUrl: string;
  status: "queued" | "uploading" | "uploaded" | "failed";
  error?: string;
  uploadId?: string;
};

type AssetRow = {
  id: string;
  tag: string | null;
  name: string | null;
  manufacturer: string | null;
  model: string | null;
  location: string | null;
};

function toAssetOption(a: AssetRow): AssetOption {
  const fallbackName =
    [a.manufacturer, a.model].filter(Boolean).join(" ") || a.tag || "Asset";
  return {
    id: a.id,
    name: (a.name && a.name.trim()) || fallbackName,
    tag: a.tag ?? "",
    location: a.location ?? "",
  };
}

export default function NewWorkOrderPage() {
  return (
    <Suspense>
      <NewWorkOrderPageInner />
    </Suspense>
  );
}

function NewWorkOrderPageInner() {
  const t = useTranslations("workorders");
  const tCommon = useTranslations("common");
  const tPriority = useTranslations("priority");

  const PRIORITIES = [
    { value: "Low",      label: tPriority("low"),      desc: t("priorityDescs.low"),      color: "#64748B", bg: "#F1F5F9" },
    { value: "Medium",   label: tPriority("medium"),   desc: t("priorityDescs.medium"),   color: "#EAB308", bg: "#FEF9C3" },
    { value: "High",     label: tPriority("high"),     desc: t("priorityDescs.high"),     color: "#EA580C", bg: "#FFF7ED" },
    { value: "Critical", label: tPriority("critical"), desc: t("priorityDescs.critical"), color: "#DC2626", bg: "#FEE2E2" },
  ];

  // Prefill from an anomaly→work-order deep link (MachineMemoryCard "Create
  // work order" button — master-plan T4). All three are optional; a normal
  // "New work order" nav click carries none of them.
  const searchParams = useSearchParams();
  const prefill = parseWorkOrderPrefill(searchParams);
  const prefillTitle = prefill.title;
  const sourceRunDiffId = prefill.sourceRunDiffId;

  const [step, setStep] = useState(1);
  const [assetQuery, setAssetQuery] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<AssetOption | null>(null);
  const [description, setDescription] = useState(() => prefill.description);
  const [priority, setPriority] = useState("Medium");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdWO, setCreatedWO] = useState<{ id: string; work_order_number: string } | null>(null);

  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetsError, setAssetsError] = useState<string | null>(null);

  const [photos, setPhotos] = useState<PhotoState[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function uploadPhoto(p: PhotoState, assetTag: string) {
    setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "uploading" } : x)));
    const fd = new FormData();
    fd.append("file", p.file);
    if (assetTag) fd.append("assetTag", assetTag);
    fetch(`${API_BASE}/api/uploads/local/`, { method: "POST", body: fd })
      .then(async (res) => {
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `upload_failed_${res.status}`);
        }
        return res.json() as Promise<{ id: string }>;
      })
      .then((data) => {
        setPhotos((prev) =>
          prev.map((x) => (x.id === p.id ? { ...x, status: "uploaded", uploadId: data.id } : x)),
        );
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "upload_failed";
        setPhotos((prev) =>
          prev.map((x) => (x.id === p.id ? { ...x, status: "failed", error: message } : x)),
        );
      });
  }

  function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const tag = selectedAsset?.tag ?? "";
    const queued: PhotoState[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "queued" as const,
    }));
    setPhotos((prev) => [...prev, ...queued]);
    queued.forEach((p) => uploadPhoto(p, tag));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }

  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/assets/`);
        if (!res.ok) {
          if (!cancelled) setAssetsError("Could not load assets");
          return;
        }
        const data = (await res.json()) as AssetRow[];
        if (!cancelled) setAssets(data.map(toAssetOption));
      } catch {
        if (!cancelled) setAssetsError("Could not load assets");
      } finally {
        if (!cancelled) setAssetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredAssets = assets.filter(a =>
    !assetQuery ||
    a.name.toLowerCase().includes(assetQuery.toLowerCase()) ||
    a.tag.toLowerCase().includes(assetQuery.toLowerCase())
  );

  async function submit() {
    if (!selectedAsset || !description.trim() || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/work-orders/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipment_id: selectedAsset.id,
          title: prefillTitle || `Issue: ${selectedAsset.name}`,
          description: description.trim(),
          fault_description: description.trim(),
          priority: priority.toLowerCase(),
          ...(sourceRunDiffId ? { source_run_diff_id: sourceRunDiffId } : {}),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setSubmitError(err.error ?? `Failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      const data = (await res.json()) as { work_order: { id: string; work_order_number: string } };
      setCreatedWO({ id: data.work_order.id, work_order_number: data.work_order.work_order_number });
      setSubmitted(true);
    } catch {
      setSubmitError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted && createdWO) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{ backgroundColor: "#DCFCE7" }}>
          <CheckCircle2 className="w-8 h-8" style={{ color: "#16A34A" }} />
        </div>
        <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--foreground)" }}>
          {t("woCreated")}
        </h2>
        <p className="text-sm mb-1" style={{ color: "var(--foreground-muted)" }}>
          {createdWO.work_order_number}
        </p>
        <p className="text-sm mb-8" style={{ color: "var(--foreground-muted)" }}>
          {selectedAsset?.name} · {priority} priority
        </p>
        <div className="flex gap-3 flex-wrap justify-center">
          <Link href={`/workorders/${createdWO.id}`}>
            <Button>{tCommon("view")}</Button>
          </Link>
          <OpenInCMMSButton
            kind="work_order"
            recordId={createdWO.id}
            variant="secondary"
            hideWhenUnconfigured
          />
          <Link href="/workorders">
            <Button variant="secondary">{t("title")}</Button>
          </Link>
          <Button variant="outline" onClick={() => {
            setStep(1);
            setSubmitted(false);
            setCreatedWO(null);
            setSelectedAsset(null);
            setDescription("");
            setPriority("Medium");
            setAssetQuery("");
            setSubmitError(null);
          }}>
            {tCommon("create")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full max-w-xl mx-auto" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b px-4 md:px-6 py-3"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3 mb-3">
          <Link href="/workorders">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("new")}</h1>
        </div>

        {/* Progress stepper */}
        <div className="flex items-center gap-0">
          {[1, 2, 3].map((s, i) => (
            <div key={s} className="flex items-center flex-1">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                  style={{
                    backgroundColor: step >= s ? "var(--brand-blue)" : "var(--surface-1)",
                    color: step >= s ? "white" : "var(--foreground-muted)",
                  }}
                >
                  {step > s ? <CheckCircle2 className="w-4 h-4" /> : s}
                </div>
                <span className="text-xs font-medium hidden sm:block"
                  style={{ color: step === s ? "var(--foreground)" : "var(--foreground-subtle)" }}>
                  {s === 1 ? tCommon("asset") : s === 2 ? tCommon("description") : tCommon("review")}
                </span>
              </div>
              {i < 2 && (
                <div className="flex-1 h-px mx-3"
                  style={{ backgroundColor: step > s ? "var(--brand-blue)" : "var(--border)" }} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-6 py-5">
        {/* Step 1: Select Asset */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>{tCommon("asset")}</h2>
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{t("searchByNameTag")}</p>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
                <Input placeholder={`${tCommon("search")}…`} value={assetQuery} onChange={e => setAssetQuery(e.target.value)} className="pl-9" />
              </div>
              <Button variant="outline" size="icon" title="Scan QR">
                <QrCode className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-2">
              {assetsLoading && (
                <div className="flex items-center justify-center py-8 text-xs"
                  style={{ color: "var(--foreground-subtle)" }}>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading assets…
                </div>
              )}
              {!assetsLoading && assetsError && (
                <div className="p-4 rounded-lg border text-xs"
                  style={{ borderColor: "#FECACA", backgroundColor: "#FEF2F2", color: "#991B1B" }}>
                  {assetsError}
                </div>
              )}
              {!assetsLoading && !assetsError && assets.length === 0 && (
                <div className="p-6 rounded-lg border-2 border-dashed text-center"
                  style={{ borderColor: "var(--border)" }}>
                  <p className="text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>No assets yet</p>
                  <p className="text-xs mb-3" style={{ color: "var(--foreground-muted)" }}>
                    Create an asset before logging a work order against it.
                  </p>
                  <Link href="/assets">
                    <Button size="sm" variant="outline">Go to Assets</Button>
                  </Link>
                </div>
              )}
              {!assetsLoading && !assetsError && assets.length > 0 && filteredAssets.length === 0 && (
                <p className="text-xs text-center py-4"
                  style={{ color: "var(--foreground-subtle)" }}>
                  No assets match &ldquo;{assetQuery}&rdquo;.
                </p>
              )}
              {filteredAssets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => setSelectedAsset(asset)}
                  className="w-full text-left p-4 rounded-lg border-2 transition-all"
                  style={{
                    borderColor: selectedAsset?.id === asset.id ? "var(--brand-blue)" : "var(--border)",
                    backgroundColor: selectedAsset?.id === asset.id ? "#EFF6FF" : "var(--surface-0)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{asset.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                        {[asset.tag, asset.location].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    {selectedAsset?.id === asset.id && (
                      <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: "var(--brand-blue)" }} />
                    )}
                  </div>
                </button>
              ))}
            </div>

            <Button
              className="w-full"
              disabled={!selectedAsset}
              onClick={() => setStep(2)}
            >
              {tCommon("description")} <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 2: Describe Issue */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>{tCommon("description")}</h2>
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                Asset: <strong style={{ color: "var(--foreground)" }}>{selectedAsset?.name}</strong>
              </p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--foreground-muted)" }}>
                {tCommon("description")} *
              </label>
              <textarea
                rows={5}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t("descPlaceholder")}
                className="w-full rounded-lg border px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--surface-0)",
                  color: "var(--foreground)",
                  "--tw-ring-color": "var(--brand-blue)",
                } as React.CSSProperties}
              />
              <p className="text-[11px] mt-1" style={{ color: "var(--foreground-subtle)" }}>
                {t("miraWillUse")}
              </p>
            </div>

            {/* Photo upload */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--foreground-muted)" }}>
                Photos ({tCommon("optional")})
              </label>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => onFilesPicked(e.target.files)}
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.setAttribute("capture", "environment");
                      fileInputRef.current.click();
                    }
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-5 transition-colors hover:border-blue-400 active:scale-[0.98]"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", minHeight: 96 }}
                >
                  <Camera className="w-7 h-7" style={{ color: "var(--brand-blue)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Take photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.removeAttribute("capture");
                      fileInputRef.current.click();
                    }
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-5 transition-colors hover:border-blue-400 active:scale-[0.98]"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", minHeight: 96 }}
                >
                  <ImagePlus className="w-7 h-7" style={{ color: "var(--brand-blue)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Upload photo</span>
                </button>
              </div>

              {photos.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {photos.map((p) => (
                    <div
                      key={p.id}
                      className="relative aspect-square rounded-lg overflow-hidden border"
                      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                      {p.status === "uploading" && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <Loader2 className="w-5 h-5 text-white animate-spin" />
                        </div>
                      )}
                      {p.status === "uploaded" && (
                        <div className="absolute bottom-1 right-1 rounded-full bg-emerald-600 p-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}
                      {p.status === "failed" && (
                        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white text-center px-1 bg-red-600/80">
                          {p.error ?? "Failed"}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removePhoto(p.id)}
                        aria-label="Remove photo"
                        className="absolute top-1 right-1 rounded-full bg-black/60 p-1 hover:bg-black/80"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[11px] mt-2" style={{ color: "var(--foreground-subtle)" }}>
                Photos attach to {selectedAsset?.tag ? `asset ${selectedAsset.tag}` : "the selected asset"} in MIRA&apos;s knowledge base.
              </p>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: "var(--foreground-muted)" }}>{tCommon("priority")} *</label>
              <div className="grid grid-cols-2 gap-2">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setPriority(p.value)}
                    className="p-3 rounded-lg border-2 text-left transition-all"
                    style={{
                      borderColor: priority === p.value ? p.color : "var(--border)",
                      backgroundColor: priority === p.value ? p.bg : "var(--surface-0)",
                    }}
                  >
                    <p className="text-sm font-semibold" style={{ color: p.color }}>{p.label}</p>
                    <p className="text-[11px] mt-0.5 leading-tight" style={{ color: "var(--foreground-muted)" }}>{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-1" /> {tCommon("back")}
              </Button>
              <Button className="flex-1" disabled={!description.trim()} onClick={() => setStep(3)}>
                {t("review")} <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>{t("reviewSubmit")}</h2>
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{t("confirmDetails")}</p>
            </div>

            {sourceRunDiffId && (
              <input type="hidden" name="source_run_diff_id" value={sourceRunDiffId} />
            )}

            <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
              {[
                { label: tCommon("asset"),       value: `${selectedAsset?.name} (${selectedAsset?.tag})` },
                { label: tCommon("location"),    value: selectedAsset?.location ?? "—" },
                { label: tCommon("priority"),    value: priority },
                { label: t("assignedTo"),        value: t("unassignedAuto") },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between px-4 py-3">
                  <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>{label}</span>
                  <span className="text-xs font-medium text-right ml-4" style={{ color: "var(--foreground)" }}>{value}</span>
                </div>
              ))}
              <div className="px-4 py-3">
                <span className="text-xs block mb-1" style={{ color: "var(--foreground-muted)" }}>{tCommon("description")}</span>
                <p className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>{description}</p>
              </div>
            </div>

            {submitError && (
              <div className="p-3 rounded-lg border text-xs"
                style={{ borderColor: "#FECACA", backgroundColor: "#FEF2F2", color: "#991B1B" }}>
                {submitError}
              </div>
            )}

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-6 text-base font-semibold text-white shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                style={{ minHeight: 56 }}
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                {submitting ? "Saving…" : "Save Work Order"}
              </button>
              <Button
                variant="ghost"
                onClick={() => setStep(2)}
                disabled={submitting}
                className="w-full"
              >
                <ArrowLeft className="w-4 h-4 mr-1" /> {tCommon("edit")} details
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
