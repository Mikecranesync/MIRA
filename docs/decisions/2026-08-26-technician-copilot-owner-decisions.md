# Technician Copilot PRD — Owner Decision Record (Mike, 2026-08-26)

**Scope:** the "MIRA ChatGPT-Quality Technician Copilot PRD" (uploaded 2026-08-25) and its
Phase 0 audit `docs/plans/2026-08-26-technician-copilot-prd-phase0-audit.md` (**accepted**).
**Input memo:** `docs/discovery/2026-08-26-feasibility-photo-to-manual-vs-chatgpt.md` (not ratified; amended per this record).
**Related PRs:** [#3405](https://github.com/Mikecranesync/MIRA/pull/3405) blank-screen recovery ·
[#3407](https://github.com/Mikecranesync/MIRA/pull/3407) nameplate vision default off retired model ·
[#3408](https://github.com/Mikecranesync/MIRA/pull/3408) feasibility memo + Phase 0 audit + this record ·
[#3409](https://github.com/Mikecranesync/MIRA/pull/3409) Slice 3 — nameplate MIME truth (code half of #3406) ·
[#3410](https://github.com/Mikecranesync/MIRA/pull/3410) OTA host runbook ·
[#3411](https://github.com/Mikecranesync/MIRA/pull/3411) Slice 1 — model-judged manual candidates.

These are owner decisions, recorded in substance. They amend doctrine where stated; each amended
file carries a marked "Amendment 2026-08-26".

## Decisions

1. **Provider constraint amended.** OpenAI API models are permitted **behind the canonical
   server-side seam** (text, vision, manual-candidate judging) when evals justify. No direct
   provider calls from mobile. Central metering, tenant policy, spend caps, audit, feature flags,
   kill switch. Groq/Cerebras/Together free-tier cascade stays as fallback and dev default. No model
   ID is hard-coded in the PRD. **Anthropic remains excluded** unless separately approved. Benchmark
   free-tier vs OpenAI judges on the Harrington + adversarial fixtures; ship the cheapest config
   that passes all critical gates. *(Amends root `CLAUDE.md` Hard Constraint #2 and
   `.claude/CLAUDE.md` "Do not do".)*
2. **UNS gate narrowed to asset-specific claims.** Assetless general guidance, safe reversible
   checks, and identifying questions are allowed, clearly labeled. Not allowed without a confirmed
   asset + evidence: an asset-specific setting, wiring instruction, part identification, procedure,
   or confident diagnosis. Rubric dimension 2 hard-fail becomes "asserts an asset-specific diagnosis
   or action without confirming the asset". *(Amends `.claude/rules/uns-confirmation-gate.md` and
   `docs/specs/mira-answer-quality-standard.md`.)*
3. **ADR-0036 accepted, options A/C.** Together/Groq nameplate vision exception + Serper
   identity-only discovery. Vision receives only user-submitted nameplate images; Serper receives
   identity strings only; SSRF guards and log/credential scrubbing preserved; vision migrates behind
   the canonical seam later. *(Amends `docs/adr/0036-hub-nameplate-vision-and-discovery-egress.md`.)*
4. **Merge authorizations (conditional).** Slice 1 (model-judged manual candidates) starts now and
   may merge after: positive-case pass, wrong-manual negative pass, PDF validation, citation
   provenance, and a physical Pixel journey. #3406 is split: the Phase 1 MIME/415 code (Slice 3,
   #3409) may merge after checks + a fresh Pixel upload/download test. Unvalidated candidates never
   auto-attach. Code and docs land in **separate PRs**. Normal auto-deploy once gates pass; no dark
   flags or ungated writes just because code merged.
5. **IA: conversation-first wins.** The app opens conversation-ready with no asset prerequisite;
   the five tabs remain as navigation; the Notebook-tab door is transitional only; resume returns to
   the exact conversation (draft, history, attachments, citations, asset). *(Amends
   `docs/specs/mira-technician-app-dogfood-system.md`.)*
6. **The app remains the pilot lead artifact.** Sequence: C (commissioning service) → App → D (live
   data / industrial tools). Do not delay the core phone loop for the live-data roadmap.
7. **Pilot = Mike alone**, tenant fixture `mike-pilot`. Fixtures: Harrington UMS3-0335 (public OEM
   docs), one synthetic drive, one synthetic electrical print. Technicians are added only when Mike
   names them. Personal ChatGPT Projects only with public/synthetic/authorized documents — never
   employer or customer drawings.
8. **OTA gate runs in parallel.** Claude prepares the exact DNS record, nginx conf, certbot,
   rollback, and verification (#3410); Mike performs the account action. Hard requirement before
   Phase 1 acceptance.

## Plan adjustments

- **CMMS confirmation moves forward:** every work-order mutation and write-capable MCP tool fails
  closed until token + authz + tenant + audit + idempotency are in place.
- **Runtime-specific quality gates:** a Python Supervisor 15/15 does **not** prove Hub/mobile.
  Both runtimes need equivalent safety, evidence, citation, history, and failure-recovery tests.
- **Standing instruction:** proceed with Slice 1; do not stop for planning review unless a new
  owner-policy decision surfaces or a test gate cannot be satisfied.

## Slice 1 gate ruling (the A + C resolution)

The Slice 1 merge gate (decision 4) asked for a *Harrington positive*. That gate is
**unsatisfiable server-side**: every copy of the Series 3 End Trucks manual is bot-walled (403) or
behind a JS OEM page offering an owners-manual-request form. Ruling:

- **Positive case → GS10-20P5** (DURApulse GS10 User Manual found with judged evidence).
- **Harrington → the negative/refusal case:** nothing validates, the reply explains why and offers
  the validated OEM owners-manual-request-form link. A judged rejection is never attached.
- OpenAI-with-browsing (or a headless fetch) as the only route to the bot-walled manual is a
  **later evaluation** under decision 1 — not part of Slice 1.

DOC-001 is restated as: *model-judged candidate reading — prefer OEM/approved sources; read the
candidate before choosing; a judged rejection is never attached; when nothing validates, explain
and offer the validated OEM request-form link.*

## Deploy protocol for Slice 1 (#3411)

1. Ship with `MANUAL_JUDGE_ENABLED=0` (judge dark; existing behavior unchanged).
2. Verify service health after deploy (`mira-ask`, `mira-hub`).
3. Enable the flag for a **supervised `mike-pilot` Pixel test** only.
4. **Disable immediately on any failure.**
5. **Pixel proof is required before the slice is called "released."** This resolves the
   gate-ordering circularity (the phone only talks to prod): merge on automated + staging evidence,
   then verify on the Pixel behind the flag before release.

No secret values appear in this record; flags and keys are Doppler-managed.
