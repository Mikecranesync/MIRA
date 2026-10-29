/**
 * L4 renderer, number-safe slice (owner decision 4; SE-1, SE-2, NUM-1, NUM-2, SYS-1).
 *
 * The DC-bus discharge step is written by code, never by the model:
 *  - a discharge time appears only as an applicable source states it, cited in its own sentence,
 *    with the source's rating condition; when the sources disagree, the longest time is given as
 *    the fallback for an unknown rating (NUM-2);
 *  - with no applicable source, it renders "per the drive's label or manual, then measure";
 *  - the meter test (DC+ to DC-, each to ground, below the manual's threshold) always follows,
 *    and a wait, a dark LED or a blank display is never presented as proof (SE-1, SE-2);
 *  - it never says the equipment is safe (SYS-1).
 * Its own output passes `extractNumbers` + `verifyNumbers` with zero blocks (tested).
 */
import { chunkStatements, type Statement } from "./statements";
import { conditionCovers, sameCondition, sameValue } from "./text";
import { applicability } from "./verify";
import type { BoundAsset, Condition, EvidenceChunk, Quantity, VerifyResult } from "./types";

export const chunkIdToMarker = (id: string) => (id === "photo" ? "[photo]" : `[${id.replace(/^c/, "")}]`);

function duration(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

const rating = (c: Condition) =>
  c.op === "le" ? `${c.value} ${c.unit} or less` : c.op === "ge" ? `${c.value} ${c.unit} or more` : `${c.value} ${c.unit}`;

type Cited = Statement & { chunkId: string };

function applicableStatements(chunks: EvidenceChunk[], bound: BoundAsset | null, q: Statement["quantity"]): Cited[] {
  return chunks
    .filter((c) => applicability(c, bound) === null)
    .flatMap((c) =>
      chunkStatements(c)
        .filter((s) => s.quantity === q && conditionCovers(s.condition, bound?.rating))
        .map((s) => ({ ...s, chunkId: c.id })),
    );
}

const uniq = (xs: Cited[]) =>
  xs.filter((s, i) => xs.findIndex((t) => sameValue(s.quantity, t.value, s.value) && (sameCondition(t.condition, s.condition) || (!t.condition && !s.condition))) === i);

export function renderDischargeProcedure(opts: { chunks: EvidenceChunk[]; bound: BoundAsset | null }): string {
  const times = applicableStatements(opts.chunks, opts.bound, "discharge_time");
  const lines: string[] = [];
  const distinct = [...new Set(times.map((t) => t.value))];
  if (times.length === 0) {
    lines.push("Wait the discharge time printed on the drive's warning label or stated in its manual.");
  } else if (distinct.length === 1 && times.some((t) => !t.condition)) {
    const t = times.find((x) => !x.condition)!;
    lines.push(`Wait at least ${duration(t.value)} after power is removed for the DC bus capacitors to discharge, as the manual states ${chunkIdToMarker(t.chunkId)}.`);
  } else {
    for (const t of uniq(times.filter((x) => x.condition))) {
      lines.push(`For drives rated ${rating(t.condition!)}, wait at least ${duration(t.value)} after power is removed for the DC bus capacitors to discharge ${chunkIdToMarker(t.chunkId)}.`);
    }
    if (distinct.length > 1) {
      const longest = times.find((t) => t.value === Math.max(...distinct))!;
      lines.push(`If you are not sure of the drive's rating, wait the longest time the manual gives, ${duration(longest.value)} ${chunkIdToMarker(longest.chunkId)}.`);
    } else {
      lines.push("For any other rating, use the time on the drive's warning label or in its manual.");
    }
    lines.push("The rating is on the drive's nameplate; tell me the model or rating and I will give its figure.");
  }
  const thresholds = applicableStatements(opts.chunks, opts.bound, "residual_voltage").filter((s) => !s.condition && s.value > 0);
  const meter = "Then, before you touch anything, measure DC+ to DC- and each DC terminal to ground with a meter rated for the bus voltage";
  if (thresholds.length > 0) {
    const low = thresholds.reduce((a, b) => (b.value < a.value ? b : a));
    lines.push(`${meter}, and confirm the reading is below ${low.value} V ${chunkIdToMarker(low.chunkId)}.`);
  } else {
    lines.push(`${meter}, and confirm it reads below the level the drive's label or manual states.`);
  }
  lines.push("If it does not, wait longer and measure again. Do not short the bus to discharge it.");
  lines.push("A dark display, an unlit charge LED or a finished wait does not prove the bus is discharged: only the meter reading does.");
  return lines.join("\n");
}

const DC_BUS: Quantity[] = ["discharge_time", "residual_voltage"];

/** The quantity-neutral replacement when the blocked number is not a DC-bus figure (pressure,
 *  approach boundary, incident energy): no number, no procedure, never "safe". */
export const NEUTRAL_FALLBACK =
  "I can't give that figure: no applicable source for this equipment states it. Use the value on the equipment's own label or in its manual, or your site's energy-control or arc-flash documentation, and follow your lockout/tagout procedure.";

/** The number-safe replacement for a blocked turn, or null when the verifier did not block.
 *  The DC-bus procedure only when a DC-bus check (or an unclassifiable one) blocked. */
export function numberSafeFallback(result: VerifyResult, opts: { chunks: EvidenceChunk[]; bound: BoundAsset | null }): string | null {
  if (result.verdict !== "block") return null;
  const dcBlock = result.checks.some(
    (c) => c.enforced && c.verdict.startsWith("block:") && (c.number === null || DC_BUS.includes(c.number.quantity)),
  );
  return dcBlock ? renderDischargeProcedure(opts) : NEUTRAL_FALLBACK;
}
