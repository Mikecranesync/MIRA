"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ASSETS = ["Air Compressor #1", "Conveyor Belt #3", "CNC Mill #7", "Pump Station A", "HVAC Unit #2", "Generator #1", "Electrical — Bay 3", "Other / Unknown"];
const AREAS = ["Building A", "Building B", "Shop Floor", "Roof", "Basement", "Electrical Room", "Tank Room", "Outdoor"];
const PRIORITIES = [
  { value: "low",      label: "Low",      desc: "Planned / no urgency",           color: "#64748B", bg: "#F1F5F9" },
  { value: "medium",   label: "Medium",   desc: "Needs attention within a week",  color: "#EAB308", bg: "#FEF9C3" },
  { value: "high",     label: "High",     desc: "Significant impact — 48h",       color: "#EA580C", bg: "#FFF7ED" },
  { value: "critical", label: "Critical", desc: "Production down / safety risk",  color: "#DC2626", bg: "#FEE2E2" },
];

export default function NewRequestPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [asset, setAsset] = useState("");
  const [area, setArea] = useState("");
  const [priority, setPriority] = useState("medium");
  const [submitted, setSubmitted] = useState(false);

  function submit() {
    if (!title || !asset) return;
    setSubmitted(true);
    setTimeout(() => router.push("/requests"), 2000);
  }

  if (submitted) {
    return (
      <div className="min-h-full flex items-center justify-center" style={{ backgroundColor: "var(--background)" }}>
        <div className="text-center px-6">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "#DCFCE7" }}>
            <CheckCircle2 className="w-8 h-8" style={{ color: "#16A34A" }} />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--foreground)" }}>Request Submitted</h2>
          <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>Your request has been sent to the maintenance team for review.</p>
          <p className="text-xs mt-3" style={{ color: "var(--foreground-subtle)" }}>Redirecting to requests…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <Link href="/requests" className="inline-flex items-center gap-1 text-xs mb-2" style={{ color: "var(--brand-blue)" }}>
            <ArrowLeft className="w-3.5 h-3.5" />Requests
          </Link>
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>New Maintenance Request</h1>
        </div>
      </div>

      <div className="px-4 md:px-6 py-5 max-w-xl space-y-5">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: "var(--foreground-subtle)" }}>Issue Title *</label>
          <Input placeholder="e.g. Pump making grinding noise" value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: "var(--foreground-subtle)" }}>Asset / Equipment *</label>
          <select value={asset} onChange={e => setAsset(e.target.value)}
            className="w-full text-sm px-3 py-2.5 rounded-lg border"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground)" }}>
            <option value="">Select an asset…</option>
            {ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: "var(--foreground-subtle)" }}>Location / Area</label>
          <select value={area} onChange={e => setArea(e.target.value)}
            className="w-full text-sm px-3 py-2.5 rounded-lg border"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground)" }}>
            <option value="">Select area…</option>
            {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide mb-2 block" style={{ color: "var(--foreground-subtle)" }}>Priority / Urgency</label>
          <div className="grid grid-cols-2 gap-2">
            {PRIORITIES.map(p => (
              <button key={p.value} onClick={() => setPriority(p.value)}
                className="p-3 rounded-xl border-2 text-left transition-all"
                style={{
                  borderColor: priority === p.value ? p.color : "var(--border)",
                  backgroundColor: priority === p.value ? p.bg : "var(--surface-0)",
                }}>
                <p className="text-sm font-semibold" style={{ color: p.color }}>{p.label}</p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--foreground-muted)" }}>{p.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: "var(--foreground-subtle)" }}>Description</label>
          <textarea rows={4} placeholder="Describe the issue — when it started, what you observed, any sounds or smells…"
            value={description} onChange={e => setDescription(e.target.value)}
            className="w-full text-sm px-3 py-2.5 rounded-lg border resize-none"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground)" }} />
        </div>

        <Button onClick={submit} className="w-full h-11 text-sm font-semibold"
          style={!title || !asset ? { opacity: 0.5, pointerEvents: "none" } : {}}>
          Submit Request
        </Button>
        <Link href="/requests">
          <Button variant="outline" className="w-full h-10 text-sm">Cancel</Button>
        </Link>
      </div>
    </div>
  );
}
