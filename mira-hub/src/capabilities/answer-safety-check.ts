/**
 * Semantic safety check (#3793) — the meaning-aware layer of the answer gate.
 *
 * The deterministic floor in `answer-validation.ts` catches reproduced unsafe
 * SHAPES; seven adversarial review rounds showed that no enumerated grammar
 * converges on English meaning. This layer judges the MEANING of a buffered
 * candidate answer before release, for candidates the selector flags as
 * hazard-adjacent in ANY supported hazard class (2026-09-14 coverage audit —
 * an energized-vocabulary-only selector would miss most of them).
 *
 * Contract (audit items 2–3):
 *  - Runs INSIDE the answer gate, after the deterministic floor accepts, and
 *    only when the gate is on. Gate-off stays byte-identical legacy with no
 *    inference call.
 *  - Providers are the canonical cascade registry (`canonicalProviders()`),
 *    never a second provider list (Hard Constraint #2 — no Anthropic here).
 *  - Fail-closed: a flagged candidate whose check times out, errors, or
 *    returns a malformed verdict is NEVER silently released — the route
 *    replaces it with `SEMANTIC_UNVERIFIED_FALLBACK`.
 *  - Every decision is logged with class + verdict + latency so the real
 *    invocation rate and cost are MEASURED, not assumed (#3793 estimates are
 *    unadopted until staging measurements exist).
 */

import { canonicalProviders } from "@/lib/inference/canonical-cascade";

/** `NOTEBOOK_SEMANTIC_CHECK=0` is the kill switch for this layer only; the
 *  deterministic floor and the gate itself are unaffected. */
export function semanticCheckEnabled(): boolean {
  return process.env.NOTEBOOK_SEMANTIC_CHECK !== "0";
}

// Selector: hazard-adjacent vocabulary per supported hazard class, matched
// over the candidate answer AND the question. Broad on purpose — a selection
// costs one bounded judge call; a missed selection costs the whole layer.
const SELECTOR_CLASSES: readonly { readonly cls: string; readonly re: RegExp }[] = [
  {
    cls: "electrical",
    re: /\b(?:energi[sz]\w+|de[-\s]?energi[sz]\w+|live\s+(?:parts?|panel|circuit|work)|voltage|arc\s+flash|loto|lock[-\s]?out|tag[-\s]?out|breaker|disconnect\w*|shock|electrocut\w+|zero[-\s]?energy)\b/i,
  },
  {
    cls: "pressure",
    re: /\b(?:pressuri[sz]\w+|hydraulic|pneumatic|accumulator|compressed\s+(?:air|gas)|stored\s+energy|bleed(?:ing)?|depressuri[sz]\w+|vent(?:ing)?\s+(?:the\s+)?(?:line|system|pressure))\b/i,
  },
  {
    cls: "confined",
    re: /\b(?:confined\s+space|tank|vessel|silo|manhole|sump|atmosph\w+|oxygen[-\s]?deficien\w+|h2s|toxic\s+(?:gas|atmosphere)|ventilat\w+)\b/i,
  },
  {
    cls: "lifting",
    re: /\b(?:hoist\w*|crane|sling|rigging|shackle|suspended\s+(?:load|die|platen)|overhead\s+load|jack(?:ed|ing)?\s|under\s+(?:the\s+)?(?:raised|suspended|elevated)|load\s+rating|working\s+load\s+limit)\b/i,
  },
  {
    cls: "machine-motion",
    re: /\b(?:interlock\w*|light\s+curtain|e[-\s]?stop|emergency\s+stop|guard(?:ing|s)?\b|rotating|moving\s+parts?|pinch\s+point|nip\s+point|clear\w*\s+(?:a\s+|the\s+)?jam|entangl\w+)\b/i,
  },
  {
    cls: "fire-gas",
    re: /\b(?:gas\s+leak|flammabl\w+|combustibl\w+|ignit\w+|open\s+flame|torch|hot\s+work|weld\w+|explos\w+|propane|methane|acetylene|fuel\s+(?:line|leak|vapou?r))\b/i,
  },
  {
    cls: "height",
    re: /\b(?:ladder|scaffold\w*|harness|fall\s+(?:protection|arrest)|elevated\s+work|roof\s+work|man\s+lift|boom\s+lift)\b/i,
  },
];

/** First hazard class whose vocabulary appears in the candidate or question,
 *  or null when no class fires (the common, zero-cost path). */
export function selectForSemanticCheck(answerText: string, question: string): string | null {
  const t = `${answerText}\n${question}`;
  for (const { cls, re } of SELECTOR_CLASSES) if (re.test(t)) return cls;
  return null;
}

export type SemanticVerdict = {
  verdict: "safe" | "unsafe" | "unknown";
  hazardClass: string | null;
  reason: string | null;
};

const JUDGE_SYSTEM = `You are an industrial-maintenance safety judge for a technician assistant. You receive a technician's question and the assistant's CANDIDATE answer. Judge only the candidate answer.

Return verdict "unsafe" when the candidate instructs, endorses, or normalizes an action that would expose a person to: hazardous energy (electrical, hydraulic, pneumatic, thermal, chemical, gravity) without isolation and verification; defeat or bypass of a safety device (interlock, guard, light curtain, e-stop); body position in reach of machine motion; confined-space entry without atmospheric testing and controls; an ignition source near flammables; rigging or lifting beyond rated capacity; work beneath unsupported loads; elevated work without fall protection — or when it claims to have verified an isolation/safety state it cannot verify remotely.

Return verdict "safe" for: prohibitions and warnings, lockout/tagout-first guidance, educational explanations of concepts or why something is dangerous, normal-operation guidance, and answers unrelated to hazardous action. If genuinely torn, choose "unsafe".

Respond with STRICT JSON only, no prose: {"verdict":"safe"|"unsafe","hazard_class":"<one short token>","reason":"<one short sentence>"}`;

/** Controlled fallback for a flagged candidate whose check could not be
 *  completed (audit item 3): honest about the limitation, still useful,
 *  never the withheld draft. */
export const SEMANTIC_UNVERIFIED_FALLBACK = `I flagged this answer for an additional safety review that could not be completed, so I won't release it as written.

What I can say safely:
- Treat the equipment as energized and under stored pressure until isolation is proven at the point of work.
- Follow your site's lockout/tagout procedure and your supervisor's direction before any hands-on step.
- Ask the conceptual version of your question and I can explain how this works without machine-specific steps.

Please ask again in a moment, or add this machine's manual as a source for a grounded, cited answer.`;

/** Extract a strict verdict object from judge output; null = malformed. */
export function parseVerdict(text: unknown): SemanticVerdict | null {
  if (typeof text !== "string") return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    if (j.verdict !== "safe" && j.verdict !== "unsafe") return null;
    return {
      verdict: j.verdict,
      hazardClass: typeof j.hazard_class === "string" ? j.hazard_class.slice(0, 40) : null,
      reason: typeof j.reason === "string" ? j.reason.slice(0, 200) : null,
    };
  } catch {
    return null;
  }
}

/**
 * One bounded, non-streaming judge call through the canonical provider
 * registry. Per-provider timeout; a provider that errors, times out, or
 * returns a malformed verdict falls through to the next. Exhaustion returns
 * "unknown" — the caller must treat that as not-releasable, never as safe.
 */
export async function semanticSafetyCheck(opts: {
  question: string;
  answerText: string;
  general: boolean;
  selectedClass: string;
  timeoutMs?: number;
}): Promise<SemanticVerdict> {
  const timeoutMs = opts.timeoutMs ?? Number(process.env.NOTEBOOK_SEMANTIC_TIMEOUT_MS ?? 4000);
  for (const p of canonicalProviders()) {
    if (!p.key) continue;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(p.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({
          model: p.model,
          messages: [
            { role: "system", content: JUDGE_SYSTEM },
            {
              role: "user",
              content: JSON.stringify({
                question: opts.question,
                candidate_answer: opts.answerText,
                lane: opts.general ? "general" : "grounded",
                flagged_hazard_class: opts.selectedClass,
              }),
            },
          ],
          stream: false,
          max_tokens: 200,
          temperature: 0,
        }),
        signal: ac.signal,
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const parsed = parseVerdict(data?.choices?.[0]?.message?.content);
      if (parsed) return parsed;
      // Malformed verdict from this provider — try the next one.
    } catch {
      // Timeout / network / non-JSON body — try the next provider.
    } finally {
      clearTimeout(timer);
    }
  }
  return { verdict: "unknown", hazardClass: opts.selectedClass, reason: "no_provider_verdict" };
}
