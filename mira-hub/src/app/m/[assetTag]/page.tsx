"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  AlertCircle,
  BookOpen,
  Bot,
  Loader2,
  MapPin,
  Package,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrCodeImage } from "@/components/qr-code";
import { API_BASE } from "@/lib/config";

type ChildAsset = {
  id: string;
  tag: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
};

type PublicAsset = {
  id: string;
  tag: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  type: string | null;
  location: string | null;
  criticality: string;
  qrGeneratedAt: string | null;
  children?: ChildAsset[];
};

type RecentWorkOrder = {
  id: string;
  number: string;
  title: string;
  status: string;
  createdAt: string | null;
};

const TELEGRAM_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "FactoryLMDiagnose_bot";

export default function MobileAssetPage({
  params,
}: {
  params: Promise<{ assetTag: string }>;
}) {
  const { assetTag: rawTag } = use(params);
  const assetTag = decodeURIComponent(rawTag);
  const session = useSession();
  const isAuthed = session.status === "authenticated";

  const [asset, setAsset] = useState<PublicAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentWos, setRecentWos] = useState<RecentWorkOrder[]>([]);
  const [shareUrl, setShareUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setShareUrl(`${window.location.origin}/m/${assetTag}`);
    }
  }, [assetTag]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/public/assets/by-tag/${encodeURIComponent(assetTag)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: PublicAsset) => {
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

  // Authed-only enrichment: pull recent work orders for this asset.
  useEffect(() => {
    if (!isAuthed || !asset?.id) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/workorders?assetId=${encodeURIComponent(asset.id)}&limit=5`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: RecentWorkOrder[]) => {
        if (!cancelled && Array.isArray(data)) setRecentWos(data);
      })
      .catch(() => {
        /* read-only enrichment, fail silently */
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthed, asset?.id]);

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
              No asset matches tag <code className="font-mono">{assetTag}</code>
              {error ? ` (${error})` : ""}.
            </p>
            <Link href="/" className="text-sm text-red-700 underline mt-2 inline-block">
              factorylm.com
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Telegram deep-link: passes the asset tag to the bot, which loads
  // equipment context before greeting. Prefix `asset_` lets the start
  // handler distinguish from invite tokens.
  const tgDeepLink = `https://t.me/${TELEGRAM_BOT}?start=asset_${encodeURIComponent(asset.tag)}`;

  // Work-order creation requires login. Pass returnTo so the user lands
  // back on the WO form once authenticated.
  const newWoUrl = `/workorders/new?assetId=${encodeURIComponent(asset.id)}&assetTag=${encodeURIComponent(asset.tag)}`;
  const newWoHref = isAuthed
    ? newWoUrl
    : `/login?callbackUrl=${encodeURIComponent(newWoUrl)}`;

  // Manual lookup: filter the library by manufacturer + model. Public for
  // anyone with an asset tag — manuals live outside the tenant boundary.
  const manualsHref = (() => {
    const params = new URLSearchParams();
    if (asset.manufacturer) params.set("manufacturer", asset.manufacturer);
    if (asset.model) params.set("model", asset.model);
    return `/library?${params.toString()}`;
  })();

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-16">
      {/* Asset header — large, high-contrast, glove-friendly */}
      <div className="mb-5">
        <div className="text-xs font-mono uppercase tracking-wide text-slate-500">
          {asset.tag}
        </div>
        <h1 className="text-3xl font-semibold leading-tight mt-1">{asset.name}</h1>
        {asset.criticality && asset.criticality !== "medium" ? (
          <div className="mt-2 inline-block text-xs font-medium px-2 py-1 rounded bg-amber-100 text-amber-900 capitalize">
            {asset.criticality} criticality
          </div>
        ) : null}
      </div>

      {/* Specs */}
      <div className="rounded-lg border bg-white p-4 space-y-3 text-base">
        {asset.manufacturer || asset.model ? (
          <Row icon={<Package className="h-5 w-5" />} label="Make / Model">
            {[asset.manufacturer, asset.model].filter(Boolean).join(" • ") || "—"}
          </Row>
        ) : null}
        {asset.location ? (
          <Row icon={<MapPin className="h-5 w-5" />} label="Location">
            {asset.location}
          </Row>
        ) : null}
        {asset.type ? (
          <Row icon={<Wrench className="h-5 w-5" />} label="Type">
            {asset.type}
          </Row>
        ) : null}
      </div>

      {/* Three primary actions — large, thumb-friendly */}
      <div className="mt-5 grid gap-3">
        <Button
          asChild
          size="lg"
          className="w-full h-14 text-base font-semibold"
          style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", color: "#fff" }}
        >
          <a href={tgDeepLink} target="_blank" rel="noopener noreferrer">
            <Bot className="h-5 w-5 mr-2" />
            Ask MIRA about this equipment
          </a>
        </Button>

        <Button asChild size="lg" variant="outline" className="w-full h-14 text-base font-semibold">
          <Link href={newWoHref}>
            <Wrench className="h-5 w-5 mr-2" />
            Create Work Order
            {!isAuthed ? <span className="ml-2 text-xs font-normal text-slate-500">(login)</span> : null}
          </Link>
        </Button>

        <Button asChild size="lg" variant="outline" className="w-full h-14 text-base font-semibold">
          <Link href={manualsHref}>
            <BookOpen className="h-5 w-5 mr-2" />
            View Manuals
          </Link>
        </Button>
      </div>

      {/* Authed-only: recent work orders */}
      {isAuthed && recentWos.length > 0 ? (
        <div className="mt-6">
          <h2 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Recent work orders</h2>
          <div className="rounded-lg border bg-white divide-y">
            {recentWos.map((wo) => (
              <Link
                key={wo.id}
                href={`/workorders/${wo.id}`}
                className="flex items-center justify-between gap-3 p-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{wo.title || wo.number}</div>
                  <div className="text-xs text-slate-500 font-mono">
                    {wo.number}
                    {wo.createdAt ? ` · ${new Date(wo.createdAt).toLocaleDateString()}` : ""}
                  </div>
                </div>
                <span className="text-xs uppercase tracking-wide px-2 py-0.5 rounded bg-slate-100 text-slate-700 shrink-0">
                  {wo.status}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {/* Sub-components */}
      {asset.children && asset.children.length > 0 ? (
        <div className="mt-6">
          <h2 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Sub-components</h2>
          <div className="rounded-lg border bg-white divide-y">
            {asset.children.map((child) => (
              <Link
                key={child.id}
                href={child.tag ? `/m/${encodeURIComponent(child.tag)}` : `/assets/${child.id}`}
                className="flex items-center justify-between gap-3 p-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{child.name || "Unnamed"}</div>
                  {child.tag ? (
                    <div className="text-xs font-mono text-slate-500">{child.tag}</div>
                  ) : null}
                </div>
                <Package className="h-4 w-4 text-slate-400 shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {/* QR for re-sharing */}
      {shareUrl ? (
        <div className="mt-8 flex flex-col items-center text-center text-xs text-slate-500">
          <QrCodeImage value={shareUrl} size={144} />
          <div className="mt-2 font-mono">{asset.tag}</div>
          <div>Scan to share this asset</div>
        </div>
      ) : null}

      {/* Footer — branded CTA for unauthenticated visitors */}
      <footer className="mt-10 border-t pt-6 text-center text-xs text-slate-500">
        {isAuthed ? (
          <Link href="/feed" className="font-medium text-slate-700">
            ← Back to dashboard
          </Link>
        ) : (
          <>
            <div>
              Powered by <span className="font-semibold text-slate-700">FactoryLM</span>
            </div>
            <Link
              href="/signup"
              className="mt-2 inline-block text-blue-600 font-medium underline-offset-2 hover:underline"
            >
              Get MIRA for your plant →
            </Link>
          </>
        )}
      </footer>
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

