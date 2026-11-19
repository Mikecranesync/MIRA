// A send that died survives a reload (#4846, #5463): the newest failed answer
// offers Retry, and a failure the technician already asked again is not shown.
//
// Seen on staging /v3 (overnight walks 2026-10-27 to 2026-11-18): F5 or Back
// while an answer streams leaves a stored turn with no answer text; after the
// reload it renders "The answer could not be completed." with no Retry, and
// every further reload or re-ask stacks another one. The live Retry is gone
// because it lives in React state, which the reload erased.
//
// Retry here re-asks the stored question through the ordinary send path, the
// same as typing it again: a new request under the scope the header shows now.
// It never replays the original request (a request id replays the stored
// failure, #4374 Codex R2), and it never answers from anything the original
// turn did not already have.
//
// Pure: stored rows in, rows or turns out. No network, no clock.

import type { InteractionTurn } from "../../../packages/factorylm-interaction/src";
import type { PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import { isComponentAttributionEntry } from "@/capabilities/bench-components/attribution";
import { isProviderFailureEntry, isVisualObservationEntry } from "@/lib/notebook-chat-types";
import { answerTurnId, hasIdentityDispute, identityProposalOf } from "./to-interaction";

/** A stored turn that ended with no answer text at all (answer_status "error",
 *  nothing streamed). A stopped answer keeps its partial text; a refusal, an
 *  abstention or a safety stop is not stored as an error. */
function failedWithNoText(row: PersistedTurn): boolean {
  return row.answerStatus === "error" && (row.answerText ?? "") === "";
}

/** The only thing such a turn shows is its red failure bubble: no identity
 *  card (those render on every path), so hiding it hides nothing else. */
function onlyAFailureBubble(row: PersistedTurn): boolean {
  const evidence = row.evidence as readonly unknown[];
  return failedWithNoText(row) && !hasIdentityDispute(evidence) && identityProposalOf(evidence) === null;
}

/** Questions compare as typed apart from case and spacing. */
function sameQuestion(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const x = norm(a);
  return x.length > 0 && x === norm(b);
}

/**
 * The rows to show: a turn that shows only a red failure bubble is dropped
 * when the very next turn asks the same question again. That later turn is
 * the technician's retry and holds everything the failed one did. A stopped
 * answer (partial text), a failure with an identity card, and a failure
 * followed by a different question all stay. `rows` is one conversation,
 * OLDEST FIRST.
 */
export function withoutRetriedFailures<Row extends PersistedTurn>(rows: readonly Row[]): Row[] {
  return rows.filter((row, i) => {
    const next = rows[i + 1];
    return !(next && onlyAFailureBubble(row) && sameQuestion(row.question, next.question));
  });
}

/**
 * The stored turn Retry may re-ask: only the NEWEST turn of the conversation,
 * only when it is a provider failure (no answer text at all). A stopped answer
 * kept its partial text and is not offered here. A failure that recorded why
 * the providers were out (no key, usage limit, all down) is not offered
 * either: the live turn shows that copy without Retry (#4356), and the
 * reloaded turn must read the same. `rows` is OLDEST FIRST.
 *
 * `currentComponentId` is the component the header shows for this
 * conversation now (null = the whole machine), or undefined while it has not
 * been read. Retry asks under the header, so it is offered only when the
 * header still shows what the question was asked about (the live hold,
 * #5557): the component its record names, or the whole machine when it names
 * none (a failure before the component frame cannot say, so only the whole
 * machine is safe).
 */
export function persistedRetryTarget(
  rows: readonly PersistedTurn[],
  currentComponentId: string | null | undefined,
): { answerId: string; question: string } | null {
  const row = rows.at(-1);
  if (!row || !failedWithNoText(row)) return null;
  if ((row.evidence as readonly unknown[]).some(isProviderFailureEntry)) return null;
  // A photo question: the stored row keeps the text, not the photo, so a
  // re-ask would answer a different question. Typing it again is the way.
  if ((row.evidence as readonly unknown[]).some(isVisualObservationEntry)) return null;
  // An unread header (undefined) never equals a recorded component or null.
  const askedAbout = (row.evidence as readonly unknown[]).find(isComponentAttributionEntry)?.componentId ?? null;
  if (askedAbout !== currentComponentId) return null;
  const question = row.question.trim();
  return question ? { answerId: answerTurnId(row.id), question } : null;
}

/**
 * Mark the target turn's failure as retryable, so the shell shows Retry on it.
 * Every other turn is returned unchanged.
 */
export function withPersistedRetry(turns: readonly InteractionTurn[], answerId: string | null): InteractionTurn[] {
  if (!answerId) return [...turns];
  return turns.map((turn) => {
    if (turn.id !== answerId || turn.lifecycle !== "failed") return turn;
    return {
      ...turn,
      parts: turn.parts.map((part) =>
        part.type === "error" && part.error.code === "provider_failure"
          ? { ...part, error: { ...part.error, retryable: true } }
          : part,
      ),
    };
  });
}
