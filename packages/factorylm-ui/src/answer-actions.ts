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
export function spokenAnswerText(turn: Pick<InteractionTurn, "parts">): string {
  const notices = turn.parts
    .filter((p): p is Extract<InteractionPart, { type: "safety_notice" }> => p.type === "safety_notice")
    .map((p) => `${p.notice.severity === "stop" ? "Stop" : "Warning"}. ${p.notice.message.trim()}`);
  return [...notices, answerText(turn)].filter((t) => t.trim()).join("\n\n");
}

/** Text fit for a speech engine: no citation marks, no markdown syntax. A
 *  voice reading "bracket one" or "asterisk asterisk" is worse than silence. */
export function speakableText(text: string): string {
  return text
    .replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
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
