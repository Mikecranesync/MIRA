/** Stored failure eligibility. Retry resolves the original server-owned request;
 * matching text alone never permits collapsing distinct recorded exchanges. */
import type { InteractionTurn } from "../../../packages/factorylm-interaction/src";
import type { PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import { isComponentAttributionEntry } from "@/capabilities/bench-components/attribution";
import { isProviderFailureEntry, isVisualObservationEntry } from "@/lib/notebook-chat-types";
import { answerTurnId } from "./to-interaction";

/** A stored turn that ended with no answer text at all (answer_status "error",
 *  nothing streamed). A stopped answer keeps its partial text; a refusal, an
 *  abstention or a safety stop is not stored as an error. */
function failedWithNoText(row: PersistedTurn): boolean {
  return row.answerStatus === "error" && (row.answerText ?? "") === "";
}

/** Preserve historical photos, partial answers and component attribution. */
export function withoutRetriedFailures<Row extends PersistedTurn>(rows: readonly Row[]): Row[] {
  // Matching text does not establish retry intent. Preserve every recorded
  // exchange, including its photo, partial answer and original attribution.
  return [...rows];
}

/**
 * The stored turn eligible for original-request recovery: only the NEWEST turn of the conversation,
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
  currentEquipmentEntityId: string | null | undefined,
): { answerId: string; question: string } | null {
  const row = rows.at(-1);
  if (!row || !failedWithNoText(row)) return null;
  if (typeof row.equipmentEntityId !== "string" || row.equipmentEntityId !== currentEquipmentEntityId) return null;
  if ((row.evidence as readonly unknown[]).some(isProviderFailureEntry)) return null;
  // Photo recovery requires the server-owned request pointer. The recovery
  // projection handles it; history text alone cannot reconstruct the photo.
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
