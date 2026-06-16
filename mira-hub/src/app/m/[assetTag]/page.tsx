"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import {
  AlertCircle,
  BookOpen,
  Bot,
  CheckCircle2,
  ClipboardList,
  Loader2,
  LogIn,
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

type ExternalIds = {
  cmmsId: string | null;
  plcTag: string | null;
  scadaPath: string | null;
  manufacturerPartNumber: string | null;
  unsTopicPath: string | null;
  erpAssetId: string | null;
  drawingReference: string | null;
};

type AssetView = {
  id: string;
  tag: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  type: string | null;
  location: string | null;
  criticality: string;
  qrGeneratedAt: string | null;
  externalIds?: ExternalIds;
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
  const sessionStatus = session.status;

  const [asset, setAsset] = useState<AssetView | null>(null);
  const [loading, setLoading] = useState(true);
  // 401 = no session, 403 = wrong tenant, 404 = not visible to this tenant
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [recentWos, setRecentWos] = useState<RecentWorkOrder[]>([]);
  const [shareUrl, setShareUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setShareUrl(`${window.location.origin}/m/${assetTag}`);
    }
  }, [assetTag]);

  // No redirect for unauthenticated visitors — they see a guest landing
  // with two choices: sign in (OAuth) or report an issue without an account.

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    let cancelled = false;
    setLoading(true);
    setErrorStatus(null);
    fetch(`${API_BASE}/api/assets/by-tag/${encodeURIComponent(assetTag)}/`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setErrorStatus(res.status);
          return null;
        }
        return res.json();
      })
      .then((data: AssetView | null) => {
        if (!cancelled && data) setAsset(data);
      })
      .catch(() => {
        if (!cancelled) setErrorStatus(500);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetTag, sessionStatus]);

  // Recent work orders for this asset (same tenant, RLS-scoped).
  useEffect(() => {
    if (!isAuthed || !asset?.id) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/workorders/?assetId=${encodeURIComponent(asset.id)}&limit=5`)
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

  if (sessionStatus === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (sessionStatus === "unauthenticated") {
    return <GuestLanding assetTag={assetTag} apiBase={API_BASE} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (errorStatus || !asset) {
    // The /api/assets/by-tag endpoint is RLS-scoped, so a 404 means the
    // asset is either non-existent OR belongs to another tenant. We don't
    // distinguish in the UI to avoid confirming the existence of another
    // tenant's data — the same "no access" copy covers both.
    const isAccessIssue = errorStatus === 404 || errorStatus === 403;
    return (
      <div className="max-w-md mx-auto p-6 pt-12">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3">
          <AlertCircle className="h-5 w-5 text-amber-700 shrink-0" />
          <div>
            <h1 className="font-semibold text-amber-900">
              {isAccessIssue ? "You don't have access to this asset" : "Couldn't load this asset"}
            </h1>
            <p className="text-sm text-amber-800 mt-1">
              {isAccessIssue ? (
                <>
                  Tag <code className="font-mono">{assetTag}</code> isn't part of your
                  workspace. Ask your admin to add you to the right tenant or to
                  share the asset.
                </>
              ) : (
                <>
                  Something went wrong loading <code className="font-mono">{assetTag}</code>{" "}
                  (HTTP {errorStatus ?? "?"}). Try again in a moment.
                </>
              )}
            </p>
            <div className="mt-3 flex gap-3 text-sm">
              <Link href="/feed" className="text-amber-900 underline">
                Back to dashboard
              </Link>
              <a
                href="mailto:support@factorylm.com?subject=Access%20request%20for%20asset%20{assetTag}"
                className="text-amber-900 underline"
              >
                Contact your admin
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Telegram deep-link: passes the asset tag to the bot, which loads
  // equipment context before greeting. Prefix `asset_` lets the start
  // handler distinguish from invite tokens.
  const tgDeepLink = `https://t.me/${TELEGRAM_BOT}?start=asset_${encodeURIComponent(asset.tag)}`;

  // The page is auth-gated upstream, so we only get here with a valid
  // tenant-scoped session. WO creation links straight to the form.
  const newWoHref = `/workorders/new?assetId=${encodeURIComponent(asset.id)}&assetTag=${encodeURIComponent(asset.tag)}`;

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

      {/* External IDs (i3X interop) — collapsed by default, shown only when populated */}
      {asset.externalIds && Object.values(asset.externalIds).some(Boolean) ? (
        <details className="mt-4 rounded-lg border bg-white">
          <summary className="cursor-pointer px-4 py-3 text-xs uppercase tracking-wide text-slate-500 select-none">
            External IDs
          </summary>
          <dl className="px-4 pb-3 space-y-2 text-sm">
            {asset.externalIds.cmmsId ? (
              <ExtId label="CMMS ID" value={asset.externalIds.cmmsId} />
            ) : null}
            {asset.externalIds.plcTag ? (
              <ExtId label="PLC Tag" value={asset.externalIds.plcTag} />
            ) : null}
            {asset.externalIds.scadaPath ? (
              <ExtId label="SCADA Path" value={asset.externalIds.scadaPath} />
            ) : null}
            {asset.serialNumber ? (
              <ExtId label="Serial Number" value={asset.serialNumber} />
            ) : null}
            {asset.externalIds.manufacturerPartNumber ? (
              <ExtId label="Mfr Part #" value={asset.externalIds.manufacturerPartNumber} />
            ) : null}
            {asset.externalIds.unsTopicPath ? (
              <ExtId label="UNS Topic" value={asset.externalIds.unsTopicPath} />
            ) : null}
            {asset.externalIds.erpAssetId ? (
              <ExtId label="ERP Asset ID" value={asset.externalIds.erpAssetId} />
            ) : null}
            {asset.externalIds.drawingReference ? (
              <ExtId label="Drawing Ref" value={asset.externalIds.drawingReference} />
            ) : null}
          </dl>
        </details>
      ) : null}

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

      <footer className="mt-10 border-t pt-6 text-center text-xs text-slate-500">
        <Link href="/feed" className="font-medium text-slate-700">
          ← Back to dashboard
        </Link>
      </footer>
    </div>
  );
}

// ─── Guest landing (no session) ─────────────────────────────────────────────

function GuestLanding({ assetTag, apiBase }: { assetTag: string; apiBase: string }) {
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callbackUrl = typeof window !== "undefined"
    ? `${window.location.pathname}${window.location.search}`
    : `/m/${assetTag}`;

  async function handleReport(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/public/report/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipmentNumber: assetTag, description, contactInfo: contactInfo || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to submit — try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error — check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="max-w-md mx-auto px-4 pt-16 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 mb-2">Report submitted</h1>
        <p className="text-sm text-slate-600">
          The maintenance team has been notified and will follow up.
        </p>
        <p className="text-xs font-mono text-slate-400 mt-4">{assetTag}</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-10 pb-16">
      {/* Equipment tag header */}
      <div className="mb-8 text-center">
        <div className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-1">Equipment</div>
        <div className="text-2xl font-bold font-mono text-slate-900">{assetTag}</div>
      </div>

      {!showForm ? (
        /* Choice screen */
        <div className="space-y-3">
          <Button
            size="lg"
            className="w-full h-14 text-base font-semibold"
            style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", color: "#fff" }}
            onClick={() => signIn(undefined, { callbackUrl })}
          >
            <LogIn className="h-5 w-5 mr-2" />
            Sign in to view details
          </Button>
          <p className="text-center text-xs text-slate-400">or</p>
          <Button
            size="lg"
            variant="outline"
            className="w-full h-14 text-base font-semibold"
            onClick={() => setShowForm(true)}
          >
            <ClipboardList className="h-5 w-5 mr-2" />
            Report an issue (no account needed)
          </Button>
        </div>
      ) : (
        /* Guest report form */
        <form onSubmit={handleReport} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              What&apos;s the issue? *
            </label>
            <textarea
              rows={5}
              required
              maxLength={2000}
              placeholder="Describe what you observed — noises, smells, leaks, error codes, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full text-sm px-3 py-2.5 rounded-lg border border-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="text-right text-xs text-slate-400 mt-1">{description.length}/2000</div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Contact info <span className="font-normal normal-case">(optional — so we can follow up)</span>
            </label>
            <input
              type="text"
              maxLength={200}
              placeholder="Phone, email, or name"
              value={contactInfo}
              onChange={(e) => setContactInfo(e.target.value)}
              className="w-full text-sm px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full h-12 text-base font-semibold"
            disabled={!description.trim() || submitting}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit report
          </Button>

          <button
            type="button"
            className="w-full text-sm text-slate-500 py-2"
            onClick={() => setShowForm(false)}
          >
            ← Back
          </button>
        </form>
      )}
    </div>
  );
}

function ExtId({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500 sm:w-32 shrink-0">{label}</dt>
      <dd className="font-mono text-slate-900 break-all">{value}</dd>
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

