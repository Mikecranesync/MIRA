"use client";

import { useState, useCallback } from "react";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  FileText,
  Activity,
  Network,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  HelpCircle,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/config";

// Shape returned by GET /api/decision-trace/[id]. All evidence is the JSONB
// stored at answer time; deferred PRD §11 fields (decision_path, context_ignored,
// next_check) are intentionally NOT part of the MVP and are not rendered.
interface ManualEvidence {
  doc?: string;
  page?: number | null;
  url?: string | null;
  rank?: number;
}
interface TagEvidence {
  tag_path?: string;
  value?: unknown;
  quality?: string | null;
  uns_path?: string | null;
}
interface KgEvidence {
  entity_id?: string;
  rel?: string;
  target?: unknown;
}
interface Trace {
  trace_id: string;
  platform?: string;
  user_question?: string;
  tag_evidence?: TagEvidence[];
  manual_evidence?: ManualEvidence[];
  kg_evidence?: KgEvidence[];
  recommendation?: string;
  citations_present?: boolean;
  confidence?: string | null;
  outcome?: string | null;
  model_used?: string | null;
  latency_ms?: number | null;
}

const VERDICTS: { key: string; label: string; icon: typeof ThumbsUp }[] = [
  { key: "good", label: "Correct", icon: ThumbsUp },
  { key: "bad", label: "Wrong", icon: ThumbsDown },
  { key: "missing_context", label: "Missing context", icon: HelpCircle },
  { key: "needs_review", label: "Needs review", icon: Eye },
];

function ConfidencePill({ confidence }: { confidence?: string | null }) {
  const c = (confidence ?? "none").toLowerCase();
  const color =
    c === "high" ? "#16A34A" : c === "medium" ? "#D97706" : c === "low" ? "#DC2626" : "#6B7280";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: `${color}1A`, color, border: `1px solid ${color}55` }}
      title="Heuristic confidence based on whether grounding was found"
    >
      Confidence: {c}
    </span>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--foreground-subtle)" }}
      >
        <Icon className="w-3.5 h-3.5" /> {title}
      </div>
      <div className="mt-1.5 text-sm" style={{ color: "var(--foreground)" }}>
        {children}
      </div>
    </div>
  );
}

export default function WhyMiraThinksThis({ traceId }: { traceId: string }) {
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/decision-trace/${traceId}`);
      if (res.status === 404) {
        setError("Explanation isn't available for this answer.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTrace((await res.json()) as Trace);
    } catch {
      setError("Couldn't load the explanation. Try again.");
    } finally {
      setLoading(false);
    }
  }, [traceId]);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next && !trace && !loading) void load();
  }, [open, trace, loading, load]);

  const sendFeedback = useCallback(
    async (verdict: string) => {
      setFeedbackSent(verdict); // optimistic
      try {
        await fetch(`${API_BASE}/api/decision-trace/${traceId}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verdict }),
        });
      } catch {
        // non-fatal; leave the optimistic state
      }
    },
    [traceId],
  );

  const manual = trace?.manual_evidence ?? [];
  const tags = trace?.tag_evidence ?? [];
  const kg = trace?.kg_evidence ?? [];
  const noEvidence = manual.length === 0 && tags.length === 0 && kg.length === 0;

  return (
    <div className="mt-2">
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-2 py-1 transition-colors"
        style={{ color: "var(--brand-blue)", background: "var(--surface-1)", border: "1px solid var(--border)" }}
        aria-expanded={open}
      >
        <Brain className="w-3.5 h-3.5" />
        Why MIRA thinks this
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div
          className="mt-2 rounded-lg p-3"
          style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
        >
          {loading && (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--foreground-subtle)" }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading explanation…
            </div>
          )}

          {error && !loading && (
            <div className="text-sm" style={{ color: "var(--foreground-subtle)" }}>{error}</div>
          )}

          {trace && !loading && !error && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <ConfidencePill confidence={trace.confidence} />
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                  style={{ background: "var(--surface-0)", border: "1px solid var(--border)", color: "var(--foreground-subtle)" }}
                >
                  {trace.citations_present ? "Citations present" : "No citations"}
                </span>
                {trace.model_used && (
                  <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
                    {trace.model_used}
                    {typeof trace.latency_ms === "number" ? ` · ${trace.latency_ms} ms` : ""}
                  </span>
                )}
              </div>

              {manual.length > 0 && (
                <Section icon={FileText} title="Manual evidence">
                  <ul className="space-y-1">
                    {manual.map((m, i) => (
                      <li key={i}>
                        {m.url ? (
                          <a href={m.url} target="_blank" rel="noreferrer" style={{ color: "var(--brand-blue)" }}>
                            {m.doc ?? "OEM document"}
                          </a>
                        ) : (
                          <span>{m.doc ?? "OEM document"}</span>
                        )}
                        {m.page != null ? ` · p.${m.page}` : ""}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {tags.length > 0 && (
                <Section icon={Activity} title="Live tags">
                  <ul className="space-y-1">
                    {tags.map((t, i) => (
                      <li key={i}>
                        {t.tag_path}: {String(t.value)}
                        {t.quality ? ` [${t.quality}]` : ""}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {kg.length > 0 && (
                <Section icon={Network} title="Knowledge graph">
                  <ul className="space-y-1">
                    {kg.map((k, i) => (
                      <li key={i}>
                        {k.entity_id} {k.rel} {String(k.target)}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {noEvidence && (
                <Section icon={FileText} title="Evidence">
                  <span style={{ color: "var(--foreground-subtle)" }}>
                    No structured evidence was captured for this answer.
                  </span>
                </Section>
              )}

              {trace.outcome === "kb_gap" && (
                <Section icon={HelpCircle} title="Missing context">
                  <span style={{ color: "var(--foreground-subtle)" }}>
                    No manual grounding was found for this question — MIRA answered from general
                    knowledge. Upload the relevant manual to ground future answers.
                  </span>
                </Section>
              )}

              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--foreground-subtle)" }}>
                  Was this right?
                </div>
                {feedbackSent ? (
                  <div className="text-sm" style={{ color: "var(--foreground-subtle)" }}>
                    Thanks — recorded as <strong>{VERDICTS.find((v) => v.key === feedbackSent)?.label}</strong>.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {VERDICTS.map((v) => (
                      <Button key={v.key} variant="outline" size="sm" onClick={() => void sendFeedback(v.key)}>
                        <v.icon className="w-3.5 h-3.5 mr-1" />
                        {v.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
