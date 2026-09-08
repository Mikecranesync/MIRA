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

/** The subset of `/api/assets` a suggestion is allowed to read. */
type SuggestionAsset = {
  manufacturer: string | null;
  model: string | null;
  lastFault: string | null;
};

/**
 * Starters for a tenant with no equipment yet — which is exactly the Z-1 case:
 * a stranger on a ten-minute-old account. General and educational, so they sit
 * inside the carve-out in `.claude/rules/uns-confirmation-gate.md`.
 *
 * Deliberately none of these trip a SAFETY_KEYWORDS phrase (LOTO, arc flash,
 * confined space). A suggestion chip that always returns a STOP escalation is a
 * poor first impression and reads as broken rather than as the guardrail
 * working.
 */
export const FALLBACK_SUGGESTIONS: readonly string[] = [
  "What does a VFD overcurrent fault usually mean?",
  "How do I test a proximity sensor?",
  "What's the difference between PNP and NPN sensors?",
];

/**
 * Three suggestions drawn from live equipment state (tracker unblocker 1).
 *
 * `/api/assets` returns rows ordered `last_work_order_at DESC`, so the front of
 * the list is the equipment that has actually moved recently — that ordering is
 * the "live" part, and it is why this takes the first matches rather than
 * sampling.
 *
 * Two rules that are not styling:
 *
 * 1. **A suggestion names a MODEL, never an asset instance.** The composer binds
 *    no asset, which is what keeps it inside the general/educational carve-out of
 *    the UNS confirmation gate. "Why is CV-101 faulting?" would be asset-specific
 *    and would need confirmation first; "What causes F0004 on a PowerFlex 525?"
 *    is a general question that the tenant's own fleet merely inspired.
 * 2. **Nothing is invented.** A fault is quoted only when `lastFault` is present
 *    on the row; an asset with no manufacturer AND model is skipped rather than
 *    turned into a vague prompt. Deduped by make+model so three identical drives
 *    do not produce three identical chips.
 */
export function suggestionsFrom(assets: readonly SuggestionAsset[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of assets) {
    const make = (a.manufacturer ?? "").trim();
    const model = (a.model ?? "").trim();
    if (!make && !model) continue;
    const label = [make, model].filter(Boolean).join(" ");
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const fault = (a.lastFault ?? "").trim();
    out.push(
      fault
        ? `What causes ${fault} on a ${label}?`
        : `How do I troubleshoot a ${label}?`,
    );
    if (out.length === 3) break;
  }
  return out.length > 0 ? out : [...FALLBACK_SUGGESTIONS];
}

export default function HomeComposer() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([...FALLBACK_SUGGESTIONS]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Suggestions drawn from live equipment state. Starts on the fallbacks so the
  // composer is never suggestion-less on first paint, and a failed or empty
  // fetch simply leaves them — a technician staring at an empty screen is the
  // Z-1 failure this whole unblocker exists to fix, so degrading to generic
  // starters beats degrading to nothing.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/assets`, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return;
        setSuggestions(suggestionsFrom(rows as SuggestionAsset[]));
      })
      .catch(() => {
        /* keep the fallbacks; never surface an error for a convenience. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

      {/* Tappable starters. A stranger handed the phone must be able to begin
          without composing a question first — that is the Z-1 walk. Each chip
          fills the box and focuses it rather than sending, so the technician
          can edit it into their own words; auto-sending would ask a question
          they did not choose. */}
      {!result && suggestions.length > 0 && (
        <ul className="flex flex-wrap gap-2" data-testid="home-composer-suggestions">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(s);
                  inputRef.current?.focus();
                }}
                className="rounded-full border px-3 text-xs"
                style={{
                  background: "var(--surface-0)",
                  borderColor: "var(--border)",
                  color: "var(--foreground)",
                  minHeight: 44,
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}

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
