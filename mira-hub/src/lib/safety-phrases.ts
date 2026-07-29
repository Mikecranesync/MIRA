/**
 * Hub chat safety-keyword hard-stop phrase list.
 *
 * SOURCE OF TRUTH: `mira-bots/shared/guardrails.py` `SAFETY_KEYWORDS`. This
 * file is a transcription, not an independent list — do NOT hand-edit it to
 * add/remove a phrase without also changing guardrails.py (or vice versa).
 * `mira-hub/src/lib/safety-phrases.test.ts` parses guardrails.py at test time
 * and fails loudly on any drift between the two lists.
 *
 * Why this exists (duplicate-systems-audit.md finding #1 / master-plan T3):
 * the Hub chat routes (`/api/assets/[id]/chat`, `/api/namespace/node/[id]/chat`)
 * previously carried their own hand-maintained ~16-phrase copy that claimed
 * to mirror guardrails.py but had silently drifted — missing the physical-hazard
 * category entirely ("melted insulation", "burn mark", "visible smoke", etc.).
 * A technician reporting melted insulation would hard-stop on Slack/Telegram
 * but get normal LLM troubleshooting on the Hub. This file + the parity test
 * close that gap.
 *
 * Matching semantics (must match guardrails.py `classify_intent`): the caller
 * lowercases the full message text, then does a case-insensitive SUBSTRING
 * match against each phrase below (phrases are already lowercase). See
 * `hasSafetyKeyword()` in the chat routes.
 */
export const SAFETY_PHRASES: string[] = [
  "exposed wire",
  "energized conductor",
  "arc flash",
  "sparking",
  "lockout tagout",
  "lockout/tagout",
  "loto",
  "visible smoke",
  "smoke from",
  "burn mark",
  "melted insulation",
  "electrical fire",
  "shock hazard",
  "rotating hazard",
  "pinch point",
  "entanglement",
  "confined space",
  "pressurized",
  "caught in",
  "crush hazard",
  "fall hazard",
  "chemical spill",
  "gas leak",
  // Hot work — welding / cutting / grinding ignition sources (OSHA 1910.252).
  "hot work",
  // Electrical isolation / live-work phrases (added v2.4.1)
  "isolate the power",
  "isolating power",
  "isolating the power",
  "de-energize",
  "de-energizing",
  "pull the fuse",
  "pull the breaker",
  "pulling the fuse",
  "pulling the breaker",
  "removing power",
  "cutting power",
  "pull the power",
  "pulling power",
  "live wire",
  "live circuit",
  "live panel",
  "working live",
  "working on live",
  // Temporal live-work phrases
  "was live",
  "while live",
  // Power isolation variants
  "isolate power",
  "which cable to pull",
  "which wire to pull",
  "pull the cable",
  "cut the power",
  "cut power",
  "disconnect power",
  "disconnect the power",
];
