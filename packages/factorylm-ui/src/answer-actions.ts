// Finished-answer actions shared by every host: read-aloud and "what fixed it".
//
// The shell only renders the buttons (parts.tsx hooks); hosts own the side
// effects. What lives here is the part both hosts must agree on, so the Hub and
// the phone speak the same words and record the same symptom.
//
// Read-aloud uses the platform Web Speech API (commodity-before-custom). Where
// the API is missing the host passes no hook, so the button never appears dead.
// (Voices load asynchronously; an empty getVoices() at mount is not "missing".)
import type { InteractionPart, InteractionTurn } from "@factorylm/interaction";

const SYMPTOM_MAX = 500;

/** The answer's own words, as the text parts render them. */
export function answerText(turn: Pick<InteractionTurn, "parts">): string {
  return turn.parts
    .filter((p): p is Extract<InteractionPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n")
    .trim();
}

/**
 * What read-aloud speaks for a turn: every safety notice FIRST, in order and in
 * the shell's own words ("Stop." / "Warning." + message), then the answer. A
 * technician listening with their hands in a panel must hear "de-energize and
 * verify" before the steps, exactly as the screen shows it (Codex #4058 F1).
 */
export function spokenAnswerText(
  turn: Pick<InteractionTurn, "parts">,
  citationIds: ReadonlySet<string> = NO_CITATIONS,
): string {
  const notices = turn.parts
    .filter((p): p is Extract<InteractionPart, { type: "safety_notice" }> => p.type === "safety_notice")
    .map((p) => `${p.notice.severity === "stop" ? "Stop" : "Warning"}. ${p.notice.message.trim()}`);
  return [...notices, dropCitationMarks(answerText(turn), citationIds)].filter((t) => t.trim()).join("\n\n");
}

const NO_CITATIONS: ReadonlySet<string> = new Set();

/** Drop the answer's OWN citation marks. `[n]` is a citation only when `n` is
 *  one of this turn's citation ids (the renderers' chip rule) AND it sits where
 *  a citation sits — closing a clause: before punctuation, another mark, or the
 *  end of a line. So "fault [1234]" and "set output [1] ON" are spoken, never
 *  silently deleted, even when the turn also cites source 1 (Codex #4058 post-cap F1). */
function dropCitationMarks(text: string, citationIds: ReadonlySet<string>): string {
  return text.replace(/\s*\[(\d+)\](?=\s*(?:[.,;:!?)\]\[]|$))/gm, (mark, n: string) => (citationIds.has(n) ? "" : mark));
}

/** Text fit for a speech engine: no citation marks, no markdown syntax. A
 *  voice reading "bracket one" or "asterisk asterisk" is worse than silence —
 *  but a technical token must survive intact: only `[n]` marks naming one of
 *  `citationIds` are dropped, and `_` is removed only as an emphasis delimiter
 *  at a word edge, never inside an identifier like VFD_01 (Codex #4058 post-cap F1). */
export function speakableText(text: string, citationIds: ReadonlySet<string> = NO_CITATIONS): string {
  // Code is spoken VERBATIM (Codex #4058 post-cap F1): lift fenced blocks and
  // inline spans out first — keeping a fence's contents ("P1.01 = 8 s") but not
  // its fences or language label — so no later pass can eat a `2*base`, a
  // fenced "# comment" / "- item", or an "[1]" inside code. Restored at the end.
  const code: string[] = [];
  const keep = (body: string) => `\u0000${code.push(body) - 1}\u0000`;
  const prose = text
    .replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_m, body: string) => keep(body))
    .replace(/`([^`]*)`/g, (_m, body: string) => keep(body));
  return dropCitationMarks(prose, citationIds)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    // Emphasis delimiters only at a word edge — never inside a token such as
    // VFD_01 or 2*base.
    .replace(/(?<![A-Za-z0-9])(\*\*|\*|~~|__|_)(?=\S)|(?<=\S)(\*\*|\*|~~|__|_)(?![A-Za-z0-9])/g, "")
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => code[Number(i)] ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** The symptom a recorded fix is filed under: the technician's own question
 *  that this answer replied to. Null when there is no preceding question. */
export function fixSymptomFor(turns: readonly InteractionTurn[], answerTurnId: string): string | null {
  const at = turns.findIndex((t) => t.id === answerTurnId);
  for (let i = at - 1; i >= 0; i -= 1) {
    const t = turns[i];
    if (t && t.role === "user") {
      const q = answerText(t).replace(/\s+/g, " ").trim();
      return q ? q.slice(0, SYMPTOM_MAX) : null;
    }
  }
  return null;
}

/** Idempotency keys for "Record what fixed it". The fix table is append-only
 *  and the server requires a `clientRequestId`: the SAME fix for the same
 *  answer keeps its id until it is saved, so a retry after a lost response
 *  replays the stored record instead of writing a second one. */
export interface FixRequestIds {
  idFor(turnId: string, fix: string): string;
  /** Forget the id once the save succeeded (or the server refused it). */
  settle(turnId: string, fix: string): void;
}

export function createFixRequestIds(newId: () => string = () => crypto.randomUUID()): FixRequestIds {
  const pending = new Map<string, string>();
  const key = (turnId: string, fix: string) => `${turnId}\u0000${fix}`;
  return {
    idFor(turnId, fix) {
      const k = key(turnId, fix);
      let id = pending.get(k);
      if (!id) {
        id = newId();
        pending.set(k, id);
      }
      return id;
    },
    settle(turnId, fix) {
      pending.delete(key(turnId, fix));
    },
  };
}

/** The server turn id behind a shell answer id. Both hosts name a persisted
 *  answer `<server turn uuid>-a`; a live or pending answer (`live-0-a`,
 *  `pending-a`) has no server row yet, so it cannot be recorded against — the
 *  server reads the machine the answer was served for from that row (Codex
 *  #4058 post-cap F1). Null means "hide Record what fixed it". */
const SERVER_ANSWER_ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-a$/i;

export function serverTurnIdFor(turnId: string): string | null {
  const m = SERVER_ANSWER_ID.exec(turnId);
  return m ? m[1].toLowerCase() : null;
}

const FIX_REFUSALS: Record<string, string> = {
  asset_not_confirmed: "Confirm which machine this is before recording a fix.",
  answer_machine_mismatch:
    "That answer was about a different machine than this chat is on now. Record the fix from an answer about this machine.",
  source_turn_not_found: "That answer isn't saved in this chat. Reload and try again.",
  asset_binding_changed: "This chat's machine changed while saving. Check the machine and record the fix again.",
  request_id_conflict: "That fix could not be saved. Record it again.",
};

/** The message for a POST /fixes error code, or null when the code is not a
 *  refusal the technician can act on (network/server: keep the id, retry). */
export function fixRefusalMessage(code: string | null | undefined): string | null {
  return (code && FIX_REFUSALS[code]) || null;
}

type Synth = Pick<SpeechSynthesis, "speak" | "cancel" | "speaking">;
type UtteranceCtor = new (text: string) => SpeechSynthesisUtterance;

export interface ReadAloud {
  /** Speak this turn; a second press on the same turn stops it. */
  toggle(turnId: string, text: string): void;
  stop(): void;
  /** Name the conversation on screen. A different key stops playback, so an
   *  answer for machine A never keeps talking over machine B's thread. */
  scope(key: string): void;
}

/** A read-aloud controller, or null where the platform cannot speak. Hosts
 *  pass `onReadAloud` only when this is non-null. */
export function createReadAloud(
  synth: Synth | undefined = typeof window !== "undefined" ? window.speechSynthesis : undefined,
  Utterance: UtteranceCtor | undefined = typeof window !== "undefined" ? window.SpeechSynthesisUtterance : undefined,
): ReadAloud | null {
  if (!synth || !Utterance) return null;
  let current: string | null = null;
  // The utterance that owns `current`. A cancelled utterance may still fire
  // onend after a newer one started; only the owner may clear the state.
  let active: SpeechSynthesisUtterance | null = null;
  let scopeKey: string | null = null;
  const stop = () => {
    current = null;
    active = null;
    synth.cancel();
  };
  return {
    stop,
    scope(key) {
      if (scopeKey !== null && scopeKey !== key) stop();
      scopeKey = key;
    },
    toggle(turnId, text) {
      // Keyed on this controller's own utterance, not synth.speaking: a second
      // press before playback starts must still stop (Codex #4058 F2).
      if (current === turnId && active !== null) {
        stop();
        return;
      }
      const spoken = speakableText(text);
      synth.cancel();
      if (!spoken) {
        current = null;
        active = null;
        return;
      }
      const u = new Utterance(spoken);
      u.onend = () => {
        if (active !== u) return;
        current = null;
        active = null;
      };
      current = turnId;
      active = u;
      synth.speak(u);
    },
  };
}
