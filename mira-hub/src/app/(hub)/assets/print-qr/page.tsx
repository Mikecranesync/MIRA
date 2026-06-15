"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrCodeImage } from "@/components/qr-code";
import { API_BASE } from "@/lib/config";

type Asset = {
  id: string;
  tag: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  location: string | null;
};

export default function PrintQrPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/assets/`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Asset[]) => {
        if (cancelled) return;
        setAssets(data);
        setSelected(new Set(data.map((a) => a.id)));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const visible = useMemo(
    () => assets.filter((a) => selected.has(a.id)),
    [assets, selected],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(assets.map((a) => a.id)));
  }
  function clear() {
    setSelected(new Set());
  }

  return (
    <div className="min-h-screen p-6 print:p-0" style={{ backgroundColor: "var(--background)" }}>
      {/* Toolbar — hidden on print */}
      <div className="print:hidden max-w-5xl mx-auto mb-6 flex items-center justify-between gap-3 flex-wrap">
        <Link
          href="/assets"
          className="inline-flex items-center gap-1.5 text-sm"
          style={{ color: "var(--brand-blue)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to assets
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={selectAll}>Select all</Button>
          <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>
          <Button size="sm" onClick={() => window.print()} disabled={visible.length === 0}>
            <Printer className="w-4 h-4 mr-1.5" />
            Print {visible.length} label{visible.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      {/* Selection list — hidden on print */}
      {!loading && !error && assets.length > 0 ? (
        <div className="print:hidden max-w-5xl mx-auto mb-6 rounded-lg border bg-white p-4">
          <div className="text-sm font-medium mb-2">Assets to print</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
            {assets.map((a) => (
              <label key={a.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={() => toggle(a.id)}
                />
                <span className="font-mono text-xs">{a.tag}</span>
                <span className="text-slate-600 truncate">{a.name}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
        </div>
      ) : null}

      {error ? (
        <div className="max-w-md mx-auto rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load assets: {error}
        </div>
      ) : null}

      {/* Label sheet — visible on screen and print */}
      <div className="max-w-5xl mx-auto grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 print:grid-cols-3 print:gap-2">
        {visible.map((a) => (
          <div
            key={a.id}
            className="border rounded p-3 flex flex-col items-center text-center bg-white print:break-inside-avoid"
            style={{ borderColor: "var(--border)" }}
          >
            <QrCodeImage value={`${origin}/m/${a.tag}`} size={144} />
            <div className="mt-2 font-mono text-xs">{a.tag}</div>
            <div className="text-xs font-medium leading-tight mt-1 line-clamp-2">{a.name}</div>
            {a.location ? (
              <div className="text-[10px] text-slate-500 leading-tight mt-1 line-clamp-1">{a.location}</div>
            ) : null}
          </div>
        ))}
      </div>

      {!loading && visible.length === 0 && !error ? (
        <div className="text-center text-sm text-slate-500 py-12 print:hidden">
          No assets selected.
        </div>
      ) : null}
    </div>
  );
}
