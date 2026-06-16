# VPS Session Audit — 2026-04-19

Pulled via `tools/audit/pull-vps-sessions.sh` from `mira-pipeline-saas` on app.factorylm.com.
5 real user sessions with photos, Apr 14 → Apr 18, 2026.

## Session index

| chat_id | Date | Equipment (actual) | MIRA's asset_identified | Final state | Exchanges |
|---------|------|-------------------|------------------------|-------------|-----------|
| `b500953b` | Apr 18 20:09 | Allen-Bradley ladder logic (PLC programming screen) | "close-up of a network or industrial control system's cable management system" (**wrong** — this is a PLC editor) | FIX_STEP | 7 |
| `25a144e8` | Apr 17 23:14 | TECO 3-phase induction motor nameplate, Design Q/320217ACV05 | "weathered metal plate with a label for a TECO 3-PHASE INDUCTION MOTOR" (correct class, no model) | Q1 | 2 |
| `53c8d12e` | Apr 17 18:00 | same TECO nameplate (different chat) | same | ASSET_IDENTIFIED | 2 |
| `9dbd1212` | Apr 17 17:26 | same TECO nameplate (different chat) | same | ASSET_IDENTIFIED | 2 |
| `e4ced7d8` | Apr 14 02:32 | PILZ PSENcs1.1n, 540053 V1.4, YOM 2024 | "yellow PILZ safety gate input module" (correct class, model visible but not captured) | Q3 | 5 |

## Failure mode frequency across the 5 sessions

| Tag | Count | Severity | Example |
|-----|-------|----------|---------|
| **vision-prose-leak** — "The image shows..." verbatim into asset_identified and replies | 5 / 5 | HIGH | Every session. Asset memory becomes "The image shows a…" which then feeds the next prompt |
| **padding-options** — "I'm not sure" / "Not visible" / "3. Other" / placeholder `["1","2"]` (Rule 3 violation) | 4 / 5 | HIGH | b500953b: "1. Yes…2. No…3. I'm not sure 4. Not visible" appeared twice |
| **no-take-charge** — user asks "how do I…" or "what do I check for" and MIRA quizzes back instead of teaching | 3 / 5 | HIGH | b500953b: "how would I wire this" → MIRA asks Y/N pin question. e4ced7d8: "what would I check for voltage" → MIRA asks if manual specifies |
| **rule-21-elevation** — user says "the big one in the middle" → MIRA says "the main power cable" (exactly the Wrong example in Rule 21) | 1 / 5 | HIGH | b500953b |
| **reflection-hallucination** — "You've checked cable labels" when user never said that | 2 / 5 | MED | b500953b twice |
| **manual-request-ignored** — user asks "is there a manual for this?" — MIRA never responds to the ask | 2 / 5 | HIGH | b500953b + e4ced7d8 both asked repeatedly |
| **envelope-leak (#380)** — raw JSON `{"next_state": "...", "reply": "...", ...}` rendered verbatim as assistant reply | 1 / 5 | P0 | 25a144e8 reply #1 is the literal JSON envelope. **PROD IS STILL LEAKING**, despite `e069c84` being on the current branch — need to verify prod deploy branch and redeploy |
| **form-feel** — Y/N question presented as numbered `1./2.` block instead of inline prose | 5 / 5 | MED | All sessions |
| **model-not-captured** — visible nameplate model number (e.g., PSENcs1.1n) not extracted | 2 / 5 | MED | e4ced7d8, 25a144e8 |
| **ladder-drift / no-ladder** — no sign of POWER→WIRING→MOTOR→PARAMETERS→LOAD sequencing | 5 / 5 | MED | Every session jumps to whatever narrow Y/N question the LLM dreams up |
| **depth-signal-missed** | 0 / 5 | n/a | Mike didn't say "explain"/"why" in these 5 sessions — so Phase 2C isn't exercised here. Still needs synthetic fixture |

## What this changes about the plan

1. **#380 envelope leak is NOT fixed on prod** — session 25a144e8 proves it. The current branch (`feat/qr-asset-tagging`) has the fix, but the VPS deploys from a different branch (`feat/training-loop-v1` per memory). Need to confirm deploy source and redeploy. This is now **Phase 0** — do it before anything else.

2. **Asset-identification contamination is worse than the "feel" problem.** Every subsequent turn inherits "The image shows a..." as the `equipment_type` and `manufacturer`, which pollutes RAG retrieval and makes every followup sound unhinged. This is a bigger lever than the numbered-options cleanup. Add to Phase 2: strip vision prose before saving to `session_context.equipment_type / manufacturer / asset_identified`.

3. **Manual-lookup request is a real trigger.** Users explicitly ask "do you have the manual for this?" twice across 5 sessions. That's a known intent that should route to the ingest/KB-lookup flow. Not in the original plan — add as Phase 2D or defer.

4. **Rule-21 violation is already in the prompt but being ignored** — the exact example pattern ("the big one" → "main power cable") is what the prompt warns against, and it happened anyway. Stricter enforcement needed: reflection must use the technician's noun phrase verbatim, or not reflect at all.

5. **Padding-options ban is in Rule 3 but being ignored.** Engine-side guard: `_format_reply` should drop options matching `"i'?m not sure|not visible|other|n/a|unsure|don'?t know"` (case-insensitive) and re-shape to prose when fewer than 2 remain.

6. **Ladder never advances.** Confirms Phase 2B is the right direction — engine-driven cursor, not LLM-decided.

## Per-session notes

- `b500953b.md` — full transcript + tags (PLC screen wrongly called "cable management", Rule 21 violation, SICK sensor mid-session pivot, ladder logic misdiagnosis)
- `25a144e8.md` — envelope-leak #380 CONFIRMED still on prod
- `53c8d12e.md` — invented "Alphanumeric Display" field that isn't on the photo
- `9dbd1212.md` — invented "flashing red" from nameplate photo (no display visible)
- `e4ced7d8.md` — manual request ignored, placeholder `["1","2"]` options, no-take-charge on voltage-check ask
