"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MoreSheet from "@/factorylm-ui/MoreSheet";
import ScopePicker, {
  askEndpointFor,
  scopeHint,
  scopeLabel,
  type Scope,
} from "@/factorylm-ui/ScopePicker";
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

/** The asset path's 412 body. A 412 is MIRA REFUSING for a stated reason —
 *  the train-before-deploy gate holding — not the app failing. Rendering it as
 *  an error would teach technicians to retry through a deliberate refusal. */
type Refusal = {
  gate?: string;
  reason?: string;
  missingContext?: { key: string; label: string; status: string; action: string }[];
};

type Turn =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      citations: Citation[];
      evidence: EvidenceCitation[];
      refusal?: Refusal;
    };

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

const GENERAL_SUGGESTIONS = [
  "What does fault F0004 mean on a PowerFlex 525?",
  "A conveyor is grinding under load — what should I check first?",
  "How do I reset a Siemens G120 after an overcurrent trip?",
];

/**
 * Machine-scoped starters.
 *
 * Deliberately question SHAPES, not invented specifics: MIRA knows nothing
 * about this machine until it retrieves, so a suggestion naming a fault code
 * or a part number would be a fabrication printed by the UI itself. These ask
 * about things the asset path can actually ground — its history, its manuals,
 * its startup procedure.
 *
 * They also fixed a live contradiction the first screenshot caught: with
 * CV-101 bound, every chip still read "General question" while the badge read
 * "CV-101". The chips routed correctly and labelled themselves wrongly, which
 * is the worst combination — the interface disagreeing with itself about the
 * one thing that decides whether an answer is about your machine.
 */
const MACHINE_SUGGESTIONS = [
  "What faults has this machine had before?",
  "It stopped unexpectedly — what should I check first?",
  "Walk me through starting this machine safely.",
];

function suggestionsFor(scope: Scope): { q: string; hint: string }[] {
  const hint = scope ? scope.tag : "General question";
  return (scope ? MACHINE_SUGGESTIONS : GENERAL_SUGGESTIONS).map((q) => ({ q, hint }));
}

export default function V3Page() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [more, setMore] = useState(false);
  const [scope, setScope] = useState<Scope>(null);
  const [picker, setPicker] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Focused on load: "type, press Enter, answer begins" — a composer you must
  // click first does not meet A-1.
  useEffect(() => { taRef.current?.focus(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  // The waiting state names the step rather than showing a bare spinner, so a
  // variable multi-step pipeline reads as diagnostic instead of broken.
  // The step resets where the request STARTS (in `ask`), not here: resetting
  // it synchronously inside the effect body triggers a cascading render
  // (react-hooks/set-state-in-effect), and the effect's only real job is
  // owning the interval.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, WAIT_STEPS.length - 1)), 1800);
    return () => clearInterval(t);
  }, [busy]);

  /**
   * Two scopes, two endpoints — routed by `askEndpointFor`.
   *
   * general → POST /api/hub/ask (JSON) — hybrid corpus, no asset context.
   * machine → POST /api/assets/{id}/chat/ (SSE) — asset-scoped RAG, KG
   *   context, live signals, the safety classifier and the approved-context
   *   gate. It streams, so the answer appears token by token.
   *
   * The general route's own system prompt forbids claiming to know which
   * machine the technician is at, so a machine-scoped question CANNOT be
   * served there — it would read as machine-specific while being generic.
   */
  const ask = useCallback(async (question: string, at: Scope) => {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setSignedOut(false);
    setTurns((t) => [...t, { role: "user", text: q }]);
    setInput("");
    setStep(0);
    setBusy(true);
    try {
      if (at === null) {
        const res = await fetch(askEndpointFor(null), {
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
        return;
      }

      // ── Machine scope: the streaming asset path ──────────────────────────
      // A refusal turn is not an answer and must not enter the next turn's
      // history — the same rule AssetChat applies to a stopped turn.
      const history = turns
        .filter((t) => t.role === "user" || !t.refusal)
        .map((t) => ({ role: t.role, content: t.text }));
      const res = await fetch(askEndpointFor(at), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...history, { role: "user", content: q }] }),
      });
      if (res.status === 401) { setSignedOut(true); return; }
      if (res.status === 412) {
        // NOT an error. The approved-context gate is train-before-deploy
        // holding: this machine has no approved grounding yet, so MIRA
        // declines rather than guessing. Rendered as a refusal with the
        // specific missing pieces, so the technician knows what to fix.
        const body = (await res.json().catch(() => ({}))) as Refusal;
        setTurns((t) => [
          ...t,
          { role: "assistant", text: "", citations: [], evidence: [], refusal: body },
        ]);
        return;
      }
      if (!res.ok || !res.body) {
        setError("MIRA couldn't answer that just now.");
        setInput(q);
        return;
      }

      // Sources arrive up front, before the first token, so the citation
      // chips are present while the answer is still streaming.
      let acc = "";
      let citations: Citation[] = [];
      setTurns((t) => [...t, { role: "assistant", text: "", citations: [], evidence: [] }]);
      const commit = () =>
        setTurns((t) => {
          const next = [...t];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              text: acc,
              citations,
              evidence: toEvidence(citations),
            };
          }
          return next;
        });

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as { content?: string; sources?: Citation[] };
            if (parsed.sources) citations = parsed.sources;
            if (parsed.content) acc += parsed.content;
            commit();
          } catch {
            // A malformed frame is skipped, never rendered as text — a raw
            // JSON fragment in the answer body reads as corruption.
          }
        }
      }
      commit();
    } catch {
      setError("Couldn't reach MIRA. Your question is saved below — nothing was lost.");
      setInput(q);
    } finally {
      setBusy(false);
    }
  }, [busy, turns]);

  const lastUser = [...turns].reverse().find((t) => t.role === "user");

  return (
    <div className={`v3${drawer ? " v3-drawer" : ""}`} data-testid="v3-shell">
      <div className="v3-scrim" onClick={() => setDrawer(false)} />

      <aside className="v3-sidebar">
        <div className="v3-brand"><span className="v3-mark">FL</span>FactoryLM</div>
        {/* Every piece of turn-scoped state unwinds here. `signedOut` was
            missing: after a 401 the "Sign in to ask" notice sat under an empty
            thread until the next send happened to clear it. Same class as the
            AssetChat refusal leak (#3681) — the direction that SETS a notice
            gets written and verified; the direction that clears it has no
            author. The scope is deliberately NOT reset: it is a user choice,
            not turn state. */}
        <button className="v3-new" onClick={() => {
          setTurns([]); setError(null); setSignedOut(false); taRef.current?.focus();
        }}>
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
      {picker && (
        <ScopePicker current={scope} onPick={setScope} onClose={() => setPicker(false)} />
      )}

      <main className="v3-main">
        <header className="v3-top">
          <button className="v3-ham" aria-label="Open navigation" onClick={() => setDrawer(true)}>
            <i /><i /><i />
          </button>
          <div className="v3-title">{turns.length ? "Conversation" : "New chat"}</div>
          {/* Permanent scope badge. It says what MIRA does NOT have rather than
              implying plant context — answering about the wrong machine is a
              safety problem, not an inconvenience. */}
          <button
            className={`v3-scope${scope ? " v3-scope--bound" : ""}`}
            aria-haspopup="dialog"
            aria-label="Change what you're asking about"
            onClick={() => setPicker(true)}
          >
            <span className="v3-dot" /><span>{scopeLabel(scope)}</span><span className="v3-caret">⌄</span>
          </button>
        </header>

        <div className="v3-thread">
          {turns.length === 0 && !busy && (
            <div className="v3-home">
              <h1>What are you working on?</h1>
              <p className="v3-sub">{scopeHint(scope)}</p>
              <div className="v3-sugg">
                {suggestionsFor(scope).map((s) => (
                  <button key={s.q} onClick={() => void ask(s.q, scope)}>
                    {s.q}<small>{s.hint}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="v3-turn v3-u"><div className="v3-bubble">{t.text}</div></div>
            ) : t.refusal ? (
              /* A refusal, not a failure. MIRA has no approved grounding for
                 this machine yet, so it declines and names what is missing —
                 the train-before-deploy gate working as designed. There is no
                 Retry: retrying changes nothing until the context exists. */
              <div key={i} className="v3-turn v3-a">
                <div className="v3-ahead">
                  <span className="v3-mira">M</span><b>MIRA</b>
                  <span className="v3-basis v3-basis-held">◐ Holding — not enough approved context</span>
                </div>
                <div className="v3-refusal">
                  <p>{t.refusal.reason ?? "MIRA needs approved context for this machine before answering."}</p>
                  {(t.refusal.missingContext ?? []).length > 0 && (
                    <ul>
                      {(t.refusal.missingContext ?? []).map((m) => (
                        <li key={m.key} data-status={m.status}>
                          <b>{m.label}</b> — {m.action}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="v3-refusal__foot">
                    You can still ask this as a general question.
                  </p>
                  <div className="v3-actions">
                    <button onClick={() => {
                      setScope(null);
                      if (lastUser) void ask(lastUser.text, null);
                    }}>
                      Ask generally instead
                    </button>
                  </div>
                </div>
              </div>
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
                    <span className="v3-basis v3-basis-general">⚠ General guidance — no source cited</span>
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
                  <button onClick={() => lastUser && void ask(lastUser.text, scope)}>↻ Retry</button>
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
                <button onClick={() => lastUser && void ask(lastUser.text, scope)}>Try again</button>
                <button onClick={() => setError(null)}>Dismiss</button>
              </div>
            </div></div>
          )}

          <div ref={endRef} />
        </div>

        <div className="v3-cwrap">
          <div className="v3-composer">
            <button className="v3-ctx" onClick={() => setPicker(true)}>{scopeHint(scope)}</button>
            <div className="v3-crow">
              <button className="v3-icon" aria-label="Add attachment">＋</button>
              <button className="v3-icon" aria-label="Take photo">◉</button>
              <textarea
                ref={taRef} value={input} rows={1} maxLength={1000}
                aria-label="Ask MIRA" placeholder="Ask MIRA…"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault(); void ask(input, scope);
                  }
                }}
              />
              <button className="v3-icon v3-send" aria-label="Send"
                disabled={!input.trim() || busy} onClick={() => void ask(input, scope)}>↑</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
