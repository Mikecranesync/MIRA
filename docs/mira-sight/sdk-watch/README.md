# MIRA Sight SDK watch

Deterministic upstream-change detection for wearable SDKs (PRD §11). One CLI:

    PYTHONPATH=mira-sight python -m mira_sight.sdk_watch.cli            # dry-run (default)
    PYTHONPATH=mira-sight python -m mira_sight.sdk_watch.cli --apply    # update baselines + emit packets
    PYTHONPATH=mira-sight python -m mira_sight.sdk_watch.cli --fixture-dir DIR  # offline

- **Registry / URL allowlist:** `config/mira-sight-sdk-sources.yaml` — the watcher can only
  fetch URLs derived from this file. Expanding it is a reviewed change.
- **Baseline lock:** `config/mira-sight-sdk-baselines.lock.json` — committed state; a
  meaningful upstream change shows up as a reviewable diff to this file plus a change packet
  under `artifacts/mira-sight/sdk-watch/<date>/` (JSON + Markdown).
- **Workflow:** `.github/workflows/mira-sight-sdk-watch.yml` — scheduled twice weekly +
  manual dispatch; dry-run by default; issue creation is opt-in (`emit_issues`); `contents:
  read` (the refreshed lock ships as a run artifact for a human to commit).
- **Security posture:** upstream text is untrusted data — normalized, hashed, boundedly
  diffed, keyword-classified; never executed, never followed. Size cap 2 MB, timeout 15 s,
  per-source error containment. Tests: `tests/mira_sight/test_sdk_watch.py` (hermetic,
  includes hostile-content, allowlist, size-cap, and idempotency fixtures).

Source policy (PRD §11.2): official vendor sources only; a marketing announcement is not a
source; every entry names its vendor, priority, and what qualifies as meaningful change.
