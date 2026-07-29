"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/config";
import { NoAccess } from "@/components/ui/no-access";

type ReviewItemType = "proposal" | "cartoon" | "screenshot" | "audit";

interface ReviewItem {
  id: string;
  type: ReviewItemType;
  title: string;
  previewUrl: string | null;
  body?: string | null;
  source: string;
  createdAt: string;
  meta?: Record<string, string>;
}

interface QueueResponse {
  items: ReviewItem[];
  counts: Record<ReviewItemType | "total", number>;
}

const TABS: Array<{ key: ReviewItemType | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "proposal", label: "Proposals" },
  { key: "cartoon", label: "Cartoons" },
  { key: "screenshot", label: "Screenshots" },
  { key: "audit", label: "Audit" },
];

export function ReviewQueue() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [counts, setCounts] = useState<QueueResponse["counts"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track auth failures separately so we render a clean no-access panel instead
  // of leaking a raw "HTTP 403" string to the user (#1932).
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<ReviewItemType | "all">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/admin/review/queue/`, { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          if (!cancelled) setDenied(true);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as QueueResponse;
        if (cancelled) return;
        setItems(data.items);
        setCounts(data.counts);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () => (tab === "all" ? items : items.filter((i) => i.type === tab)),
    [items, tab],
  );

  if (denied) {
    return (
      <NoAccess
        title="Review queue is admin-only"
        message="The review queue is limited to FactoryLM administrators. If you need access, contact your workspace owner."
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6" data-testid="review-page">
      <header className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">
          Review queue {counts ? `(${counts.total})` : ""}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Read-only preview of everything currently pending — KG proposals,
          cartoons, screenshots, audit findings. No actions wired yet; this
          surface is for visibility before any publish workflow lands.
        </p>
      </header>

      <div
        className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200"
        data-testid="review-tabs"
      >
        {TABS.map((t) => {
          const count = t.key === "all" ? counts?.total : counts?.[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap -mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === t.key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
              data-testid={`review-tab-${t.key}`}
            >
              {t.label}
              {typeof count === "number" && count > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading queue…
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {filtered.map((item) => (
            <ReviewCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ item }: { item: ReviewItem }) {
  const TypeIcon =
    item.type === "audit" ? AlertTriangle : item.type === "proposal" ? FileText : ImageIcon;
  return (
    <article
      className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4 shadow-sm"
      data-testid="review-card"
      data-item-id={item.id}
    >
      {item.previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.previewUrl}
          alt={item.title}
          className="mb-3 w-full rounded border border-slate-100 bg-slate-50 object-cover"
          style={{ maxHeight: 280 }}
          loading="lazy"
        />
      )}
      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
        <TypeIcon className="h-3.5 w-3.5" />
        <span>{item.type}</span>
        {item.meta?.severity && (
          <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-amber-800">
            {item.meta.severity}
          </span>
        )}
        {item.meta?.confidence && (
          <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-slate-600">
            {item.meta.confidence}
          </span>
        )}
      </div>
      <h2 className="text-sm font-semibold text-slate-900 break-words">{item.title}</h2>
      {item.body && (
        <p className="mt-1 line-clamp-3 text-sm text-slate-600">{item.body}</p>
      )}
      <p className="mt-2 text-xs text-slate-400 break-all">
        <span className="font-mono">{item.source}</span>
      </p>
      <p className="mt-1 text-xs text-slate-400">
        <time dateTime={item.createdAt}>
          {new Date(item.createdAt).toLocaleString()}
        </time>
      </p>
    </article>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center"
      data-testid="review-empty"
    >
      <h2 className="text-lg font-semibold text-slate-900">Nothing pending</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        No proposals, cartoons, screenshots, or audit findings to show right now.
      </p>
    </div>
  );
}
