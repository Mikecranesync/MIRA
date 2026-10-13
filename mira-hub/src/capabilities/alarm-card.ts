/**
 * The alarm card (spec 2026-10-12-alarm-reasoning-design.md §7). Deterministic: no
 * model in its path. Groups and parses the transcribed lines, looks up family packs,
 * and renders a fixed-order card that must pass validateAnswer and the energized-step
 * check UNMODIFIED — if it cannot, there is no card (the turn falls through).
 */
import { groupAlarmRecords, parseAlarmRecord, timeSeconds, type AlarmLine, type AlarmRecord } from "./alarm-line";
import { ALARM_PACKS, packFor, type AlarmPack } from "./alarm-packs/loader";
import { validateAnswer } from "./answer-validation";
import { stepEnergyContradiction } from "./step-energy";

export type AlarmCard = {
  text: string;
  lead: AlarmLine;
  covered: AlarmLine[];
  packIds: string[];
  packVersions: number[];
  firstOut: boolean;
  valuesRedacted: boolean;
};

const CUT_TIMES =
  "This screen cuts off the times, so it can't show which alarm came first — read it from the alarm history.";
const MIXED_DATES = "I can't order these alarms from this screen — read the order from the alarm history.";
const NOT_ON_VIEW = "The reading isn't shown on this screen — read it from the alarm history.";

export function packKey(l: AlarmLine): string | null {
  if (l.kind === "measurement_limit" && l.quantity === "temperature" && l.direction) {
    return `measurement_limit:temperature:${l.direction}`;
  }
  if (l.kind === "io_diagnostic" && l.diagnostic === "wire_break" && l.channel) {
    return `io_diagnostic:wire_break:${l.channel.io}`;
  }
  if (l.kind === "safety_passivation") return "safety_passivation";
  return null;
}

function fullSeconds(r: AlarmRecord): number | null {
  return r.time && !r.time.truncated ? timeSeconds(r.time.text) : null;
}

function pickLead(covered: AlarmLine[]): { lead: AlarmLine; firstOut: boolean; note: string | null } {
  // A passivation is the safety program's response; it never heads the card over a cause.
  const causes = covered.filter((l) => l.kind !== "safety_passivation");
  const pool = causes.length > 0 ? causes : covered;
  if (pool.length === 1) return { lead: pool[0], firstOut: false, note: null };
  const secs = pool.map((l) => fullSeconds(l.record));
  // First-out needs every record to show the SAME full date: times without a date cannot be
  // ordered (23:59:58 and 00:00:03 may be different days) — review #4389 r7.
  const dates = new Set(pool.map((l) => l.record.date?.text ?? ""));
  const sameDay =
    dates.size === 1 && !dates.has("") && !pool.some((l) => !l.record.date || l.record.date.truncated);
  if (secs.every((s) => s !== null) && sameDay) {
    let best = 0;
    secs.forEach((s, i) => { if ((s as number) < (secs[best] as number)) best = i; });
    return { lead: pool[best], firstOut: true, note: null };
  }
  return { lead: pool[0], firstOut: false, note: secs.every((s) => s !== null) ? MIXED_DATES : CUT_TIMES };
}

function quote(r: AlarmRecord, redact: boolean): string {
  const text = redact
    ? r.text.replace(/(-?[\d?]+(?:[.,][\d?]+)?)(…|\.\.\.)?\s*(°C|°F|Ω|ohm|%|mA|V|A|bar)(?![A-Za-z])/g, "[on your photo]")
    : r.text;
  return r.count > 1 ? `${text} (×${r.count})` : text;
}

function sharedCause(covered: AlarmLine[]): boolean {
  const byTime = new Map<string, Set<string>>();
  for (const l of covered) {
    if (l.kind !== "io_diagnostic" || l.diagnostic !== "wire_break" || !l.record.time) continue;
    const who = `${l.designations[0]?.raw ?? ""}#${l.channel?.number ?? ""}`;
    // "Same time" means same date AND same visible time — review #4389 r7.
    const when = `${l.record.date?.text ?? ""}|${l.record.time.text}`;
    const set = byTime.get(when) ?? new Set<string>();
    set.add(who);
    byTime.set(when, set);
  }
  return [...byTime.values()].some((s) => s.size >= 2);
}

function render(
  lead: AlarmLine,
  covered: AlarmLine[],
  uncovered: AlarmRecord[],
  orderNote: string | null,
  packs: readonly AlarmPack[],
  redact: boolean,
): string | null {
  const hit = packFor(packKey(lead)!, packs);
  if (!hit) return null;
  const { pack, entry } = hit;
  const rulesPack = packs.find((p) => p.rules) ?? null;
  const out: string[] = [];

  out.push(redact ? "**Alarm** — as read from your photo (values left on your photo)" : "**Alarm** — as read from your photo");
  out.push(`> ${quote(lead.record, redact)}`);
  if (lead.kind === "measurement_limit" && !lead.value.shown &&
      (lead.value.reason === "not_displayed" || lead.value.reason === "zero_and_zero_limit")) {
    out.push(NOT_ON_VIEW);
  }
  out.push("", "**What it means**", entry.means);
  out.push("", "**Two hypotheses**", `1. ${entry.hypotheses[0]}`, `2. ${entry.hypotheses[1]}`);

  const together: string[] = [];
  if (rulesPack?.rules?.shared_cause && sharedCause(covered)) together.push(rulesPack.rules.shared_cause);
  const hasWireBreak = covered.some((l) => l.kind === "io_diagnostic" && l.diagnostic === "wire_break");
  const hasPassivation = covered.some((l) => l.kind === "safety_passivation");
  if (rulesPack?.rules?.consequence && hasWireBreak && hasPassivation) together.push(rulesPack.rules.consequence);
  if (together.length) out.push("", "**Read together**", ...together);

  out.push("", "**Next three checks** (look and read only)", ...entry.checks.map((c, i) => `${i + 1}. ${c}`));

  const others = [...covered.filter((l) => l !== lead).map((l) => l.record), ...uncovered];
  if (others.length) out.push("", "**Also on this screen**", ...others.map((r) => `- ${quote(r, redact)}`));

  out.push("", "**What this does not prove**", ...entry.does_not_prove.map((d) => `- ${d}`));

  const cannot: string[] = [];
  if (orderNote) cannot.push(orderNote);
  if (covered.some((l) => l.fAddress?.truncated)) cannot.push("The F-I/O start addresses are cut off.");
  if (!lead.value.shown && lead.value.reason === "unrecognized") {
    cannot.push("The reading on the alarm line is in a form I can't read — read it from your photo.");
  }
  if (!lead.value.shown && (lead.value.reason === "truncated" || lead.value.reason === "unreadable")) {
    cannot.push("The reading is cut off or unreadable on this screen.");
  }
  if ([...covered.map((l) => l.record), ...uncovered].some((r) => r.text.includes("?"))) {
    cannot.push("Some characters could not be read; they are shown as ?.");
  }
  if (cannot.length) out.push("", "**What I could not read**", ...cannot.map((c) => `- ${c}`));

  const sources = [...new Set(covered.map((l) => packFor(packKey(l)!, packs)!.pack))]
    .map((p) => `${p.title} v${p.version}`).join(", ");
  out.push("", `Source: your photo · MIRA engineering reference — ${sources}`);
  out.push("", pack.site_procedure_line);
  return out.join("\n");
}

function passes(text: string): boolean {
  const v = validateAnswer({ answerText: text, question: "", general: false, served: true, refused: false, evidenceSufficient: true });
  return v.ok && stepEnergyContradiction(text) === null;
}

export function buildAlarmCard(lines: readonly string[], packs: readonly AlarmPack[] = ALARM_PACKS): AlarmCard | null {
  const records = groupAlarmRecords(lines);
  const covered: AlarmLine[] = [];
  const uncovered: AlarmRecord[] = [];
  for (const r of records) {
    const parsed = parseAlarmRecord(r);
    const key = parsed ? packKey(parsed) : null;
    if (parsed && key && packFor(key, packs)) covered.push(parsed);
    else uncovered.push(r);
  }
  if (covered.length === 0) return null;
  const { lead, firstOut, note } = pickLead(covered);
  const usedPacks = [...new Set(covered.map((l) => packFor(packKey(l)!, packs)!.pack))];
  const base = {
    lead, covered, firstOut,
    packIds: usedPacks.map((p) => p.pack_id),
    packVersions: usedPacks.map((p) => p.version),
  };

  const plain = render(lead, covered, uncovered, note, packs, false);
  if (plain && passes(plain)) return { ...base, text: plain, valuesRedacted: false };
  // The checker blocked something (e.g. a quoted rating). Leave values on the photo —
  // the checker is never weakened (spec §7).
  const redacted = render(lead, covered, uncovered, note, packs, true);
  if (redacted && passes(redacted)) return { ...base, text: redacted, valuesRedacted: true };
  return null;
}
