# Quality Gate Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Response-validation middleware that runs **after** the diagnostic engine produces a reply and **before** the adapter ships it to the user. Catches hallucination artifacts, missing citations, intent leakage (industrial jargon in greetings, transcription artifacts in text-only chats), and unsafe responses where a SAFETY_ALERT path was missed. Exists because the engine is a probabilistic system and the failure mode of confidently wrong industrial advice is unacceptable.

## Scope
**IN scope**
- `guardrails.check_output(response, intent, has_photo)` — output post-processor
- `_infer_confidence(reply)` heuristic — `high | medium | low | none`
- Hallucination strippers (industrial jargon in greetings, OCR/transcription artifacts in text-only inputs)
- Citation presence check on industrial intent (warns when missing)

**OUT of scope**
- Input intent classification (`classify_intent` lives in guardrails but is upstream)
- Safety keyword detection (separate path; bypasses everything)
- LLM judge for offline eval (`tests/eval/analyze_sessions.py`)

## Architecture
```
Supervisor.process()
   → workers compute reply
   → guardrails.check_output(reply, intent, has_photo)   ← Quality Gate
   → confidence = _infer_confidence(reply)
   → return reply, confidence to adapter
```

The gate is **synchronous** and **deterministic** — no LLM call. Decisions land in < 10 ms.

## API Contract

```python
guardrails.check_output(
    response: str,
    intent: Literal["safety","industrial","greeting","help","off_topic"],
    has_photo: bool,
) -> str   # cleaned response
```

Behavior:
- For `intent == "greeting"` — strip industrial jargon (e.g. "I'll check the VFD parameters") and return a clean greeting.
- For `intent == "industrial"` and `has_photo == False` — strip transcription/OCR artifacts that imply visual context the user did not provide.
- For `intent == "off_topic"` — return a polite redirect.
- For `intent == "safety"` — pass-through; safety responses are owned by the safety branch and must not be mutated.

```python
guardrails._infer_confidence(reply: str) -> "high"|"medium"|"low"|"none"
```
- High signals: "replace", "fault code", "check wiring", "disconnect", "de-energize"
- Low signals: "might be", "could be", "possibly", "not sure"

## Configuration
No env vars. The keyword lists are constants in `mira-bots/shared/guardrails.py`:
- `SAFETY_KEYWORDS` (21 phrases)
- `INTENT_KEYWORDS` (industrial)
- `MAINTENANCE_ABBREVIATIONS` (query expansion)

Changes to those lists require a code change + tests.

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Property tests over guardrails | 11 | maintain ≥ 11; add for every new keyword |
| False-positive rate (good answer mutated) | unmeasured | < 1 % on golden cases |
| False-negative rate (bad answer passed) | unmeasured | < 5 % on adversarial set |
| Latency overhead | < 10 ms | maintain |
| Safety pass-through invariant | 100 % | regression-tested |

## Acceptance Criteria
1. **Greeting hygiene:** A reply containing industrial jargon to a `greeting` intent is stripped.
2. **No-photo hygiene:** A reply implying visual analysis when `has_photo=False` is stripped.
3. **Safety pass-through:** When `intent == "safety"`, output is byte-identical to input.
4. **Confidence ladder:** `"replace the contactor and check wiring"` → `high`; `"it could be a bad capacitor, possibly"` → `low`; empty string → `none`.
5. **Property tests:** All hypothesis property tests in `tests/property/` for guardrails pass.
6. **No regression:** Per memory `feedback_resolved_state_wo_rebuild` — clearing `cmms_pending` alone is not enough; quality gate must not interfere with `_clear_diagnostic_carryover` resetting `state["state"]` off `RESOLVED`.

## Known Issues
- Heuristic confidence is keyword-based; long-term, replace with calibrated LLM-judge confidence (planned).
- Citation presence is **warned, not enforced** — industrial replies without citations still pass.

## Change Log
- 2026-04 — `detect_session_followup` added to short-circuit intent for active sessions ("you said", "link", etc.).
- 2026-04-15 — Intent classifier biased toward `industrial` for unknown queries; greetings require keyword + length < 20 (#280).
