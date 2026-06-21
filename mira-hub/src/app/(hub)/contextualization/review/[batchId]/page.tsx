"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, X, AlertTriangle } from "lucide-react";
import { API_BASE } from "@/lib/config";

type ReviewStatus = "proposed" | "approved" | "rejected" | "needs_review";
type Decision = "approve" | "reject" | "needs_review";

interface Signal {
  id: string;
  tagName: string;
  roles: string[];
  unsPath: string | null;
  i3xElementId: string | null;
  confidence: number | null;
  status: string;
  sourceFile: string | null;
  evidenceCount: number;
}
interface Source {
  id: string;
  sourceType: string;
  fileName: string;
  status: string;
  sha256: string | null;
}
interface BatchDetail {
  batch: {
    id: string;
    projectName: string;
    ingestRoute: string;
    bundleSha256: string | null;
    reviewStatus: ReviewStatus;
    createdAt: string;
  };
  sources: Source[];
  evidence: { tagName: string; evidenceCount: number }[];
  extractedSignals: Signal[];
  faultCatalog: Signal[];
  parameters: Signal[];
  unsMap: { tagName: string; unsPath: string | null; i3xElementId: string | null }[];
  scorecard: {
    sources: number;
    signals: number;
    mappedUns: number;
    accepted: number;
    avgConfidence: number | null;
  };
}

const STATUS_STYLE: Record<ReviewStatus, string> = {
  proposed: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  approved: "bg-green-500/15 text-green-300 border-green-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  needs_review: "bg-blue-500/15 text-blue-300 border-blue-500/30",
};

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-medium">{title}</h2>
        <span className="text-xs text-gray-500">{count}</span>
      </div>
      {count === 0 ? (
        <p className="text-sm text-gray-600 italic">None in this batch.</p>
      ) : (
        children
      )}
    </div>
  );
}

function confColor(c: number | null): string {
  if (c == null) return "text-gray-500";
  if (c >= 0.85) return "text-green-400";
  if (c >= 0.5) return "text-amber-400";
  return "text-gray-400";
}

export default function BatchReviewPage() {
  const router = useRouter();
  const params = useParams();
  const batchId = String(params.batchId);

  const [data, setData] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<Decision | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/contextualization/batches/${batchId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load batch");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  async function decide(decision: Decision) {
    setActing(decision);
    setToast(null);
    try {
      const res = await fetch(`${API_BASE}/api/contextualization/batches/${batchId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (decision === "approve") {
        setToast(`Approved — published ${body.published} signal(s)${body.skipped ? `, ${body.skipped} kept (already approved)` : ""}.`);
      } else {
        setToast(decision === "reject" ? "Batch rejected." : "Marked needs-review.");
      }
      await fetchDetail();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActing(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-20 justify-center">
        <Loader2 size={20} className="animate-spin" /> Loading batch…
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-red-400 py-20 text-center">{error ?? "Not found"}</div>;
  }

  const { batch, sources, evidence, extractedSignals, faultCatalog, parameters, unsMap, scorecard } = data;
  const isOpen = batch.reviewStatus === "proposed" || batch.reviewStatus === "needs_review";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button
        onClick={() => router.push("/contextualization/review")}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 mb-4"
      >
        <ArrowLeft size={15} /> Review Queue
      </button>

      {/* Header + actions */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-white">{batch.projectName}</h1>
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_STYLE[batch.reviewStatus]}`}>
              {batch.reviewStatus.replace("_", " ")}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            via {batch.ingestRoute}
            {batch.bundleSha256 ? ` · ${batch.bundleSha256.slice(0, 12)}…` : ""} · {new Date(batch.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => decide("approve")}
            disabled={!isOpen || acting !== null}
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {acting === "approve" ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}
            Approve &amp; Publish
          </button>
          <button
            onClick={() => decide("needs_review")}
            disabled={!isOpen || acting !== null}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 text-sm px-3 py-2 rounded-lg transition-colors"
          >
            {acting === "needs_review" ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={15} />}
            Needs review
          </button>
          <button
            onClick={() => decide("reject")}
            disabled={!isOpen || acting !== null}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-red-900/60 disabled:opacity-40 text-red-300 text-sm px-3 py-2 rounded-lg transition-colors"
          >
            {acting === "reject" ? <Loader2 size={14} className="animate-spin" /> : <X size={15} />}
            Reject
          </button>
        </div>
      </div>

      {toast && (
        <div className="mb-5 text-sm text-gray-200 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5">
          {toast}
        </div>
      )}

      {/* Scorecard */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {[
          { label: "Sources", value: scorecard.sources },
          { label: "Extracted Signals", value: scorecard.signals },
          { label: "UNS Map", value: scorecard.mappedUns },
          { label: "Accepted", value: scorecard.accepted },
          { label: "Avg confidence", value: scorecard.avgConfidence ?? "—" },
        ].map((m) => (
          <div key={m.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xl font-semibold text-white">{m.value}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4">
        {/* Sources */}
        <Section title="Sources" count={sources.length}>
          <ul className="divide-y divide-gray-800">
            {sources.map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between text-sm">
                <span className="text-gray-200 truncate">{s.fileName}</span>
                <span className="text-xs text-gray-500 shrink-0 ml-3">
                  {s.sourceType} · {s.sha256 ? `${s.sha256.slice(0, 10)}…` : "no hash"} · {s.status}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {/* Extracted Signals */}
        <Section title="Extracted Signals" count={extractedSignals.length}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                  <th className="py-2 pr-3 font-medium">Tag</th>
                  <th className="py-2 pr-3 font-medium">Roles</th>
                  <th className="py-2 pr-3 font-medium">Proposed UNS path</th>
                  <th className="py-2 pr-3 font-medium">Conf.</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {extractedSignals.map((s) => (
                  <tr key={s.id} className="border-b border-gray-800/60">
                    <td className="py-2 pr-3 text-gray-200 font-mono text-xs">{s.tagName}</td>
                    <td className="py-2 pr-3 text-gray-400 text-xs">{s.roles.join(", ") || "—"}</td>
                    <td className="py-2 pr-3 text-gray-400 font-mono text-xs">{s.unsPath ?? "—"}</td>
                    <td className={`py-2 pr-3 text-xs ${confColor(s.confidence)}`}>
                      {s.confidence != null ? s.confidence.toFixed(2) : "—"}
                    </td>
                    <td className="py-2 text-xs text-gray-400">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* Fault Catalog */}
          <Section title="Fault Catalog" count={faultCatalog.length}>
            <ul className="space-y-1.5 text-sm">
              {faultCatalog.map((f) => (
                <li key={f.id} className="text-gray-300 font-mono text-xs">{f.tagName}</li>
              ))}
            </ul>
          </Section>

          {/* Parameters */}
          <Section title="Parameters" count={parameters.length}>
            <ul className="space-y-1.5 text-sm">
              {parameters.map((p) => (
                <li key={p.id} className="text-gray-300 font-mono text-xs">{p.tagName}</li>
              ))}
            </ul>
          </Section>
        </div>

        {/* UNS Map */}
        <Section title="UNS Map" count={unsMap.length}>
          <ul className="divide-y divide-gray-800">
            {unsMap.map((u) => (
              <li key={u.tagName} className="py-2 flex items-center justify-between text-xs font-mono">
                <span className="text-gray-300">{u.tagName}</span>
                <span className="text-gray-500 truncate ml-3">{u.unsPath}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* Evidence */}
        <Section title="Evidence" count={evidence.length}>
          <ul className="divide-y divide-gray-800">
            {evidence.map((e) => (
              <li key={e.tagName} className="py-2 flex items-center justify-between text-xs">
                <span className="text-gray-300 font-mono">{e.tagName}</span>
                <span className="text-gray-500">{e.evidenceCount} block{e.evidenceCount !== 1 ? "s" : ""}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
