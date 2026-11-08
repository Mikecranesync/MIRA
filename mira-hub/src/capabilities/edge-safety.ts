/**
 * #5265 edge profile — immediate danger. On the tablet no model and no safety
 * judge run, so a report of smoke, fire, arcing, a shock or a machine moving on
 * its own must not reach the passage answer at all: the flag banner is dropped
 * on a refused turn and the judge's unverified fallback reads as routine
 * lockout advice (field run 2026-11-08, "smoke coming out of the drive
 * enclosure" → "I couldn't find support…"). This is a terminal stop with fixed
 * text and an escalation line, served through the route's existing
 * energized-work stop path (persisted safety_notice + safety_stop, replays on
 * reload). It only ADDS stops; it never clears a flag or a gate.
 *
 * The parity-pinned lists in lib/safety-classifier.ts are not touched; this is
 * a separate, edge-only detector for active-incident REPORTS.
 */

export type EdgeDangerKind = "smoke_fire" | "arc_explosion" | "shock" | "uncontrolled_motion";
export type EdgeDanger = { kind: EdgeDangerKind; matched: string };

const PATTERNS: Array<{ kind: EdgeDangerKind; re: RegExp }> = [
  {
    kind: "shock",
    re: /\b(?:(?:got|been|was|were|is|getting|get)\s+(?:shocked|zapped|electrocuted)|electrocut(?:ed|ion)|shocked\s+(?:me|him|her|them|someone|somebody)|(?:he|she|someone|somebody|they|i)\s+(?:got\s+)?(?:shocked|zapped))\b/i,
  },
  {
    kind: "smoke_fire",
    re: /\b(?:(?:visible|there(?:'s|\s+is|\s+was)|see|seeing|saw|some|lots\s+of|white|black|grey|gray)\s+smoke|smoke\s+(?:from|coming|out|in|inside|pouring|rising|is)|(?:is|it's|its|was|are|started|start)\s+smoking|smoking\s+(?:drive|motor|panel|enclosure|cabinet|vfd|wire|cable|terminal)|on\s+fire|caught\s+fire|(?:a|an|electrical)\s+fire\b(?![\s-]+(?:mode|alarm|watch|rated|rating|proof|protection|extinguisher|code|override|input|signal|damper|pump|safety|door|panel\s+input))|flames?\b(?![\s-]+(?:detector|sensor|rod|scanner|safeguard|rectifier|proof|retardant))|burning\s+smell|smell(?:s|ing)?\s+(?:of\s+|like\s+)?burn(?:ing|t)?|melt(?:ed|ing)\s+(?:insulation|wire|wires|cable|plastic|terminal))\b/i,
  },
  {
    kind: "arc_explosion",
    re: /\b(?:arcing|(?:is|was|it's|are|keeps)\s+sparking|sparks?\s+(?:from|coming|flying|out|in|inside)|arc(?:ed)?\s+flash(?:ed)?\s+(?:just|happened|occurred|went)|(?:just\s+)?(?:exploded|blew\s+up)|explosion(?![\s-]+proof)|loud\s+bang)\b/i,
  },
  {
    kind: "uncontrolled_motion",
    re: /\b(?:(?:start(?:ed|s|ing)?|mov(?:ed|es|ing)|run(?:s|ning)?|ran|jog(?:ged|s|ging)?|turn(?:ed|s)?\s+on|restart(?:ed|s)?)\s+(?:up\s+)?(?:by\s+itself|on\s+its\s+own|unexpectedly|without\s+(?:a\s+|any\s+)?(?:command|signal|start|reason)|for\s+no\s+reason)|unexpected(?:ly)?\s+(?:start(?:ed)?|motion|movement|move|moved|restart(?:ed)?)|(?:won't|will\s+not|wouldn't|can't|cannot|doesn't|does\s+not|didn't|did\s+not)\s+stop|e-?stop\s+(?:doesn't|does\s+not|didn't|did\s+not|won't|will\s+not|failed|is\s+not\s+working)|(?:won't|will\s+not)\s+(?:shut|turn)\s+off)\b/i,
  },
];

// A definition question about a hazard ("what is arcing?", "explain arc flash",
// "how does the drive prevent unexpected restart?") asks ABOUT it and reports
// nothing. Only a definitional opener with no report cue is exempt.
const DEFINITIONAL_RE =
  /^\s*(?:what(?:'s|\s+is|\s+are|\s+does|\s+do)\b|define\b|describe\b|explain\b|tell\s+me\s+about\b|how\s+does\b|how\s+do\s+(?:i|you|we)\s+prevent\b)/i;
const REPORT_CUE_RE =
  /\b(?:there(?:'s|\s+is|\s+was)|right\s+now|just|now|currently|again|i\s+(?:see|smell|hear|saw|smelled|heard)|it(?:'s|\s+is|\s+was)|keeps?|started|our|my|this\s+(?:drive|motor|machine|conveyor|panel))\b/i;

/** The active incident a message REPORTS, or null. */
export function edgeImmediateDanger(message: string): EdgeDanger | null {
  const msg = (message || "").trim();
  if (!msg) return null;
  for (const { kind, re } of PATTERNS) {
    const m = re.exec(msg);
    if (!m) continue;
    if (DEFINITIONAL_RE.test(msg) && !REPORT_CUE_RE.test(msg)) return null;
    return { kind, matched: m[0].toLowerCase() };
  }
  return null;
}

/** Trigger recorded on the safety frame and the persisted safety_notice / safety_stop. */
export function edgeDangerTrigger(d: EdgeDanger): string {
  return `edge-immediate-danger:${d.kind}`;
}

const WHAT: Record<EdgeDangerKind, string> = {
  smoke_fire: "Smoke, fire, a burning smell or melted insulation means an active electrical fault or fire.",
  arc_explosion: "Arcing, sparks or a bang/explosion means an active electrical fault. Equipment that is arcing can arc again.",
  shock: "Someone may have been shocked. Do not touch them while they may still be in contact with the source.",
  uncontrolled_motion: "A machine that moves or starts on its own, or will not stop, is not under control.",
};

const FIRST: Record<EdgeDangerKind, string> = {
  smoke_fire: "Keep everyone clear. Do not open the enclosure, reset the fault or restart the machine.",
  arc_explosion: "Keep everyone clear of the equipment. Do not open the enclosure, reset the fault or restart the machine.",
  shock: "Remove power from a point away from the person, only if you can do it safely, then get medical help.",
  uncontrolled_motion: "Keep everyone out of its path. Use the emergency stop only if you can reach it without entering the machine's path.",
};

const CALL: Record<EdgeDangerKind, string> = {
  smoke_fire: "Fire or anyone hurt: call your site emergency number or emergency services now.",
  arc_explosion: "Fire or anyone hurt: call your site emergency number or emergency services now.",
  shock: "Call your site emergency number or emergency services now, even if the person says they feel fine.",
  uncontrolled_motion: "Anyone hurt or caught: call your site emergency number or emergency services now.",
};

/**
 * The stop text. Fixed, server-written, no manual words and no steps: it says
 * stop, keep clear, call for help, tell the supervisor, and that MIRA gives no
 * troubleshooting for an active incident.
 */
export function edgeImmediateDangerStop(d: EdgeDanger): string {
  return `⛔ **STOP — DO NOT OPERATE this machine.**

${WHAT[d.kind]}

- ${FIRST[d.kind]}
- Remove power only from a point away from the equipment, and only if you can do it safely and your site procedure allows it.
- ${CALL[d.kind]}
- Tell your supervisor now. Lock out and tag the machine, and leave it out of service until a qualified person has inspected it.

MIRA does not give troubleshooting steps for an active incident. Once a qualified person has made the machine safe and inspected it, ask again and MIRA will show the manual pages.`;
}
