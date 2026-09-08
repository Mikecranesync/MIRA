"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/config";

/**
 * The composer, on the home screen.
 *
 * Every mature AI product opens on a greeting and a focused text box; the
 * Command Board opened on KPI tiles, a readiness bar and a work-order feed,
 * and its "Ask MIRA" was a link to a Telegram bot. A technician could not ask
 * anything from the landing screen — which is step one of the beta gate
 * (a stranger reaches a cited answer unaided) and the first thing the
 * 2026-09-07 UX recon failed on.
 *
 * Scope: GENERAL questions only. This deliberately does not bind an asset, so
 * it does not touch the UNS confirmation gate — that gate governs
 * asset-specific troubleshooting, and `.claude/rules/uns-confirmation-gate.md`
 * exempts general and educational questions, which is what `/quickstart` has
 * answered in public all along. The difference is that a signed-in caller
 * searches their own uploaded manuals too.
 */
type Citation = {
  index: number;
  title: string;
  url: string | null;
  page: number | null;
  verified: boolean;
};

type AskResponse = { answer: string; citations: Citation[]; provider: string | null };

export default function HomeComposer() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focused on load: "type, press Enter, answer begins — no navigation, no
  // mode selection first" is the acceptance criterion, and a composer you must
  // click first does not meet it.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/hub/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json()) as AskResponse & { error?: string };
      if (!res.ok) {
        // Plain language and a state the user can act from — never a status
        // code. The old asset chat rendered "Chat unavailable (412)", which
        // read as an outage and told the user to refresh, advice that could
        // not work.
        setError(data.error ?? "MIRA could not answer that just now. Your question is still here.");
        return;
      }
      setResult(data);
    } catch {
      setError("Couldn't reach MIRA. Your question is still here — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="home-composer-heading" className="space-y-3">
      <h2
        id="home-composer-heading"
        className="text-lg font-semibold"
        style={{ color: "var(--foreground)" }}
      >
        What are you working on?
      </h2>

      <form onSubmit={ask} className="space-y-2" data-testid="home-composer">
        <textarea
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter newlines. `isComposing` guards IME
            // input, where Enter commits a candidate rather than submitting.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void ask(e as unknown as React.FormEvent);
            }
          }}
          rows={2}
          maxLength={1000}
          aria-label="Ask MIRA a maintenance question"
          placeholder="e.g. PowerFlex 525 showing F0004 on power-up — won't reset"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{
            background: "var(--surface-0)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
            minHeight: 44,
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
            General questions. Open a machine to ask about it specifically.
          </p>
          <button
            type="submit"
            disabled={!question.trim() || busy}
            className="rounded-lg px-4 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--brand-blue)", color: "#fff", minHeight: 44, minWidth: 88 }}
          >
            {busy ? "Asking…" : "Ask MIRA"}
          </button>
        </div>
      </form>

      {error && (
        <div
          role="status"
          className="rounded-lg px-3 py-2 text-xs"
          style={{ background: "#FFFBEB", color: "#92400E", border: "1px solid #FDE68A" }}
        >
          {error}
        </div>
      )}

      {result && (
        <div className="card p-3 space-y-2" data-testid="home-composer-answer">
          <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--foreground)" }}>
            {result.answer}
          </p>
          {result.citations.length > 0 && (
            <ul className="space-y-1">
              {result.citations.map((c) => (
                <li key={c.index} className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                  [{c.index}] {c.title}
                  {c.page !== null && ` · p.${c.page}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
