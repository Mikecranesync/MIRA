"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MoreSheet, { sidebarDestinations } from "@/factorylm-ui/MoreSheet";
import { labsEnabled } from "@/providers/access-control";
import ScopePicker, {
  askEndpointFor,
  scopeHint,
  scopeKey,
  scopeLabel,
  suggestionsFor,
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

/**
 * Every turn records the scope it was asked under.
 *
 * `at` is the live Scope (so Retry can re-ask a turn against ITS machine, not
 * whatever is selected now) and `key` is its routing identity from
 * `scopeKey` (so history can be partitioned without comparing objects).
 *
 * This is not bookkeeping — it is the identity boundary. Without it, switching
 * from machine A to machine B carried A's turns into B's request, letting A's
 * fault history shape an answer rendered as grounded for B. Adversarial review
 * F1 on PR #3683.
 */
type Turn = { at: Scope; key: string } & (
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      citations: Citation[];
      evidence: EvidenceCitation[];
      refusal?: Refusal;
    }
);

/**
 * The history a machine-scoped request is allowed to carry.
 *
 * Exported and pure so the boundary can be asserted directly on data, rather
 * than inferred from the shape of the source. Two exclusions, both grounding
 * rules:
 *
 *  1. `t.key === key` — only turns asked under THIS scope. Machine A's turns
 *     must never reach machine B's endpoint: B's answer would be shaped by A's
 *     fault history while being rendered as grounded for B, with the scope
 *     badge saying B and the evidence belonging to A.
 *  2. refusals are not answers, so they do not enter the next turn's history —
 *     the same rule AssetChat applies to a stopped turn.
 */
export function historyFor(turns: Turn[], key: string): { role: string; content: string }[] {
  return turns
    .filter((t) => t.key === key)
    .filter((t) => t.role === "user" || !t.refusal)
    .map((t) => ({ role: t.role, content: t.text }));
}

/**
 * The question an assistant turn at index `i` is answering — the nearest user
 * turn before it. Pure and exported for the same reason as `historyFor`: what
 * Retry re-sends is a behaviour, and it was wrong (F3).
 */
export function questionBefore(turns: Turn[], i: number): Extract<Turn, { role: "user" }> | undefined {
  for (let j = i - 1; j >= 0; j--) {
    const t = turns[j];
    if (t.role === "user") return t;
  }
  return undefined;
}

/**
 * One SSE frame from the asset-chat stream, classified.
 *
 * Exported and pure because the distinction it draws is a grounding rule, not
 * a parsing detail: the asset route streams provider exhaustion as HTTP 200
 * with the outage sentence in an ordinary `content` field, so status alone
 * cannot tell an outage from an answer. V3 rendered that text as MIRA's reply,
 * badged "General guidance - no source cited". A technician could not tell the
 * backend was down. (Round 2, F3.)
 *
 * A frame carrying `error` is a FAILURE and never becomes answer text.
 */
export type Frame =
  | { kind: "outage"; message: string }
  | { kind: "sources"; sources: Citation[] }
  | { kind: "content"; text: string }
  | { kind: "ignore" };

export function readFrame(payload: string): Frame {
  if (payload === "[DONE]") return { kind: "ignore" };
  let parsed: { content?: string; sources?: Citation[]; error?: string };
  try {
    parsed = JSON.parse(payload);
  } catch {
    // A malformed frame is skipped, never rendered as text - a raw JSON
    // fragment in the answer body reads as corruption.
    return { kind: "ignore" };
  }
  // Checked FIRST: a failure frame also carries `content`, and treating it as
  // content is precisely the defect.
  if (parsed.error) {
    return { kind: "outage", message: parsed.content ?? "MIRA is temporarily unavailable." };
  }
  if (parsed.sources) return { kind: "sources", sources: parsed.sources };
  if (parsed.content) return { kind: "content", text: parsed.content };
  return { kind: "ignore" };
}

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

/** Glyphs for the sidebar rows. Presentation only — the destinations, their
 *  order and their gating all come from `sidebarDestinations`. */
const SIDEBAR_ICON: Record<string, string> = {
  notebooks: "▣",
  assets: "▦",
  knowledge: "▤",
  workorders: "✓",
};

type Me = { role?: string; capabilities?: string[] };

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

  /** Conversation generation. `New chat` bumps it; a request whose generation
   *  is stale must not write to the replacement conversation. (Round 2, F1.) */
  const genRef = useRef(0);
  /** The in-flight request, so `New chat` can abort it rather than merely
   *  ignoring its result. */
  const abortRef = useRef<AbortController | null>(null);

  /**
   * The request that failed, with the question AND the scope it was asked
   * under.
   *
   * `Try again` used to combine the global newest question with the CURRENTLY
   * selected machine, so failing on machine A then switching the picker to B
   * re-sent A's question to B. A failure is a property of the request that
   * failed, not of whatever is selected when the user reaches for the button.
   * (Round 2, F2.)
   */
  const [failed, setFailed] = useState<{ text: string; at: Scope } | null>(null);

  // Who is asking — role and capabilities gate which sidebar rows exist. Same
  // server-authoritative contract MoreSheet consumes (#1932: the nav once
  // offered what the API then refused). On failure the sidebar simply carries
  // no primary rows; `More ›` and the composer still work.
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/api/me`, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) setMe(d as Me); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const navItems = me ? sidebarDestinations(me, labsEnabled()) : [];

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
    setFailed(null);
    const key = scopeKey(at);

    // This request's claim on the conversation.
    //
    // New chat bumps `genRef` and aborts the in-flight request. Without both,
    // a slow reply that landed after New chat appended an assistant turn into
    // the fresh, empty thread — machine-specific guidance with no question
    // above it — and `busy` stayed true until the abandoned request finished,
    // so the composer was locked meanwhile. Every state write below is gated
    // on `alive()`. Adversarial review round 2, F1.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const gen = genRef.current;
    const alive = () => genRef.current === gen && !ctrl.signal.aborted;
    setTurns((t) => [...t, { role: "user", text: q, at, key }]);
    setInput("");
    setStep(0);
    setBusy(true);
    try {
      if (at === null) {
        const res = await fetch(askEndpointFor(null), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q }),
          signal: ctrl.signal,
        });
        if (!alive()) return;
        if (res.status === 401) { setSignedOut(true); return; }
        const data = (await res.json()) as AskResponse & { error?: string };
        if (!alive()) return;
        if (!res.ok) {
          // Plain language, the question preserved, and a button. Never a status
          // code, and never "refresh the page" — advice that cannot work.
          setError(data.error ?? "MIRA couldn't answer that just now.");
          setFailed({ text: q, at });
          setInput(q);
          return;
        }
        const citations = data.citations ?? [];
        setTurns((t) => [
          ...t,
          { role: "assistant", text: data.answer, citations, evidence: toEvidence(citations), at, key },
        ]);
        return;
      }

      // ── Machine scope: the streaming asset path ──────────────────────────
      // Two independent exclusions, and BOTH are grounding rules:
      //
      //  1. Only turns asked under THIS scope. A conversation about machine A
      //     must never be sent to machine B's endpoint — B's answer would be
      //     shaped by A's fault history while being rendered as grounded for
      //     B. The scope badge would say B and the evidence would be A's.
      //  2. A refusal turn is not an answer and must not enter the next
      //     turn's history — the same rule AssetChat applies to a stopped turn.
      const history = historyFor(turns, key);
      const res = await fetch(askEndpointFor(at), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...history, { role: "user", content: q }] }),
        signal: ctrl.signal,
      });
      if (!alive()) return;
      if (res.status === 401) { setSignedOut(true); return; }
      if (res.status === 412) {
        // NOT an error. The approved-context gate is train-before-deploy
        // holding: this machine has no approved grounding yet, so MIRA
        // declines rather than guessing. Rendered as a refusal with the
        // specific missing pieces, so the technician knows what to fix.
        const body = (await res.json().catch(() => ({}))) as Refusal;
        if (!alive()) return;
        setTurns((t) => [
          ...t,
          { role: "assistant", text: "", citations: [], evidence: [], refusal: body, at, key },
        ]);
        return;
      }
      if (!res.ok || !res.body) {
        setError("MIRA couldn't answer that just now.");
        setFailed({ text: q, at });
        setInput(q);
        return;
      }

      // Sources arrive up front, before the first token, so the citation
      // chips are present while the answer is still streaming.
      let acc = "";
      let citations: Citation[] = [];
      // Set by an explicit `error` frame. The asset route streams provider
      // exhaustion as HTTP 200 + ordinary text, so status alone cannot tell an
      // outage from an answer — and rendering it as one badged "General
      // guidance — no source cited" over the words "MIRA is temporarily
      // unavailable". (Round 2, F3.)
      let outage: string | null = null;
      setTurns((t) => [...t, { role: "assistant", text: "", citations: [], evidence: [], at, key }]);
      const commit = () => {
        if (!alive()) return;
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
      };

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
          const frame = readFrame(payload);
          if (frame.kind === "outage") { outage = frame.message; continue; }
          if (frame.kind === "sources") citations = frame.sources;
          else if (frame.kind === "content") acc += frame.text;
          else continue;
          commit();
        }
      }
      if (outage) {
        if (!alive()) return;
        // Drop the placeholder assistant turn — there is no answer — and show
        // the same recoverable failure state any other outage produces, with
        // the question preserved so nothing is lost.
        setTurns((t) => {
          const next = [...t];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && !last.text) next.pop();
          return next;
        });
        setError(outage);
        setFailed({ text: q, at });
        setInput(q);
        return;
      }
      commit();
    } catch (e) {
      // An abort is this component cancelling deliberately (New chat), not a
      // failure to report. Rendering it as an error would blame the network
      // for the user's own action.
      if ((e as { name?: string })?.name === "AbortError" || !alive()) return;
      setError("Couldn't reach MIRA. Your question is saved below — nothing was lost.");
      setFailed({ text: q, at });
      setInput(q);
    } finally {
      // Only the request that still owns the conversation may release the
      // composer — otherwise an abandoned request unlocks a live one.
      if (alive()) setBusy(false);
    }
  }, [busy, turns]);

  /**
   * The question a given assistant turn is answering: the nearest user turn
   * BEFORE it.
   *
   * Retry has to re-ask THAT question, under the scope it was originally asked
   * in. Every Retry button used to close over one shared `lastUser`, so
   * pressing Retry on the first answer silently re-sent the newest question
   * and appended a duplicate turn — the earlier answer could not be retried at
   * all. Adversarial review F3 on PR #3683.
   */
  const askedBefore = (i: number) => questionBefore(turns, i);

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
          // Invalidate first, then abort: a reply already in flight must not
          // land in the conversation that replaces this one, and the composer
          // must free immediately rather than when the abandoned request ends.
          genRef.current += 1;
          abortRef.current?.abort();
          abortRef.current = null;
          setBusy(false);
          setTurns([]); setError(null); setSignedOut(false); setFailed(null);
          taRef.current?.focus();
        }}>
          ＋ New chat
        </button>
        {/* Real destinations, resolved from the canonical NAV_ITEMS via
            `sidebarDestinations` and gated by the caller's role/capabilities —
            the same contract More uses. These were four handlerless buttons:
            they looked like navigation and did nothing, which is the same
            broken promise `More ›` made before it opened. Rows the caller
            cannot reach are not rendered at all. (F2, PR #3683.) */}
        <nav className="v3-nav">
          <div className="v3-navlabel">Workspace</div>
          {navItems.map((n) => (
            <a key={n.key} className="v3-item" href={`${API_BASE}${n.href}`}>
              {SIDEBAR_ICON[n.key] ?? "▫"} {n.label}
            </a>
          ))}
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
                      // THIS refusal's question, by index — not the newest one.
                      // Clicking an older refusal after later turns used to
                      // resend whatever was asked most recently. (Round 2, F2.)
                      const asked = questionBefore(turns, i);
                      setScope(null);
                      if (asked) void ask(asked.text, null);
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
                  <button onClick={() => {
                    // This answer's own question, at its own scope — never the
                    // newest question, and never the currently-selected machine.
                    const asked = askedBefore(i);
                    if (asked) void ask(asked.text, asked.at);
                  }}>↻ Retry</button>
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
              {/* A link, not a <button> inside an <a>. Nested interactive content is
                  invalid HTML and gives assistive tech two overlapping controls for
                  one action; the inner button also had no handler, so it was the
                  anchor doing the work all along. As an anchor it keeps what a link
                  should do — middle-click, open in new tab, copy address. */}
              <div className="v3-noticerow"><a href={`${API_BASE}/login`}>Sign in</a></div>
            </div></div>
          )}

          {error && (
            <div className="v3-notice v3-notice-stop"><div>✕</div><div>
              <b>Couldn&apos;t reach MIRA</b>{error} Your question is still in the box below.
              <div className="v3-noticerow">
                {/* The failed request, at ITS scope. Using the current picker
                    value here sent machine A's failed question to machine B
                    after a scope switch. (Round 2, F2.) */}
                <button onClick={() => failed && void ask(failed.text, failed.at)}>Try again</button>
                <button onClick={() => setError(null)}>Dismiss</button>
              </div>
            </div></div>
          )}

          <div ref={endRef} />
        </div>

        <div className="v3-cwrap">
          <div className="v3-composer">
            <button className="v3-ctx" onClick={() => setPicker(true)}>{scopeHint(scope)}</button>
            {/* The attachment (＋) and camera (◉) controls that stood here had no
                onClick. They rendered as enabled buttons and carried accessible
                labels — so a screen reader announced "Add attachment, button" for
                a control that did nothing when activated, which is worse than
                absent. Removed rather than disabled: a permanently-disabled
                control is a different lie, not a smaller one.

                They come back with the photo→nameplate spine
                (docs/V3_PATH_TO_SHIPPING.md §1b), which is wiring against
                endpoints that already exist — /api/documents/upload, /api/files,
                /api/equipment-notebooks/recognize-nameplate — plus the upload
                progress and failure states that make an attachment honest. Until
                that lands, the composer promises only what it delivers. */}
            <div className="v3-crow">
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
