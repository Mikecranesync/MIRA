"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Search, QrCode, Camera, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/* ─── Mock asset search results ─────────────────────────────────────── */
const ASSET_OPTIONS = [
  { id: "1", name: "Air Compressor #1",  tag: "MC-AC-001", location: "Building A" },
  { id: "2", name: "Conveyor Belt #3",   tag: "MC-CB-003", location: "Building B" },
  { id: "3", name: "CNC Mill #7",        tag: "MC-CN-007", location: "Shop Floor" },
  { id: "4", name: "HVAC Unit #2",       tag: "MC-HV-002", location: "Roof" },
  { id: "5", name: "Pump Station A",     tag: "MC-PS-00A", location: "Basement" },
];

const PRIORITIES = [
  { value: "Low",      desc: "Planned / no urgency",              color: "#64748B", bg: "#F1F5F9" },
  { value: "Medium",   desc: "Needs attention within a week",     color: "#EAB308", bg: "#FEF9C3" },
  { value: "High",     desc: "Significant impact, act within 48h", color: "#EA580C", bg: "#FFF7ED" },
  { value: "Critical", desc: "Production down or safety risk",     color: "#DC2626", bg: "#FEE2E2" },
];

export default function NewWorkOrderPage() {
  const [step, setStep] = useState(1);
  const [assetQuery, setAssetQuery] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<typeof ASSET_OPTIONS[0] | null>(null);
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [submitted, setSubmitted] = useState(false);

  const filteredAssets = ASSET_OPTIONS.filter(a =>
    !assetQuery || a.name.toLowerCase().includes(assetQuery.toLowerCase()) || a.tag.includes(assetQuery)
  );

  function submit() {
    setSubmitted(true);
    setTimeout(() => {}, 1500);
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{ backgroundColor: "#DCFCE7" }}>
          <CheckCircle2 className="w-8 h-8" style={{ color: "#16A34A" }} />
        </div>
        <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--foreground)" }}>
          Work Order Created
        </h2>
        <p className="text-sm mb-1" style={{ color: "var(--foreground-muted)" }}>
          WO-2026-{String(Math.floor(Math.random() * 900) + 100)}
        </p>
        <p className="text-sm mb-8" style={{ color: "var(--foreground-muted)" }}>
          {selectedAsset?.name} · {priority} priority
        </p>
        <div className="flex gap-3">
          <Link href="/workorders">
            <Button variant="secondary">View All Work Orders</Button>
          </Link>
          <Button onClick={() => { setStep(1); setSubmitted(false); setSelectedAsset(null); setDescription(""); setPriority("Medium"); setAssetQuery(""); }}>
            Create Another
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
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>New Work Order</h1>
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
                  {s === 1 ? "Select Asset" : s === 2 ? "Describe Issue" : "Review"}
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
              <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>Select Asset</h2>
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>Search by name or tag, or scan the QR code on the equipment.</p>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
                <Input placeholder="Search assets…" value={assetQuery} onChange={e => setAssetQuery(e.target.value)} className="pl-9" />
              </div>
              <Button variant="outline" size="icon" title="Scan QR">
                <QrCode className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-2">
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
                        {asset.tag} · {asset.location}
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
              Continue <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 2: Describe Issue */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>Describe the Issue</h2>
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                Asset: <strong style={{ color: "var(--foreground)" }}>{selectedAsset?.name}</strong>
              </p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--foreground-muted)" }}>
                Issue Description *
              </label>
              <textarea
                rows={5}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Describe what you're seeing, heard, or measured. Include any relevant readings."
                className="w-full rounded-lg border px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--surface-0)",
                  color: "var(--foreground)",
                  "--tw-ring-color": "var(--brand-blue)",
                } as React.CSSProperties}
              />
              <p className="text-[11px] mt-1" style={{ color: "var(--foreground-subtle)" }}>
                MIRA will use this to suggest troubleshooting steps.
              </p>
            </div>

            {/* Photo upload placeholder */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--foreground-muted)" }}>Photos (optional)</label>
              <button
                className="w-full border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-2 transition-colors hover:border-blue-400"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)" }}
              >
                <Camera className="w-8 h-8" style={{ color: "var(--foreground-subtle)" }} />
                <span className="text-sm" style={{ color: "var(--foreground-muted)" }}>Tap to add photos</span>
                <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>JPG, PNG up to 20MB</span>
              </button>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: "var(--foreground-muted)" }}>Priority *</label>
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
                    <p className="text-sm font-semibold" style={{ color: p.color }}>{p.value}</p>
                    <p className="text-[11px] mt-0.5 leading-tight" style={{ color: "var(--foreground-muted)" }}>{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button className="flex-1" disabled={!description.trim()} onClick={() => setStep(3)}>
                Review <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>Review & Submit</h2>
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>Confirm the details before creating the work order.</p>
            </div>

            <div className="card divide-y" style={{ divideColor: "var(--border)" }}>
              {[
                { label: "Asset",       value: `${selectedAsset?.name} (${selectedAsset?.tag})` },
                { label: "Location",    value: selectedAsset?.location ?? "—" },
                { label: "Priority",    value: priority },
                { label: "Assigned To", value: "Unassigned (auto-assign later)" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between px-4 py-3">
                  <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>{label}</span>
                  <span className="text-xs font-medium text-right ml-4" style={{ color: "var(--foreground)" }}>{value}</span>
                </div>
              ))}
              <div className="px-4 py-3">
                <span className="text-xs block mb-1" style={{ color: "var(--foreground-muted)" }}>Description</span>
                <p className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>{description}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-1" /> Edit
              </Button>
              <Button className="flex-1" onClick={submit}>
                Create Work Order
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
