"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Bot,
  Calendar,
  Loader2,
  MapPin,
  Package,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrCodeImage } from "@/components/qr-code";
import { API_BASE } from "@/lib/config";

type Asset = {
  id: string;
  tag: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  type: string | null;
  location: string | null;
  criticality: string;
  lastWorkOrder: string | null;
  lastMaintenance: string | null;
};

const TELEGRAM_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "MiraFactoryBot";

export default function MobileAssetPage({
  params,
}: {
  params: Promise<{ assetTag: string }>;
}) {
  const { assetTag: rawTag } = use(params);
  const assetTag = decodeURIComponent(rawTag);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setShareUrl(`${window.location.origin}/m/${assetTag}`);
    }
  }, [assetTag]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/assets/by-tag/${encodeURIComponent(assetTag)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setAsset(data);
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
  }, [assetTag]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="max-w-md mx-auto p-6 pt-12">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
          <div>
            <h1 className="font-semibold text-red-900">Asset not found</h1>
            <p className="text-sm text-red-800 mt-1">
              No asset matches tag <code className="font-mono">{assetTag}</code>{error ? ` (${error})` : ""}.
            </p>
            <Link href="/assets" className="text-sm text-red-700 underline mt-2 inline-block">
              Browse all assets
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const tgDeepLink = `https://t.me/${TELEGRAM_BOT}?start=asset_${encodeURIComponent(asset.tag)}`;
  const newWoUrl = `/workorders/new?assetId=${encodeURIComponent(String(asset.id))}&assetTag=${encodeURIComponent(asset.tag)}`;

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-12">
      {/* Asset header */}
      <div className="mb-4">
        <div className="text-xs font-mono uppercase tracking-wide text-slate-500">
          {asset.tag}
        </div>
        <h1 className="text-2xl font-semibold leading-tight mt-1">{asset.name}</h1>
        {asset.criticality && asset.criticality !== "medium" ? (
          <div className="mt-2 inline-block text-xs font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-900 capitalize">
            {asset.criticality} criticality
          </div>
        ) : null}
      </div>

      {/* Specs card */}
      <div className="rounded-lg border bg-white p-4 space-y-3 text-sm">
        {asset.manufacturer || asset.model ? (
          <Row icon={<Package className="h-4 w-4" />} label="Make / Model">
            {[asset.manufacturer, asset.model].filter(Boolean).join(" • ") || "—"}
          </Row>
        ) : null}
        {asset.location ? (
          <Row icon={<MapPin className="h-4 w-4" />} label="Location">
            {asset.location}
          </Row>
        ) : null}
        {asset.lastWorkOrder ? (
          <Row icon={<Wrench className="h-4 w-4" />} label="Last work order">
            {new Date(asset.lastWorkOrder).toLocaleDateString()}
          </Row>
        ) : null}
        {asset.lastMaintenance ? (
          <Row icon={<Calendar className="h-4 w-4" />} label="Last maintenance">
            {new Date(asset.lastMaintenance).toLocaleDateString()}
          </Row>
        ) : null}
      </div>

      {/* Actions */}
      <div className="mt-4 grid gap-2">
        <Button asChild size="lg" className="w-full">
          <a href={tgDeepLink} target="_blank" rel="noopener noreferrer">
            <Bot className="h-4 w-4 mr-2" />
            Chat with MIRA about this equipment
          </a>
        </Button>
        <Button asChild size="lg" variant="outline" className="w-full">
          <Link href={newWoUrl}>
            <Wrench className="h-4 w-4 mr-2" />
            Create Work Order
          </Link>
        </Button>
        <Button asChild size="lg" variant="ghost" className="w-full">
          <Link href={`/assets/${asset.id}`}>Open full asset detail</Link>
        </Button>
      </div>

      {/* QR for sharing this page */}
      {shareUrl ? (
        <div className="mt-8 flex flex-col items-center text-center text-xs text-slate-500">
          <QrCodeImage value={shareUrl} size={144} />
          <div className="mt-2 font-mono">{asset.tag}</div>
          <div>Scan to share this asset</div>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="text-slate-400 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <div className="text-slate-900">{children}</div>
      </div>
    </div>
  );
}
