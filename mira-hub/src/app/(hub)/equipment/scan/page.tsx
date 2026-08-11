"use client";

// Scan machine — capture/upload a nameplate, get an EDITABLE candidate identity,
// confirm, create a notebook. The AI result is never labeled "identified": a
// low-confidence result says "Check these fields before continuing" (PRD §10).
// Camera capture with a gallery-upload fallback (accessibility §26).

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/config";

type Candidate = {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
  serialNumber?: string | null;
  equipmentType?: string | null;
  confidence?: number;
};

const FIELDS: { key: keyof Candidate; label: string }[] = [
  { key: "manufacturer", label: "Manufacturer" },
  { key: "model", label: "Model" },
  { key: "catalogNumber", label: "Catalog / part number" },
  { key: "serialNumber", label: "Serial number" },
  { key: "equipmentType", label: "Equipment type" },
];

export default function ScanPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"capture" | "recognizing" | "confirm">("capture");
  const [candidate, setCandidate] = useState<Candidate>({});
  const [displayName, setDisplayName] = useState("");
  const [location, setLocation] = useState("");
  const [confidence, setConfidence] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const onFile = useCallback(async (file: File) => {
    setStage("recognizing");
    setError(null);
    const form = new FormData();
    form.append("image", file);
    try {
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/recognize-nameplate/`, {
        method: "POST",
        body: form,
      });
      if (res.status === 503) {
        setError(
          "Nameplate recognition isn't available on this deployment. You can still type the details below.",
        );
        setCandidate({});
        setStage("confirm");
        return;
      }
      if (!res.ok) throw new Error();
      const data = await res.json();
      const c: Candidate = data.candidate ?? {};
      setCandidate(c);
      setConfidence(c.confidence);
      setDisplayName([c.manufacturer, c.model].filter(Boolean).join(" ") || "");
      setStage("confirm");
    } catch {
      setError("Couldn't read that image. Try again or enter the details manually.");
      setCandidate({});
      setStage("confirm");
    }
  }, []);

  const create = useCallback(async () => {
    const name = displayName.trim() || [candidate.manufacturer, candidate.model].filter(Boolean).join(" ").trim();
    if (!name) {
      setError("Give this equipment a name before continuing.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: name,
          manufacturer: candidate.manufacturer ?? null,
          model: candidate.model ?? null,
          catalogNumber: candidate.catalogNumber ?? null,
          serialNumber: candidate.serialNumber ?? null,
          equipmentType: candidate.equipmentType ?? null,
          locationLabel: location.trim() || null,
          identityStatus: "user_confirmed",
          identitySourceType: "nameplate_image",
          identityConfidence: confidence ?? null,
          identityObservation: candidate,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      window.location.href = `${API_BASE}/equipment/${data.notebook.id}`;
    } catch {
      setError("Couldn't create the notebook.");
      setCreating(false);
    }
  }, [displayName, location, candidate, confidence]);

  const lowConfidence = confidence != null && confidence < 0.7;

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6" style={{ color: "var(--foreground)" }}>
      <header className="mb-4 flex items-center gap-2">
        <Link href={`${API_BASE}/equipment`} aria-label="Back" style={{ color: "var(--foreground-muted)" }}>
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg font-semibold">Scan machine</h1>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />

      {error && (
        <p className="mb-3 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--status-yellow-bg)", color: "var(--foreground)" }} role="alert">
          {error}
        </p>
      )}

      {stage === "capture" && (
        <button
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center gap-3 rounded-xl px-6 py-12"
          style={{ border: "1px dashed var(--border)", background: "var(--surface-1)" }}
        >
          <Camera size={36} aria-hidden style={{ color: "var(--brand-blue)" }} />
          <span className="font-medium">Take a photo of the nameplate</span>
          <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>
            or choose an image from your gallery
          </span>
        </button>
      )}

      {stage === "recognizing" && (
        <div className="flex flex-col items-center gap-3 py-12" style={{ color: "var(--foreground-muted)" }}>
          <Loader2 size={28} className="animate-spin" aria-hidden />
          <span className="text-sm">Reading the nameplate…</span>
        </div>
      )}

      {stage === "confirm" && (
        <div>
          <p className="mb-3 text-sm" style={{ color: "var(--foreground-muted)" }}>
            {lowConfidence
              ? "I found a possible match. Check these fields before continuing."
              : "Check these fields before continuing — you can correct anything."}
          </p>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
              Notebook name
            </span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Conveyor 4"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ border: "1px solid var(--border)", background: "var(--surface-0)", color: "var(--foreground)" }}
            />
          </label>
          {FIELDS.map((f) => (
            <label key={f.key} className="mb-2 block">
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
                {f.label}
              </span>
              <input
                value={(candidate[f.key] as string) ?? ""}
                onChange={(e) => setCandidate((c) => ({ ...c, [f.key]: e.target.value || null }))}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ border: "1px solid var(--border)", background: "var(--surface-0)", color: "var(--foreground)" }}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
          ))}
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
              Location / asset tag (optional)
            </span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. MCC-2 / Bucket 17"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ border: "1px solid var(--border)", background: "var(--surface-0)", color: "var(--foreground)" }}
            />
          </label>
          <button
            onClick={create}
            disabled={creating}
            className="w-full rounded-lg px-4 py-3 text-sm font-medium"
            style={{ background: "var(--brand-blue)", color: "white", opacity: creating ? 0.6 : 1 }}
          >
            {creating ? "Creating…" : "Create notebook"}
          </button>
        </div>
      )}
    </div>
  );
}
