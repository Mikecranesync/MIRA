/**
 * Work Packet — the words a phone reads aloud for a packet, so a technician with gloves on can hear
 * the hardware and torque without reading the screen. Pure; the host speaks it with the shared
 * `createReadAloud` (browser speech, no service call).
 *
 * Nothing is spoken as fact that the screen would not show as fact: an unknown value is read as
 * "unknown, do not use", a struck value as "excluded", a proposed value with "proposed, check it",
 * and every open question is read before the steps.
 */
import type { Field, WorkPacket } from "@/capabilities/work-packet/types";

/** Units and symbols a speech engine reads badly ("Nm" → "N m"). */
function sayable(s: string): string {
  return s
    .replace(/(\d)\s*Nm\b/g, "$1 newton metres")
    .replace(/\bMa\*\s*=/g, "M A star equals ")
    .replace(/\bMa\s*=/g, "M A equals ")
    .replace(/(\d)\s*x\s*(\d)/gi, "$1 by $2")
    .replace(/\[\?\]/g, " unreadable ");
}

function fieldWords(f: Field): string {
  if (f.struck) return "excluded, struck by a technician, do not use";
  if (f.label === "unknown" || f.value == null) return "unknown, do not use";
  const v = sayable(f.value);
  return f.label === "verified" ? v : `${v}, proposed, check it`;
}

/** One utterance for the whole packet, in the order a technician needs it. */
export function spokenPacketText(packet: Pick<WorkPacket, "scope" | "parts" | "measurements" | "blockers" | "steps" | "safety">): string {
  const out: string[] = [];
  const scope = packet.scope.map((f) => f.value).filter(Boolean).join(". ");
  if (scope) out.push(`${sayable(scope)}.`);
  const blockers = packet.blockers ?? [];
  if (blockers.length > 0) {
    out.push(`${blockers.length} open ${blockers.length === 1 ? "question" : "questions"} before you start.`);
    blockers.forEach((b, i) => out.push(`Question ${i + 1}: ${sayable(b.basis)}`));
  }
  out.push("Site isolation: set by your site, not by this packet.");
  if (packet.parts.length > 0) {
    out.push("Hardware.");
    packet.parts.forEach((p, i) =>
      out.push(`Item ${i + 1}: ${fieldWords(p.description)}. Quantity ${fieldWords(p.qty)}. Article number ${fieldWords(p.partNumber)}.`),
    );
  }
  for (const m of packet.measurements) out.push(`${sayable(m.name.value ?? "Torque")}: ${fieldWords(m.value)}.`);
  packet.steps.forEach((s, i) => out.push(`Step ${i + 1}: ${fieldWords(s.text)}.`));
  return out.join(" ");
}
