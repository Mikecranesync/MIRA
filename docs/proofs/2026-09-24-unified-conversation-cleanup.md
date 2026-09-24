# Unified conversation cleanup — active work claim

## [WORK-CLAIM]

- Slice: existing shared-renderer defects #3916 and #3961; advisory accessibility semantics.
- Owner: Codex active six-hour WIP completion task, CHARLIE.
- Branch: codex/unified-conversation-cleanup.
- Base: d1f0cfd9e40add9ba1c048cd735fa58c20f761b8.
- Shared-core lane: packages/factorylm-ui/src/parts.tsx and focused renderer tests only.
- Status: ACTIVE, 2026-09-24. No other agents from this task may write shared-core concurrently.
- Scope: keep observability data, suppress known diagnostic trace payloads in technician conversation, remove raw safety trigger text, and use note semantics for advisory warnings while preserving alerts for stops.
- Existing overlapping PRs: #3845 attachment retry rendering, #3815 public demo, #3690 held groundedness chrome. Their changes are not absorbed or altered; reconcile exact current diffs before merging.
- Validation planned: red-first DOM regression controls, shared suite/build, independent review, web lab render, staging Android build. Device backend DNS currently unavailable; no live acceptance claim.
- No new shell, parser, framework, backend enforcement, deployment, or #3984 clearance.
