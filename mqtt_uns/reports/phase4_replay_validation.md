# Phase 4 — MQTT replay validation

Pushed **420 replays** (35 scenarios × 12 repeats) through MQTT.

| metric | result |
|---|---|
| answer-card consistency (MQTT == offline) | **100.0%** (420/420) |
| determinism (every replay identical) | **100.0%** |
| citation completeness (tag + manual) | **100.0%** |
| cause accuracy (top == injected) | 37.14% (measured) |
| transport failures | 0 |
| answer-card mismatches | 0 |

**Phase 4 invariants** (must be 100%): answer-card consistency, determinism, citation
completeness — Phase 4 proves *transport preserves the answer*, and these hold at 100%.

**Cause accuracy is measured, not gated.** On the sparse synthetic fixture many modes share
the same generic symptoms (blocked / counts / state) with no distinguishing signature tag
— e.g. motor_overload vs conveyor_jam, or the line_stopped trio vfd/interlock/comm — so the
ranker resolves them to the highest-base-confidence cause. Crucially, **both the offline and
the MQTT paths agree on that same cause**, so the card survives transport unchanged. Cause
accuracy is an engine-discriminability metric (it rises as assets carry mode-specific
signature tags, like the conveyor's photoeye), NOT a transport defect.
