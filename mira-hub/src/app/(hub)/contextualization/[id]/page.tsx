"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowUpCircle, Check, ChevronDown, ChevronUp, FileUp, Loader2, X } from "lucide-react";
import { API_BASE } from "@/lib/config";

interface Extraction {
  id: string;
  sourceId: string;
  fileName: string | null;
  tagName: string;
  roles: string[];
  unsPathProposed: string | null;
  i3xElementId: string | null;
  confidence: string | null;
  status: "pending" | "accepted" | "rejected";
  evidenceJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ExtractionRaw {
  id: string;
  source_id: string;
  file_name: string | null;
  tag_name: string;
  roles: string[];
  uns_path_proposed: string | null;
  i3x_element_id: string | null;
  confidence: string | null;
  status: string;
  evidence_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function rowToExtraction(r: ExtractionRaw): Extraction {
  return {
    id: r.id,
    sourceId: r.source_id,
    fileName: r.file_name,
    tagName: r.tag_name,
    roles: r.roles ?? [],
    unsPathProposed: r.uns_path_proposed,
    i3xElementId: r.i3x_element_id,
    confidence: r.confidence,
    status: r.status as Extraction["status"],
    evidenceJson: r.evidence_json ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const CONFIDENCE_COLOR: Record<string, string> = {
  "0.9": "text-green-600",
  "0.6": "text-amber-500",
  "0.3": "text-gray-400",
};

function confidenceLabel(val: string | null): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (n >= 0.85) return "high";
  if (n >= 0.5) return "med";
  return "low";
}

function confidenceClass(val: string | null): string {
  if (!val) return "text-gray-400";
  const n = parseFloat(val);
  if (n >= 0.85) return CONFIDENCE_COLOR["0.9"];
  if (n >= 0.5) return CONFIDENCE_COLOR["0.6"];
  return CONFIDENCE_COLOR["0.3"];
}

const STATUS_FILTER_TABS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
];

export default function ContextualizationProjectPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [extractions, setExtractions] = useState<Extraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<Record<string, "accepted" | "rejected" | undefined>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});
  const [promoting, setPromoting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchExtractions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/contextualization/${projectId}/extractions`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Load failed");
      }
      const data = (await res.json()) as { extractions: ExtractionRaw[] };
      setExtractions(data.extractions.map(rowToExtraction));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchExtractions();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchExtractions]);

  const decide = useCallback(
    async (id: string, status: "accepted" | "rejected") => {
      setDeciding((d) => ({ ...d, [id]: status }));
      try {
        const res = await fetch(
          `${API_BASE}/api/contextualization/${projectId}/extractions/${id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? "Update failed");
        }
        setExtractions((prev) =>
          prev.map((e) => (e.id === id ? { ...e, status } : e)),
        );
        showToast(status === "accepted" ? "Signal accepted" : "Signal rejected");
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Error updating signal");
      } finally {
        setDeciding((d) => ({ ...d, [id]: undefined }));
      }
    },
    [projectId],
  );

  const promote = useCallback(async () => {
    setPromoting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/contextualization/${projectId}/promote`,
        { method: "POST" },
      );
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        promoted?: number;
        skipped?: number;
        total?: number;
      };
      if (!res.ok) throw new Error(j.error ?? "Promotion failed");
      const promoted = j.promoted ?? 0;
      const skipped = j.skipped ?? 0;
      showToast(
        promoted + skipped === 0
          ? "No accepted signals to promote"
          : `Promoted ${promoted} signal${promoted === 1 ? "" : "s"} to the knowledge graph${skipped ? ` (${skipped} already present)` : ""}`,
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error promoting signals");
    } finally {
      setPromoting(false);
    }
  }, [projectId]);

  const onUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so selecting the same file again re-triggers onChange.
      e.target.value = "";
      if (!file) return;

      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(
          `${API_BASE}/api/contextualization/${projectId}/sources`,
          { method: "POST", body: fd },
        );
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          source?: { status?: string };
          extractionsCreated?: number;
        };
        if (!res.ok) throw new Error(j.error ?? "Upload failed");
        // Parsing is now inline: the response carries the terminal status.
        if (j.source?.status === "error") {
          showToast(`Couldn't parse ${file.name}: ${j.error ?? "see source status"}`);
        } else {
          const n = j.extractionsCreated ?? 0;
          showToast(`Uploaded ${file.name} — ${n} signal${n === 1 ? "" : "s"} extracted`);
        }
        // Extractions are already written; refresh now.
        fetchExtractions();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Error uploading file");
      } finally {
        setUploading(false);
      }
    },
    [projectId, fetchExtractions],
  );

  const filtered = extractions.filter(
    (e) => filter === "all" || e.status === filter,
  );

  const counts = {
    all: extractions.length,
    pending: extractions.filter((e) => e.status === "pending").length,
    accepted: extractions.filter((e) => e.status === "accepted").length,
    rejected: extractions.filter((e) => e.status === "rejected").length,
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Extracted Signals</h1>
          <p className="mt-1 text-sm text-gray-500">
            Accept or reject the proposed UNS path for each extracted signal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".l5x,.st,.xml,.csv,.pdf,.txt,.md,.aoi"
            onChange={onUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Upload a source (PLC export or manual) to extract signals"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4" />
            )}
            Upload source
          </button>
          <button
            onClick={fetchExtractions}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
          <button
            onClick={promote}
            disabled={promoting || counts.accepted === 0}
            title={
              counts.accepted === 0
                ? "Accept at least one signal before promoting"
                : "Promote accepted signals into the knowledge graph"
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {promoting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUpCircle className="h-4 w-4" />
            )}
            Promote {counts.accepted > 0 ? `(${counts.accepted})` : ""}
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {STATUS_FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              filter === tab.key
                ? "border-b-2 border-indigo-600 text-indigo-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
            <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {counts[tab.key as keyof typeof counts]}
            </span>
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading signals…
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="py-16 text-center text-sm text-gray-400">No signals in this view.</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-4 py-3">Tag</th>
                <th className="px-4 py-3">Roles</th>
                <th className="px-4 py-3">Proposed UNS Path</th>
                <th className="px-4 py-3">Conf.</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Evidence</th>
                <th className="px-4 py-3 text-right">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((e) => (
                <tr
                  key={e.id}
                  className={`transition-colors ${
                    e.status === "accepted"
                      ? "bg-green-50"
                      : e.status === "rejected"
                        ? "bg-red-50 opacity-60"
                        : "hover:bg-gray-50"
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-900">
                    {e.tagName}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {e.roles.length > 0
                        ? e.roles.map((r) => (
                            <span
                              key={r}
                              className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700"
                            >
                              {r}
                            </span>
                          ))
                        : <span className="text-gray-400">—</span>}
                    </div>
                  </td>
                  <td className="max-w-xs px-4 py-3 font-mono text-xs text-gray-700 break-all">
                    {e.unsPathProposed ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className={`px-4 py-3 text-xs font-semibold ${confidenceClass(e.confidence)}`}>
                    {confidenceLabel(e.confidence)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {e.fileName ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {Object.keys(e.evidenceJson).length > 0 ? (
                      <button
                        onClick={() =>
                          setExpandedEvidence((prev) => ({
                            ...prev,
                            [e.id]: !prev[e.id],
                          }))
                        }
                        className="flex items-center gap-0.5 text-xs text-indigo-500 hover:underline"
                      >
                        {expandedEvidence[e.id] ? (
                          <>hide <ChevronUp className="h-3 w-3" /></>
                        ) : (
                          <>show <ChevronDown className="h-3 w-3" /></>
                        )}
                      </button>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                    {expandedEvidence[e.id] && (
                      <pre className="mt-1 max-w-xs overflow-auto rounded bg-gray-100 p-2 text-xs text-gray-600">
                        {JSON.stringify(e.evidenceJson, null, 2)}
                      </pre>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {e.status === "pending" ? (
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => decide(e.id, "accepted")}
                          disabled={deciding[e.id] != null}
                          className="inline-flex items-center gap-1 rounded border border-green-300 bg-white px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                        >
                          {deciding[e.id] === "accepted" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Accept
                        </button>
                        <button
                          onClick={() => decide(e.id, "rejected")}
                          disabled={deciding[e.id] != null}
                          className="inline-flex items-center gap-1 rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deciding[e.id] === "rejected" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${
                          e.status === "accepted"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {e.status === "accepted" ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                        {e.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
