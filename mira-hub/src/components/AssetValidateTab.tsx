"use client";

// Validate tab on the asset detail page. Drives the asset-agent lifecycle:
// record validation Q&A, mark each answer good/bad, advance the state, and —
// once the §5 gate passes — approve the agent for the HMI.
//
// Spec: docs/specs/asset-agent-validation-spec.md §8

import { useCallback, useEffect, useState } from "react";

type State =
  | "draft"
  | "training"
  | "validating"
  | "approved"
  | "deployed"
  | "rejected"
  | "deprecated";

interface AgentStatus {
  state: State;
  docCount: number;
  validationQuestionCount: number;
  approvedAnswerCount: number;
  citationCoverage: number;
  minGroundedness: number | null;
  readyToApprove: boolean;
  approvalReasons: string[];
}

interface QaRow {
  id: string;
  question: string;
  miraAnswer: string | null;
  citations: unknown[];
  reviewerVerdict: "good" | "bad" | "needs_review" | null;
}

const STATE_COLOR: Record<State, string> = {
  draft: "#6b7280",
  training: "#d97706",
  validating: "#2563eb",
  approved: "#16a34a",
  deployed: "#7c3aed",
  rejected: "#dc2626",
  deprecated: "#6b7280",
};

// The next forward lifecycle state, if any (mirrors the server-side graph).
const NEXT: Partial<Record<State, State>> = {
  draft: "training",
  training: "validating",
  validating: "approved",
  approved: "deployed",
};

export function AssetValidateTab({ assetId }: { assetId: string }) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [qa, setQa] = useState<QaRow[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const sRes = await fetch(`/api/assets/${assetId}/agent-status`);
      if (sRes.ok) {
        const s = (await sRes.json()) as AgentStatus;
        setStatus(s);
      }
      const qRes = await fetch(`/api/assets/${assetId}/validation-qa`);
      if (qRes.ok) {
        const q = await qRes.json();
        if (Array.isArray(q)) setQa(q);
      }
    } catch {
      /* silent — keep the last good view */
    }
  }, [assetId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const askQuestion = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/validation-qa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to record question");
      setQuestion("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setVerdict = async (qaId: string, verdict: "good" | "bad") => {
    await fetch(`/api/assets/${assetId}/validation-qa/${qaId}/verdict`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict }),
    });
    await refresh();
  };

  const transition = async (to: State) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/agent-status/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      });
      if (!res.ok) {
        const b = await res.json();
        throw new Error(
          b.reasons?.length ? `${b.error}: ${b.reasons.join("; ")}` : b.error ?? "Transition failed",
        );
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return <div style={{ padding: 24, color: "var(--foreground-muted)" }}>Loading…</div>;
  }

  const next = NEXT[status.state];
  const approveBlocked = status.state === "validating" && !status.readyToApprove;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "4px 0" }}>
      {/* Lifecycle header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span
          style={{
            padding: "4px 12px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: STATE_COLOR[status.state],
            textTransform: "capitalize",
          }}
        >
          {status.state}
        </span>
        <span style={{ color: "var(--foreground-muted)", fontSize: 13 }}>
          {status.docCount} docs · {status.approvedAnswerCount}/{status.validationQuestionCount} answers
          approved · citation coverage {status.citationCoverage}
        </span>
        <div style={{ flex: 1 }} />
        {next && next !== "approved" && (
          <button
            onClick={() => transition(next)}
            disabled={busy}
            style={primaryBtn}
          >
            Advance to {next}
          </button>
        )}
        {status.state === "validating" && (
          <button
            onClick={() => transition("approved")}
            disabled={busy || approveBlocked}
            title={approveBlocked ? status.approvalReasons.join("; ") : "Approve this agent for the HMI"}
            style={{ ...primaryBtn, opacity: approveBlocked ? 0.5 : 1, background: "#16a34a" }}
          >
            Mark as Ready
          </button>
        )}
        {status.state === "approved" && (
          <button onClick={() => transition("deployed")} disabled={busy} style={{ ...primaryBtn, background: "#7c3aed" }}>
            Deploy to HMI
          </button>
        )}
      </div>

      {approveBlocked && (
        <div style={{ fontSize: 13, color: "#b45309" }}>
          Not ready to approve: {status.approvalReasons.join("; ")}.
        </div>
      )}
      {error && <div style={{ fontSize: 13, color: "#dc2626" }}>{error}</div>}

      {/* Ask a validation question */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && askQuestion()}
          placeholder="Ask a validation question for this asset…"
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--background)",
            color: "var(--foreground)",
          }}
        />
        <button onClick={askQuestion} disabled={busy || !question.trim()} style={primaryBtn}>
          Record
        </button>
      </div>

      {/* Validation transcript */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {qa.length === 0 && (
          <div style={{ color: "var(--foreground-muted)", fontSize: 13 }}>
            No validation questions yet. Ask one above to start validating this asset&apos;s agent.
          </div>
        )}
        {qa.map((row) => (
          <div
            key={row.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>{row.question}</div>
            {row.miraAnswer && (
              <div style={{ fontSize: 13, color: "var(--foreground-muted)" }}>{row.miraAnswer}</div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--foreground-muted)" }}>
                {Array.isArray(row.citations) ? row.citations.length : 0} citations
              </span>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setVerdict(row.id, "good")}
                style={{ ...verdictBtn, ...(row.reviewerVerdict === "good" ? goodActive : {}) }}
              >
                Good
              </button>
              <button
                onClick={() => setVerdict(row.id, "bad")}
                style={{ ...verdictBtn, ...(row.reviewerVerdict === "bad" ? badActive : {}) }}
              >
                Bad
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: "var(--brand-blue)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const verdictBtn: React.CSSProperties = {
  padding: "4px 12px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--background)",
  color: "var(--foreground)",
  fontSize: 12,
  cursor: "pointer",
};

const goodActive: React.CSSProperties = { background: "#16a34a", color: "#fff", borderColor: "#16a34a" };
const badActive: React.CSSProperties = { background: "#dc2626", color: "#fff", borderColor: "#dc2626" };
