"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MoreSheet from "@/factorylm-ui/MoreSheet";
import { AnswerMarkdown } from "@/components/equipment/notebook-markdown";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";

import { API_BASE } from "@/lib/config";
import "./v3.css";

/**
 * FactoryLM V3 — the approved prototype, connected.
 *
 * Design source: docs/prototypes/factorylm-unified-ui-v3/index.html, approved
 * 2026-09-08. This is FLM-UI-4000 Phase 2 for the web lane: the shell mounted
 * at a NON-DEFAULT route so it can be exercised against real data without
 * changing what any existing user sees. /feed is untouched.
 *
 * What is real here: the composer posts to `/api/hub/ask`, which retrieves
 * under the caller's tenant (shared OEM library + their own uploads) and
 * answers through the provider cascade. Citations, groundedness and errors all
 * render from that response.
 *
 * What is still fixture: the sidebar's recent/workspace lists. Those become
 * real in Phase 3, when the Golden Conversation connects projects and history.
 * They are marked in the code rather than left to look connected.
 *
 * Rendering reuses `AnswerMarkdown` (the Equipment Notebook renderer) rather
 * than importing react-markdown again. That component already carries the
 * contracts this surface needs: GFM tables and lists, soft line breaks kept,
 * raw HTML escaped and never executed, and `[n]` markers converted to chips
 * ONLY when a matching citation exists — so an unmatched marker stays plain
 * text instead of becoming a dead citation button.
 */

type Citation = { index: number; title: string; url: string | null; page: number | null; verified: boolean };
type AskResponse = { answer: string; citations: Citation[]; provider: string | null };

type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; citations: Citation[]; evidence: EvidenceCitation[] };

/** Project the ask API's citation list onto the renderer's evidence shape, so
 *  inline `[n]` markers resolve to the same sources the cards below show. */
function toEvidence(citations: Citation[]): EvidenceCitation[] {
  return citations.map((c) => ({
    citationId: String(c.index),
    docId: String(c.index),
    sourceTitle: c.title,
    page: c.page,
    fileId: null,
    quote: null,
  }));
}

/** The steps the waiting state names, in the order the backend performs them. */
const WAIT_STEPS = ["Searching your manuals…", "Reading the closest sources…", "Writing the answer…"];

const SUGGESTIONS = [
  { q: "What does fault F0004 mean on a PowerFlex 525?", hint: "General question" },
  { q: "A conveyor is grinding under load — what should I check first?", hint: "General question" },
  { q: "How do I reset a Siemens G120 after an overcurrent trip?", hint: "General question" },
];

export default function V3Page() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [more, setMore] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Focused on load: "type, press Enter, answer begins" — a composer you must
  // click first does not meet A-1.
  useEffect(() => { taRef.current?.focus(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  // The waiting state names the step rather than showing a bare spinner, so a
  // variable multi-step pipeline reads as diagnostic instead of broken.
  useEffect(() => {
    if (!busy) { setStep(0); return; }
    const t = setInterval(() => setStep((s) => Math.min(s + 1, WAIT_STEPS.length - 1)), 1800);
    return () => clearInterval(t);
  }, [busy]);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setSignedOut(false);
    setTurns((t) => [...t, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/hub/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (res.status === 401) { setSignedOut(true); return; }
      const data = (await res.json()) as AskResponse & { error?: string };
      if (!res.ok) {
        // Plain language, the question preserved, and a button. Never a status
        // code, and never "refresh the page" — advice that cannot work.
        setError(data.error ?? "MIRA couldn't answer that just now.");
        setInput(q);
        return;
      }
      const citations = data.citations ?? [];
      setTurns((t) => [
        ...t,
        { role: "assistant", text: data.answer, citations, evidence: toEvidence(citations) },
      ]);
    } catch {
      setError("Couldn't reach MIRA. Your question is saved below — nothing was lost.");
      setInput(q);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const lastUser = [...turns].reverse().find((t) => t.role === "user");

  return (
    <div className={`v3${drawer ? " v3-drawer" : ""}`} data-testid="v3-shell">
      <div className="v3-scrim" onClick={() => setDrawer(false)} />

      <aside className="v3-sidebar">
        <div className="v3-brand"><span className="v3-mark">FL</span>FactoryLM</div>
        <button className="v3-new" onClick={() => { setTurns([]); setError(null); taRef.current?.focus(); }}>
          ＋ New chat
        </button>
        {/* Fixture until Phase 3 connects projects and history. */}
        <nav className="v3-nav">
          <div className="v3-navlabel">Workspace</div>
          <button className="v3-item">▣ Projects</button>
          <button className="v3-item">▦ Machines</button>
          <button className="v3-item">▤ Manuals</button>
          <button className="v3-item">✓ Work orders</button>
          <button className="v3-item" onClick={() => setMore(true)}>More ›</button>
        </nav>
      </aside>

      {more && <MoreSheet onClose={() => setMore(false)} />}

      <main className="v3-main">
        <header className="v3-top">
          <button className="v3-ham" aria-label="Open navigation" onClick={() => setDrawer(true)}>
            <i /><i /><i />
          </button>
          <div className="v3-title">{turns.length ? "Conversation" : "New chat"}</div>
          {/* Permanent scope badge. It says what MIRA does NOT have rather than
              implying plant context — answering about the wrong machine is a
              safety problem, not an inconvenience. */}
          <button className="v3-scope"><span className="v3-dot" /><span>No machine — general</span></button>
        </header>

        <div className="v3-thread">
          {turns.length === 0 && !busy && (
            <div className="v3-home">
              <h1>What are you working on?</h1>
              <p className="v3-sub">Ask anything. Open a machine to ask about it specifically.</p>
              <div className="v3-sugg">
                {SUGGESTIONS.map((s) => (
                  <button key={s.q} onClick={() => void ask(s.q)}>
                    {s.q}<small>{s.hint}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="v3-turn v3-u"><div className="v3-bubble">{t.text}</div></div>
            ) : (
              <div key={i} className="v3-turn v3-a">
                <div className="v3-ahead">
                  <span className="v3-mira">M</span><b>MIRA</b>
                  {/* Groundedness stated positively. Absence of a citation is
                      indistinguishable from one that failed to render, so the
                      claim is made, never inferred. */}
                  {t.citations.length > 0 ? (
                    <span className="v3-basis v3-basis-cited">
                      ● Grounded in {t.citations.length} source{t.citations.length === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span className="v3-basis v3-basis-general">⚠ General guidance — no manual on file</span>
                  )}
                </div>

                <AnswerMarkdown content={t.text} citations={t.evidence} />

                {t.citations.length > 0 && (
                  <div className="v3-cites">
                    {t.citations.map((c) => (
                      <button key={c.index} className="v3-cite"
                        onClick={() => c.url && window.open(c.url, "_blank", "noopener")}>
                        <span className="v3-kind">{c.verified ? "MANUAL" : "SOURCE"}</span>
                        <span className="v3-doc">{c.title}</span>
                        {c.page !== null && <span className="v3-pg">p.{c.page}</span>}
                      </button>
                    ))}
                  </div>
                )}

                <div className="v3-actions">
                  <button onClick={() => void navigator.clipboard?.writeText(t.text)}>⧉ Copy</button>
                  <button onClick={() => lastUser && void ask(lastUser.text)}>↻ Retry</button>
                </div>
              </div>
            ),
          )}

          {busy && (
            <div className="v3-turn v3-a">
              <div className="v3-ahead"><span className="v3-mira">M</span><b>MIRA</b></div>
              {WAIT_STEPS.map((s, i) => (
                <div key={s} className="v3-waiting" style={{ opacity: i === step ? 1 : i < step ? 0.5 : 0.28 }}>
                  {i === step && <span className="v3-spin" />} {s}
                </div>
              ))}
            </div>
          )}

          {signedOut && (
            <div className="v3-notice v3-notice-warn"><div>▤</div><div>
              <b>Sign in to ask</b>MIRA searches your own uploaded manuals as well as the shared library.
              <div className="v3-noticerow"><a href={`${API_BASE}/login`}><button>Sign in</button></a></div>
            </div></div>
          )}

          {error && (
            <div className="v3-notice v3-notice-stop"><div>✕</div><div>
              <b>Couldn&apos;t reach MIRA</b>{error} Your question is still in the box below.
              <div className="v3-noticerow">
                <button onClick={() => lastUser && void ask(lastUser.text)}>Try again</button>
                <button onClick={() => setError(null)}>Dismiss</button>
              </div>
            </div></div>
          )}

          <div ref={endRef} />
        </div>

        <div className="v3-cwrap">
          <div className="v3-composer">
            <div className="v3-ctx">General question · open a machine to ask about it specifically</div>
            <div className="v3-crow">
              <button className="v3-icon" aria-label="Add attachment">＋</button>
              <button className="v3-icon" aria-label="Take photo">◉</button>
              <textarea
                ref={taRef} value={input} rows={1} maxLength={1000}
                aria-label="Ask MIRA" placeholder="Ask MIRA…"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault(); void ask(input);
                  }
                }}
              />
              <button className="v3-icon v3-send" aria-label="Send"
                disabled={!input.trim() || busy} onClick={() => void ask(input)}>↑</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
