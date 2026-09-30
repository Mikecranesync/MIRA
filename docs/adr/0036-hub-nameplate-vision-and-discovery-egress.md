# ADR-0036 — Hub nameplate vision + manual-discovery egress policy

**Status: PARTIALLY ACCEPTED — 2026-09-30.** Mike approved one narrow Serper use:
an exact part/catalog number read from a user-submitted photo may be sent only
after the technician explicitly asks MIRA to find its manual. This approval does
not approve other Serper queries or settle the separate runtime vision egress.
**Date:** 2026-08-16
**Raised by:** Codex review of PR #3245 (rounds 1–2): "the Hub calls Together directly,
bypassing the governed inference router/sanitizer; Serper lacks a documented production
exception; ADR simultaneously says 'pending Mike' and describes the egresses as approved."

## The honest problem statement

Two code paths in the nameplate→manual arc make external cloud calls that **the current
root policy does not permit**:

1. **Nameplate vision** — `mira-hub/src/lib/nameplate/index.ts` calls Together's
   OpenAI-compatible vision endpoint directly. By default `defaultRecognizer()` uses
   Together (`MiniMaxAI/MiniMax-M3` since 2026-08-25 — `google/gemma-3n-E4B-it` went dedicated-only and 502'd every read; `NAMEPLATE_VISION_FALLBACK_MODELS` lists models to try on `model_not_available`); it can also use Groq **iff** `GROQ_VISION_MODEL`
   is explicitly set (Groq ships no vision model otherwise, so this is off by default).
   Anthropic is never used here.
2. **Manual discovery** — `mira-ask`'s `/manual-discovery/search` sends
   `(manufacturer, model/catalog)` strings to Serper.dev, then SSRF-guarded probes the
   result URLs.

**Root `AGENTS.md` §2 currently says:** "No cloud except Anthropic Codex API + NeonDB …
plus the narrow governed Together exception … for the FactoryLM AI **paid-training**
workstream only." Under that text:
- Hub nameplate vision on Together is **outside** the existing Together carve-out (it is
  runtime recognition, not paid training).
- **Serper is permitted only for the explicit, exact part-number manual lookup
  described in the limits below.** The broader manufacturer/model discovery decision
  remains unsettled.

So this arc **cannot be made compliant by code changes**. It needs the owner to decide
whether to expand the cloud-egress policy. That decision is this ADR.

## What is being asked of the owner (pick one per egress)

**Nameplate vision (Together, optionally Groq):**
- (A) Approve as a new named runtime exception, and amend `AGENTS.md` §2 + PRD §4 to name
  it — OR
- (B) Route Hub vision through the governed Python inference boundary
  (`mira-bots/shared/inference/router.py`). ⚠️ Note: that boundary's `sanitize_context()`
  masks serial numbers (`[SN]`) — and reading serials off a nameplate photo the user
  submitted for that purpose is the whole feature. Routing through it as-is would destroy
  the payload; option (B) would require a vision-path carve-out in the sanitizer too.

**Manual discovery (Serper):**
- (C) Approve Serper as a permitted egress for identity-string-only queries, and amend
  `AGENTS.md` §2 — OR
- (D) Drop external discovery; rely only on the already-attached / already-ingested OEM
  corpus.

## If approved (A/C), the scope limits that MUST be written into the amended policy

- Nameplate vision: only equipment-nameplate photos the tenant user explicitly submitted;
  Together (or explicitly-configured Groq); NEVER a chat/diagnosis provider; NEVER
  Anthropic; not part of the diagnostic cascade (PRD §4 / PR #610 unchanged).
- Serper: manufacturer/model/catalog identity strings ONLY — never chat text, notebook
  content, or PII. URL probing is SSRF-guarded (`shared/manual_search/search.py`;
  is_global + explicit CGNAT reject; per-hop revalidation; streamed cap). Residual
  DNS-rebinding TOCTOU is the same documented limitation as the hardened Hub downloader
  (`safe-download.ts`) and mitigated the same way (allowlist on the actual download).
- Credentials Doppler-managed; provider error text credential-scrubbed (PRD §20).

## Limits of the 2026-09-30 part-number approval

- Input is exactly one unambiguous part/catalog number from the photo observation.
- The technician must explicitly request the manual lookup in the chat.
- Do not send the question, other notebook content, serial number, or personal data.
- A manufacturer-unknown result is only a possible candidate. Do not call it OEM,
  download/import it, bind the notebook, or use it as answer evidence.
- Search failure and search miss remain distinct; never invent a URL.

## Until the remaining decisions are accepted

- The nameplate detector ships DARK (`NAMEPLATE_DETECT_ENABLED=0`).
- Broad manufacturer/model Serper discovery and runtime vision egress remain **blocked on the owner's
  policy decision**, not on further engineering. The 2026-09-30 part-only explicit-search path is the sole
  exception and remains discovery-only.

## Consequences

The accepted narrow exception and the remaining owner decisions are recorded here and reflected in
`AGENTS.md` §2 and the visual-technician PRD. Broader options (B)/(D) remain follow-up decisions.
