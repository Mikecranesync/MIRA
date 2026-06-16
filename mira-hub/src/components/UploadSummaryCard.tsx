"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, AlertCircle, CalendarDays, BookOpen, Wrench, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/config";

type UploadStatus = "queued" | "fetching" | "parsing" | "parsed" | "failed" | "cancelled";

interface UploadSummaryData {
  id: string;
  filename: string;
  status: UploadStatus;
  statusDetail: string | null;
  pm_tasks_count: number;
  fault_codes_count: number;
  knowledge_chunks_count: number;
  // #1900: where the chunks landed + whether they're citable. A 'v2' upload is
  // attached to a kg_entities node (the per-tenant Inbox for blind PDFs) and is
  // answerable by that node's Ask MIRA. kgEntityId is the deep-link target.
  kgEntityId: string | null;
  ingestRoute: string | null;
}

const POLLING_INTERVAL_MS = 3_000;

// Stop polling once we hit a terminal status
const TERMINAL_STATUSES: ReadonlySet<UploadStatus> = new Set(["parsed", "failed", "cancelled"]);

// Counts are "ready" when status is parsed and at least one count is non-zero
// (or status is parsed — we show whatever we have, even all zeros)
function isComplete(data: UploadSummaryData): boolean {
  return TERMINAL_STATUSES.has(data.status);
}

interface StatBlockProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  loading: boolean;
  color: string;
}

function StatBlock({ icon, label, value, loading, color }: StatBlockProps) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-1 p-3 rounded-xl text-center"
      style={{ backgroundColor: "var(--surface-1)" }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + "18" }}>
        <span style={{ color }}>{icon}</span>
      </div>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin mt-1" style={{ color: "var(--foreground-subtle)" }} />
      ) : (
        <span className="text-xl font-bold leading-tight" style={{ color: "var(--foreground)" }}>
          {value}
        </span>
      )}
      <span className="text-[11px] leading-tight" style={{ color: "var(--foreground-muted)" }}>
        {label}
      </span>
    </div>
  );
}

export function UploadSummaryCard({ uploadId }: { uploadId: string }) {
  const [data, setData] = useState<UploadSummaryData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    async function poll() {
      if (!mountedRef.current) return;
      try {
        const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/`, { cache: "no-store" });
        if (!res.ok) {
          setFetchError(`Failed to load upload status (${res.status})`);
          return;
        }
        const json = (await res.json()) as UploadSummaryData;
        if (!mountedRef.current) return;
        setData(json);
        setFetchError(null);

        // Keep polling while the upload is still in flight
        if (!isComplete(json)) {
          timerRef.current = setTimeout(() => void poll(), POLLING_INTERVAL_MS);
        }
      } catch (err) {
        if (!mountedRef.current) return;
        setFetchError((err as Error).message);
      }
    }

    void poll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  if (fetchError) {
    return (
      <div
        className="card p-4 flex items-center gap-3"
        style={{ borderColor: "#DC262630" }}
      >
        <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: "#DC2626" }} />
        <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>{fetchError}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card p-4 flex items-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: "var(--brand-blue)" }} />
        <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>Loading upload summary…</p>
      </div>
    );
  }

  const processing = !isComplete(data);
  const failed = data.status === "failed";

  return (
    <div
      className="card p-4 space-y-4"
      style={failed ? { borderColor: "#DC262640" } : undefined}
    >
      {/* Banner */}
      <div className="flex items-center gap-2.5">
        {failed ? (
          <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: "#DC2626" }} />
        ) : processing ? (
          <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" style={{ color: "var(--brand-blue)" }} />
        ) : (
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: "#16A34A" }} />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
            {data.filename}
          </p>
          <p className="text-xs mt-0.5" style={{ color: failed ? "#DC2626" : processing ? "var(--brand-blue)" : "#16A34A" }}>
            {failed
              ? data.statusDetail
                ? `Failed: ${data.statusDetail}`
                : "Processing failed"
              : processing
              ? "Processing document…"
              : "Document indexed successfully"}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-2">
        <StatBlock
          icon={<CalendarDays className="w-4 h-4" />}
          label="PM Tasks Found"
          value={data.pm_tasks_count}
          loading={processing}
          color="#7C3AED"
        />
        <StatBlock
          icon={<Wrench className="w-4 h-4" />}
          label="Fault Codes"
          value={data.fault_codes_count}
          loading={processing}
          color="#EA580C"
        />
        <StatBlock
          icon={<BookOpen className="w-4 h-4" />}
          label="Knowledge Chunks"
          value={data.knowledge_chunks_count}
          loading={processing}
          color="#0891B2"
        />
      </div>

      {/* CTAs — only shown once processing is done */}
      {!processing && !failed && (
        <div className="space-y-2 pt-1">
          {/* #1900 keystone: a manual that "Parsed" is useless until the user can
              ASK about it. When the upload is citable (v2, attached to a node),
              lead with a deep-link straight into that node's Ask MIRA so the
              obvious next action — ask a question — is one click, not a hunt
              through Namespace → folder → Ask MIRA. */}
          {data.ingestRoute === "v2" && data.knowledge_chunks_count > 0 && (
            <Button asChild size="sm" className="w-full text-xs gap-1.5">
              <Link
                href={`/namespace?node=${data.kgEntityId ?? "inbox"}&chat=1`}
                data-testid="upload-ask-mira-cta"
              >
                <Bot className="w-3.5 h-3.5" />
                Ask MIRA about this manual
              </Link>
            </Button>
          )}
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline" className="flex-1 text-xs gap-1.5">
              <Link href="/schedule">
                <CalendarDays className="w-3.5 h-3.5" />
                View PM Schedule
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="flex-1 text-xs gap-1.5">
              <Link href="/knowledge/manuals">
                <BookOpen className="w-3.5 h-3.5" />
                View Knowledge Base
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
