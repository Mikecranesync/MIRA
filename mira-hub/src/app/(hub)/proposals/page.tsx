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
import { AlertTriangle, ArrowRight, FileText, Loader2, Shield } from "lucide-react";
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
            <RiskSection title="Safety-critical" tone="critical" proposals={grouped.safetyCritical} />
          )}
          {grouped.high.length > 0 && (
            <RiskSection title="High risk" tone="warning" proposals={grouped.high} />
          )}
          {grouped.medium.length > 0 && (
            <RiskSection title="Medium risk" tone="info" proposals={grouped.medium} />
          )}
          {grouped.low.length > 0 && (
            <RiskSection title="Low risk" tone="neutral" proposals={grouped.low} />
          )}
        </div>
      )}
    </div>
  );
}

function RiskSection({
  title,
  tone,
  proposals,
}: {
  title: string;
  tone: "critical" | "warning" | "info" | "neutral";
  proposals: Proposal[];
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
          <ProposalCard key={p.id} proposal={p} accent={accent} />
        ))}
      </div>
    </section>
  );
}

function ProposalCard({ proposal, accent }: { proposal: Proposal; accent: string }) {
  const confidencePct = Math.round(proposal.confidence * 100);
  return (
    <article
      className={`rounded-lg border border-slate-200 ${accent} border-l-4 bg-white p-4 shadow-sm`}
      data-testid="proposal-card"
    >
      <div className="flex items-center gap-2 text-sm">
        {proposal.riskLevel === "safety_critical" && (
          <Shield className="h-4 w-4 text-red-500" aria-label="safety-critical" />
        )}
        {proposal.requiresHumanReview && proposal.riskLevel !== "safety_critical" && (
          <AlertTriangle className="h-4 w-4 text-amber-500" aria-label="needs review" />
        )}
        <span className="font-semibold text-slate-900">
          {proposal.source.name ?? proposal.source.entityType}
        </span>
        <ArrowRight className="h-4 w-4 text-slate-400" />
        <span className="font-mono text-xs text-slate-500">{proposal.relationshipType}</span>
        <ArrowRight className="h-4 w-4 text-slate-400" />
        <span className="font-semibold text-slate-900">
          {proposal.target.name ?? proposal.target.entityType}
        </span>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {confidencePct}% confidence
        </span>
      </div>

      {proposal.reasoning && (
        <p className="mt-3 text-sm text-slate-600">{proposal.reasoning}</p>
      )}

      <footer className="mt-3 flex items-center gap-3 text-xs text-slate-400">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
          {proposal.status}
        </span>
        <span>by {proposal.createdBy}</span>
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" /> {proposal.evidenceCount} evidence
        </span>
        <time className="ml-auto" dateTime={proposal.createdAt}>
          {new Date(proposal.createdAt).toLocaleDateString()}
        </time>
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
