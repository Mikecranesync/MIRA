# Hallucination audit — D2 UNS-gate symptom-first fallback

**Date:** 2026-08-04 · **Branch:** `fix/uns-gate-symptom-fallback` @ `880af8d55`
**Scope:** the D2 diff only (`mira-bots/shared/engine.py` gate region +
`tests/test_uns_confirmation_gate.py`). Not a whole-repo sweep.

## Summary

P0: 0 · P1: 0 · P2: 1 · P3: 0

The change removes a *repeated question*; it adds **no new answer-emission
path**. Symptom-first turns exit through the same pipeline as every other
diagnostic turn.

## Findings

| file:line | Category | Risk | Note / fix |
|---|---|---|---|
| `mira-bots/shared/engine.py:7126` (`_uns_gate_fallback_notice`) | risk language | P2 | The notice says "general guidance (lower confidence)" — the word "general" here is the honest degraded-mode label the owner spec requires, not an instruction to guess. Downstream Rule 16 ("Based on general knowledge — no specific documentation found") and citation relevance enforcement still apply. No fix needed; recorded for pattern-scanners. |

## UNS gate verification — PASS (intentional, bounded exception documented)

The gate still fires exactly as before for every session that has not proven
identity-exhaustion:

- Predicate unchanged: `_should_fire_uns_gate` (`engine.py:7067`) — flag,
  direct-connection carve-out, gated intents, asset_identified, IDLE.
- **New bounded exception (owner-specified, 2026-08-04):** the gate stops
  re-firing only when `_uns_gate_exhausted` (`engine.py:7112`) holds — the
  technician said they cannot identify the machine
  (`_UNS_IDENTITY_UNKNOWN_RE`, conservative), or
  `MIRA_UNS_GATE_MAX_ATTEMPTS` (=2) firings went unresolved — **and** the
  current turn carries no real candidate (`uns_ctx.manufacturer` empty, no
  asset-state hit). A resolved manufacturer or asset-state hit always re-fires
  the confirmation (`engine.py:3048` call-site guard), so later nameplate
  discovery restores the grounded route. UNS-022 honored: nothing is
  defaulted or fabricated — `asset_identified` stays unset, the degraded mode
  is labeled once, and the resolver keeps running every turn.

## Evidence citation coverage — unchanged

Symptom-first turns emit via the normal flow: `_format_reply` →
honest-prefix prepend (`engine.py:3757`) → `_check_citation_compliance`
(`engine.py:3765`, presence + manufacturer-relevance enforcement on the
*prefixed* reply). The fallback adds no emission point that skips this.

## Invention check — PASS

- `_uns_gate_fallback_notice` names no manufacturer/model (pinned by
  `test_fallback_notice_emitted_once_and_invents_nothing`).
- No KG writes, no default identities, no read-only changes in the diff.

## Both-directions test evidence

`tests/test_uns_confirmation_gate.py` (28 pass): unknown identity progresses
instead of looping; real specs / fresh sessions keep the grounded route;
candidate-present exhaustion is impossible (mutation-checked — removing the
guard fails `test_gate_not_exhausted_when_candidate_present`); confirmation
resets the bookkeeping; the notice appears exactly once.
