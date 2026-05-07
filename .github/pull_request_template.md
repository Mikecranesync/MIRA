<!--
Spec: docs/specs/enforcement-layer-spec.md §4.5

Fill the fields below before requesting review. Reviewers should not approve
PRs with the Spec reference left blank — the field exists so future-you can
trace why this code looks the way it does.
-->

## Summary

<!-- What changed and why, in 1-3 bullets. Skip the "what files" — the diff shows that. -->

-

## Spec reference

`docs/specs/_____.md`

<!--
If this PR doesn't fit any existing spec:
  - Bug fix:           write `N/A — bug fix, see linked issue`
  - One-off ops:       write `N/A — ops`
  - Spec is in flight: write `docs/specs/_____.md (drafting in PR #___)`
Anything else: write a spec first, then come back.
-->

## Acceptance criteria verified

- [ ] Yes — listed below
- [ ] N/A (justify in summary)

<!-- If yes, copy the criteria from the spec and tick them. -->

## Pre-merge checklist

- [ ] No regressions on Playwright audit (`docs/audits/`)
- [ ] Write-path integration tests pass (`pytest tests/integration/test_write_paths.py`)
- [ ] Enum drift check passes (`python scripts/check_enum_drift.py`)
- [ ] No new secrets in diff (`git diff --cached | rg -i 'api[_-]?key|secret|token|password'`)
- [ ] CHANGELOG entry added if this changes user-visible behavior

## Test plan

<!-- How a reviewer should reproduce / verify. URLs, commands, fixtures. -->

-

## Linked issues / context

<!-- Linear, GitHub issues, Slack threads, prior PRs. -->

-
