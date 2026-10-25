# #4332 qualification takeover — 2026-10-23

Mike explicitly assigned #4332 to this CHARLIE Codex session, then requested continuation of the photo journey. Preserve the existing PR and review ledgers. Integration is isolated in `qualification-4332`, based on main `28430d68b`, with original candidate `ff1f47ccc643` as the second merge parent. No foreign checkout is edited.

1. Reconcile the original maintenance/citation/retrieval/mobile fixes with current main; retain current identity scoping, guided dead ends, thread routing, attachment retry cleanup and OpenAI judge infrastructure.
2. Run focused and full Hub/mobile verification, builds, and evaluator truth tests. Reuse cached judge verdicts before paid calls. The existing Doppler OpenAI key is authorized; never expose it or substitute another provider.
3. Repair the retained Sources reopen failure with a mounted regression. Complete normal guarded-file approval and commit hooks; never fabricate the human-terminal record.
4. Update the existing PR branch and description, obtain applicable current-head independent review and CI, and perform candidate-specific staging/device acceptance. Old review GREEN3 is historical once source changes. Original source review caps do not reset.
5. Continue photo refresh/transcription follow-ups after qualification. Production deployment and mobile OTA remain separate owner gates.

Current integration verification: full Hub 9,148 pass / 53 skipped; full mobile 961 pass; both production builds pass. Sources reopen mounted regression failed before the saved repair and passes afterward. Evaluator truth tests 33 pass; bootstrap controls 11 pass. Offline DeepEval 21 cases passes using 114 cached verdicts, zero misses and no provider calls. No physical Android device is connected. The guarded commit requires a real-terminal owner record for the final staged tree; this is not replaceable by chat approval. Current-head review/CI/staging/device acceptance remain pending.
