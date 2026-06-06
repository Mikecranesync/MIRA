"use client";

/**
 * Proposals queue — read-only view (Phase 2 slice 1).
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Proposal queue"
 * API : GET /api/proposals
 * ADR : docs/adr/0013-uns-namespace-builder-schema-canonicalization.md
 *
 * Source: relationship_proposals (mira-hub mig 018). Confirm / edit / reject
 * buttons land in slice 2 once the engine-side kg_approval_state migration
 * ships.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, FileText, Loader2, Shield, X } from "lucide-react";
import { API_BASE } from "@/lib/config";

interface ProposalEndpoint {
  entityId: string;
  entityType: string;
  name: string | null;
  unsPath: string | null;
}

interface Proposal {
  id: string;
  source: ProposalEndpoint;
  target: ProposalEndpoint;
  relationshipType: string;
  confidence: number;
  status: string;
  createdBy: string;
  riskLevel: string;
  requiresHumanReview: boolean;
  reasoning: string | null;
  evidenceCount: number;
  createdAt: string;
}

interface ProposalsResponse {
  proposals: Proposal[];
  total: number;
}

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: "proposed", label: "Pending" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("proposed");
  const [deciding, setDeciding] = useState<Record<string, "verify" | "reject" | undefined>>({});
  const [toast, setToast] = useState<string | null>(null);

  async function decide(proposalId: string, decision: "verify" | "reject") {
    setDeciding((s) => ({ ...s, [proposalId]: decision }));
    const previous = proposals;
    if (statusFilter === "proposed") {
      setProposals((cur) => cur.filter((p) => p.id !== proposalId));
    }
    try {
      const res = await fetch(`${API_BASE}/api/proposals/${proposalId}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setToast(decision === "verify" ? "Proposal verified" : "Proposal rejected");
    } catch (e) {
      setProposals(previous);
      setToast(`Decide failed: ${(e as Error).message}`);
    } finally {
      setDeciding((s) => {
        const next = { ...s };
        delete next[proposalId];
        return next;
      });
      setTimeout(() => setToast(null), 4000);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const fetchProposals = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/proposals?status=${statusFilter}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ProposalsResponse;
        if (cancelled) return;
        setProposals(data.proposals);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchProposals();
    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  const grouped = useMemo(() => groupByRiskLevel(proposals), [proposals]);

  return (
    <div className="mx-auto max-w-6xl p-6" data-testid="proposals-page">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Proposals</h1>
          <p className="mt-1 text-sm text-slate-500">
            Relationship edges MIRA proposes from manuals, PLC tags, photos, and chat sessions.
            Confirm to promote into the verified knowledge graph.
          </p>
        </div>
      </header>

      <div className="mb-6 flex gap-1 border-b border-slate-200" data-testid="proposals-tabs">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusFilter(tab.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              statusFilter === tab.key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
            data-testid={`proposals-tab-${tab.key}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading proposals…
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load: {error}
        </div>
      ) : proposals.length === 0 ? (
        <EmptyState statusFilter={statusFilter} />
      ) : (
        <div className="space-y-6" data-testid="proposals-list">
          {grouped.safetyCritical.length > 0 && (
            <RiskSection
              title="Safety-critical"
              tone="critical"
              proposals={grouped.safetyCritical}
              canDecide={statusFilter === "proposed"}
              deciding={deciding}
              onDecide={decide}
            />
          )}
          {grouped.high.length > 0 && (
            <RiskSection
              title="High risk"
              tone="warning"
              proposals={grouped.high}
              canDecide={statusFilter === "proposed"}
              deciding={deciding}
              onDecide={decide}
            />
          )}
          {grouped.medium.length > 0 && (
            <RiskSection
              title="Medium risk"
              tone="info"
              proposals={grouped.medium}
              canDecide={statusFilter === "proposed"}
              deciding={deciding}
              onDecide={decide}
            />
          )}
          {grouped.low.length > 0 && (
            <RiskSection
              title="Low risk"
              tone="neutral"
              proposals={grouped.low}
              canDecide={statusFilter === "proposed"}
              deciding={deciding}
              onDecide={decide}
            />
          )}
        </div>
      )}

      {toast && (
        <div
          className="fixed bottom-4 right-4 z-50 rounded-md bg-slate-900 px-4 py-2 text-sm text-white shadow-lg"
          data-testid="proposals-toast"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function RiskSection({
  title,
  tone,
  proposals,
  canDecide,
  deciding,
  onDecide,
}: {
  title: string;
  tone: "critical" | "warning" | "info" | "neutral";
  proposals: Proposal[];
  canDecide: boolean;
  deciding: Record<string, "verify" | "reject" | undefined>;
  onDecide: (id: string, decision: "verify" | "reject") => void;
}) {
  const accent =
    tone === "critical"
      ? "border-l-red-500"
      : tone === "warning"
        ? "border-l-amber-500"
        : tone === "info"
          ? "border-l-blue-500"
          : "border-l-slate-300";
  return (
    <section data-testid={`proposals-section-${tone}`}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} ({proposals.length})
      </h2>
      <div className="space-y-2">
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            accent={accent}
            canDecide={canDecide}
            decidingState={deciding[p.id]}
            onDecide={onDecide}
          />
        ))}
      </div>
    </section>
  );
}

function ProposalCard({
  proposal,
  accent,
  canDecide,
  decidingState,
  onDecide,
}: {
  proposal: Proposal;
  accent: string;
  canDecide: boolean;
  decidingState: "verify" | "reject" | undefined;
  onDecide: (id: string, decision: "verify" | "reject") => void;
}) {
  const confidencePct = Math.round(proposal.confidence * 100);
  const busy = decidingState !== undefined;
  return (
    <article
      className={`rounded-lg border border-slate-200 ${accent} border-l-4 bg-white p-4 shadow-sm`}
      data-testid="proposal-card"
      data-proposal-id={proposal.id}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {proposal.riskLevel === "safety_critical" && (
          <Shield className="h-4 w-4 shrink-0 text-red-500" aria-label="safety-critical" />
        )}
        {proposal.requiresHumanReview && proposal.riskLevel !== "safety_critical" && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-label="needs review" />
        )}
        <span className="min-w-0 break-words font-semibold text-slate-900">
          {proposal.source.name ?? proposal.source.entityType}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="font-mono text-xs text-slate-500">{proposal.relationshipType}</span>
        <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="min-w-0 break-words font-semibold text-slate-900">
          {proposal.target.name ?? proposal.target.entityType}
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {confidencePct}% confidence
        </span>
      </div>

      {proposal.reasoning && (
        <p className="mt-3 text-sm text-slate-600">{proposal.reasoning}</p>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-400">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
          {proposal.status}
        </span>
        <span>by {proposal.createdBy}</span>
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" /> {proposal.evidenceCount} evidence
        </span>
        <time className="ml-2" dateTime={proposal.createdAt}>
          {new Date(proposal.createdAt).toLocaleDateString()}
        </time>
        {canDecide && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide(proposal.id, "reject")}
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              data-testid="proposal-reject"
            >
              {decidingState === "reject" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Reject
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide(proposal.id, "verify")}
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              data-testid="proposal-verify"
            >
              {decidingState === "verify" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Verify
            </button>
          </div>
        )}
      </footer>
    </article>
  );
}

function EmptyState({ statusFilter }: { statusFilter: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center" data-testid="proposals-empty">
      <FileText className="mx-auto h-10 w-10 text-slate-300" />
      <h2 className="mt-4 text-lg font-semibold text-slate-900">
        No {statusFilter === "all" ? "" : statusFilter} proposals yet
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        {statusFilter === "proposed"
          ? "Upload a manual or run a photo walk — MIRA will propose relationship edges here for you to confirm."
          : "Switch tabs to see proposals in other states."}
      </p>
    </div>
  );
}

function groupByRiskLevel(proposals: Proposal[]): {
  safetyCritical: Proposal[];
  high: Proposal[];
  medium: Proposal[];
  low: Proposal[];
} {
  return {
    safetyCritical: proposals.filter((p) => p.riskLevel === "safety_critical"),
    high: proposals.filter((p) => p.riskLevel === "high"),
    medium: proposals.filter((p) => p.riskLevel === "medium"),
    low: proposals.filter((p) => p.riskLevel === "low" || !p.riskLevel),
  };
}
