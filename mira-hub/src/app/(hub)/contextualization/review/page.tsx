"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/config";

type ReviewStatus = "proposed" | "approved" | "rejected" | "needs_review";

interface Batch {
  id: string;
  projectName: string;
  ingestRoute: string;
  reviewStatus: ReviewStatus;
  sourceCount: number;
  extractionCount: number;
  acceptedCount: number;
  createdAt: string;
}

const STATUS_STYLE: Record<ReviewStatus, string> = {
  proposed: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  approved: "bg-green-500/15 text-green-300 border-green-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  needs_review: "bg-blue-500/15 text-blue-300 border-blue-500/30",
};
const STATUS_LABEL: Record<ReviewStatus, string> = {
  proposed: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  needs_review: "Needs review",
};

export default function ReviewQueuePage() {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/contextualization/batches`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBatches(data.batches ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const pending = batches.filter((b) => b.reviewStatus === "proposed" || b.reviewStatus === "needs_review").length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Review Queue</h1>
          <p className="text-sm text-gray-400 mt-1">
            Imported context lands here as proposed. Approve a batch to publish its signals, UNS map, and
            i3X objects into the project model — nothing goes live until you approve it.
          </p>
        </div>
        {pending > 0 && (
          <span className="text-xs text-amber-300 bg-amber-500/15 border border-amber-500/30 px-3 py-1.5 rounded-lg">
            {pending} awaiting review
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-12 justify-center">
          <Loader2 size={20} className="animate-spin" />
          Loading review queue…
        </div>
      ) : error ? (
        <div className="text-red-400 py-12 text-center">{error}</div>
      ) : batches.length === 0 ? (
        <div className="border border-dashed border-gray-700 rounded-xl py-20 flex flex-col items-center gap-4 text-gray-500">
          <ClipboardList size={40} className="text-gray-600" />
          <p className="text-sm">No import batches yet. Import an offline bundle or Telegram capture to populate the queue.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {batches.map((b) => (
            <button
              key={b.id}
              onClick={() => router.push(`/contextualization/review/${b.id}`)}
              className="w-full text-left bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 transition-colors group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h2 className="text-white font-medium group-hover:text-blue-300 transition-colors truncate">
                      {b.projectName}
                    </h2>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_STYLE[b.reviewStatus]}`}>
                      {STATUS_LABEL[b.reviewStatus]}
                    </span>
                  </div>
                  <p className="text-gray-500 text-xs mt-1">via {b.ingestRoute}</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0 mt-0.5">
                  <span>
                    <span className="text-gray-300 font-medium">{b.sourceCount}</span> source{b.sourceCount !== 1 ? "s" : ""}
                  </span>
                  <span>
                    <span className="text-gray-300 font-medium">{b.extractionCount}</span> signals
                  </span>
                  <span>
                    <span className="text-green-400 font-medium">{b.acceptedCount}</span> accepted
                  </span>
                  <span>{new Date(b.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
