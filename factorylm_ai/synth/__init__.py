"""Autonomous Synthetic Interaction Flywheel — deterministic contracts + state.

PR A of the synthetic-flywheel addendum (parent: technician-grounding LoRA,
`docs/zta/2026-07-22-technician-lora-phase0-reconciliation.md` §7). This package
holds ONLY the deterministic substrate — source/label enums, the durable job
state machine, the SQLite job queue, the shared rejection-code vocabulary, and
the answer-key-independence law. **No agents, no network, no scheduling here**
(those are PR B–E). Everything is import-safe, hermetic, and fail-closed.
"""
