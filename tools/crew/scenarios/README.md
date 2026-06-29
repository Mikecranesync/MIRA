# Synthetic-worker scenarios

Each `*.scenario` file is a bounded dogfood task for `tools/crew/run_synthetic_workers.sh`.
It is **sourced** (plain bash `VAR=value` only — no logic) and must set:

| Variable | Meaning |
|---|---|
| `SCN_SUMMARY` | One-line description (shown by `--list`). |
| `SCN_TITLE` | Issue title if it gets filed. |
| `SCN_LABELS` | Must contain `dogfood` or `crew` (the runner only files gated issues). |
| `SCN_SEVERITY` | `P0`–`P3`. **P0 is refused unless `--allow-p0` is passed** (no autonomous P0 path). |
| `SCN_FINDER` | The worker/persona that found it. |
| `SCN_VERIFIER` | A **different** worker that verified it (self-verification is refused). |
| `SCN_DEDUPE` | Search terms passed to `create_issue.sh` (it re-dedupes before filing). |
| `SCN_NOT_SHARED` | Reasoning for "Not expected shared/public data: yes". |
| `SCN_EVIDENCE` | HTTP/log/code evidence reference. |
| `SCN_REPRO_CMD` | Shell that reproduces the finding. Must `exit 0` **and** print `SCN_REPRO_EXPECT`. |
| `SCN_REPRO_EXPECT` | Substring that proves reproduction. If absent → runner refuses (Reproduces: no). |
| `SCN_NARRATIVE` | (Optional) extra prose for the issue body. |

The runner enforces, in order: scenario-complete → labels include dogfood/crew →
finder ≠ verifier → **reproduces** → P0-needs-`--allow-p0` → builds a body with every
gate field → hands to `tools/qa/create_issue.sh` (which independently re-checks the gate
and dedupes). Default is `--dry-run`. Nothing is filed without `--file-issues`.

Keep scenarios deterministic where possible. Live-Hub scenarios must guard on
`QA_BASE_URL` (+ a saved session) so they fail safe — refusing to file — when the Hub
isn't up, rather than emitting a false negative.
