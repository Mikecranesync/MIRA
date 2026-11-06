# Living Sheet / work instruction contract — draft slice

Codex task01a1ae98 implemented an opt-in versioned JSON projection of the existing
Living Sheet snapshot, with per-fact/step unreviewed state and explicit gaps.
See `docs/specs/living-instruction-record-v1.md` and
`docs/proofs/living-instruction-record-v1/verification.md`.
Local Living Sheet368 tests and full Hub13,044 tests pass. Existing typecheck
diagnostics are byte-identical to R0. Independent review/CI/release are separate.
Lossless packet intake, performing-tech closeout QC, later acceptance and UNS
snapshot preservation remain open. No shared operations or human acceptance.
