"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Radar, RefreshCw, Upload, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { API_BASE } from "@/lib/config";
import { DeviceTable } from "@/components/discovery/device-table";
import { validateInventory, type FieldbusInventory } from "@/lib/discovery";

export default function DiscoveryPage() {
  const [inventory, setInventory] = useState<FieldbusInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch the latest inventory on mount and whenever the user hits Refresh
  // (bumping reloadKey). The loader is defined inside the effect so all
  // state updates are post-await / cancellation-guarded.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/discovery`, { cache: "no-store" });
        if (!res.ok) throw new Error(`load failed (${res.status})`);
        const data = (await res.json()) as { inventory: FieldbusInventory | null };
        if (cancelled) return;
        setInventory(data.inventory);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load discovery results.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  const upload = useCallback(async (file: File) => {
    setUploadError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setUploadError(`${file.name} is not valid JSON.`);
      return;
    }
    // Fail fast client-side with a friendly message before the round-trip.
    const local = validateInventory(parsed);
    if (!local.ok) {
      setUploadError(local.error);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? `upload failed (${res.status})`);
        return;
      }
      setInventory(data.inventory as FieldbusInventory);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void upload(file);
    },
    [upload],
  );

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Radar className="text-[--brand-blue]" style={{ width: 22, height: 22 }} />
          <div>
            <h1 className="text-lg font-semibold text-[--foreground]">Discovery</h1>
            <p className="text-sm text-[--foreground-muted]">
              Field devices found by <span className="font-mono">plc/discover.py</span> on the plant network.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw style={{ width: 15, height: 15 }} className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </header>

      {/* Upload dropzone — the cloud Hub can't reach a plant LAN, so the
          technician runs the scan on-site and uploads the inventory.json. */}
      <Card
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={`p-5 border-2 border-dashed flex flex-col items-center gap-2 text-center transition-colors ${
          dragActive ? "border-[--brand-blue] bg-[--surface-1]" : "border-[--border]"
        }`}
        data-testid="discovery-dropzone"
      >
        <Upload className="text-[--foreground-muted]" style={{ width: 20, height: 20 }} />
        <p className="text-sm text-[--foreground]">
          Drop an <span className="font-mono">inventory.json</span> here, or
        </p>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          Choose file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
        {uploadError && (
          <p className="flex items-center gap-1.5 text-sm text-[--status-red]" data-testid="upload-error">
            <AlertCircle style={{ width: 15, height: 15 }} />
            {uploadError}
          </p>
        )}
      </Card>

      {error ? (
        <Card className="p-4 flex items-center gap-2 text-sm text-[--status-red]">
          <AlertCircle style={{ width: 16, height: 16 }} />
          {error}
        </Card>
      ) : loading ? (
        <p className="text-sm text-[--foreground-muted]">Loading…</p>
      ) : (
        <DeviceTable inventory={inventory} />
      )}
    </div>
  );
}
