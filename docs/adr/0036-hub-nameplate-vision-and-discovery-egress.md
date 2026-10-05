# ADR-0036 — Hub nameplate vision + manual-discovery egress policy

**Status: SPLIT.**
- **Manual discovery (Serper): ACCEPTED, option (C), 2026-09-30** — owner decision D1 on
  the Manual-First PRD v1.7.1 (recorded at
  https://github.com/Mikecranesync/MIRA/issues/4160#issuecomment-5922449058). Automatic,
  identity-only search, within the limits in § "Accepted Serper scope" below.
- **Nameplate vision (Together / optional Groq): still PROPOSED — NOT accepted.** Options
  (A)/(B) remain the owner's decision; nothing here authorizes runtime vision egress.
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
- **Serper was not permitted at all** (resolved for identity-only discovery by D1 below).

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

## Accepted Serper scope (D1, 2026-09-30)

These limits are the policy; code that exceeds them is a defect, not a reading of the ADR.

- **What may be sent:** the manufacturer slug, the part/model token, and an optional catalog
  number — nothing else (PRD R4). Never observation text, the question, the photo, tenant,
  site, asset tag, serial number, notebook content, or PII. Tenant/user context travels only
  inside our services, for caps and audit.
- **When:** automatically, when the Manual-First trigger holds (PRD R2) — a candidate identity
  plus manual/documentation intent, or an identity read from a nameplate/label. Searching
  never writes notebook identity, and the first manual-grounded answer still waits for one
  technician confirmation (D2 / PRD R3).
- **How much:** every Serper call is a counted provider query — at most 4 per call
  (S1, #4161), 10 per user per day and 50 per tenant per day, plus a global breaker
  (D4 / PRD R13). The monthly dollar ceiling is an open owner input; the breaker does not run
  in production on an invented figure.
- **Who may call:** only an authenticated caller — `/manual-discovery/search` fails closed
  without `MANUAL_DISCOVERY_API_KEY` (#4162).
- **Fetching results:** every probe and download dials only DNS answers that passed the
  public-address check, on every redirect hop (#4163 mira-ask, #4164 Hub). The DNS-rebinding
  residual described above is closed. Only a PDF on the maker's own documentation host may be
  labelled a manual (PRD R7).
- **What a result is:** a candidate. It is not trusted until the applicability check and the
  technician confirmation pass; tenant finds enter the shared library only by curation (D3).

## Until the remaining decision is accepted

- The nameplate detector ships DARK (`NAMEPLATE_DETECT_ENABLED=0`).
- The Hub runtime vision path exists in code but enabling it in production is **blocked on
  the owner's policy decision** (A/B), not on further engineering. Serper discovery is no
  longer blocked by this ADR; it is bounded by § "Accepted Serper scope".

## Consequences

The Serper half is accepted and `AGENTS.md` §2 names it, pointing here for the limits. The
vision half is unchanged: if accepted (A), amend `AGENTS.md` §2 + PRD §4 the same way; if
declined, option (B) is the engineering follow-up. No self-approval — each acceptance is an
owner decision, recorded with a link like D1's above.
