# Concurrent notebook restore

Reuse the batched notebook-thread query from PR #4610, preserving tenant/owner/legacy and pending-turn rules. Three 71-notebook page loads acquire six tenant transactions instead of216. Real-Postgres concurrency and isolation regressions must run in CI. Physical acceptance remains separate until deployment and a new Pixel test window. The monorepo version remains derived from git tags per docs/versioning.md; no VERSION file is introduced.
