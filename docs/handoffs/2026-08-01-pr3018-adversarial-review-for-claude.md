# PR #3018 Adversarial Review Handoff

PR: https://github.com/Mikecranesync/MIRA/pull/3018

Verdict: not ready to merge.

## Fix These Before Merge

1. Resolve the current merge conflicts with latest `origin/main`.
   - Conflicts reproduced locally in `VERSION` and `docs/CHANGELOG.md`.
   - Rebase or merge main, keep the correct new version/changelog entry, then rerun CI.

2. Fix the activation-to-stream config mismatch.
   - `ignition/webdev/FactoryLM/api/connect/doPost.py` writes `RELAY_URL`.
   - `ignition/gateway-scripts/tag-stream.py` reads only `INGEST_URL`.
   - A freshly activated gateway can ignore the relay URL it just received.
   - Make the stream read canonical `RELAY_URL` or have activation also persist the exact key the stream uses. Add a regression test.

3. Do not report activation success unless config was actually persisted.
   - `_write_config()` only writes when an existing `factorylm.properties` exists.
   - If no file exists, it logs a warning but `doPost()` still returns `"activated"`.
   - Either deploy/create the properties file first or make `_write_config()` fail loudly and return an activation error. Add a test for clean-gateway/no-properties-file.

4. Fix `deploy_ignition.ps1 -Force` overwrite behavior.
   - Current code backs up the existing project, then runs:
     `Copy-Item -Path $ProjectSrc -Destination $ProjectDst -Recurse -Force`
   - In PowerShell, copying a directory to an existing directory nests it as `$ProjectDst\<source-name>` and leaves stale files in place.
   - After backup, remove the existing destination or copy the contents (`$ProjectSrc\*`) into a clean destination. Add a test or script guard.

5. Prove or eliminate Jython source-encoding risk.
   - Generated Gateway/WebDev artifacts contain UTF-8 non-ASCII bytes with no source encoding declaration.
   - CPython tests read UTF-8 explicitly, so they do not prove Ignition/Jython 2.7 parses the deployed artifacts.
   - Either make deployable Jython-targeted sources ASCII-only, add `# -*- coding: utf-8 -*-` if Ignition/Jython accepts it, or run/record a live Gateway parse probe for the exact generated artifacts.

## Verification Required

Run at minimum:

```powershell
git fetch origin main
git merge --no-commit --no-ff origin/main
git merge --abort
py -3 -m pytest tests\ignition tests\regime7_ignition\test_webdev_deploy_contract.py tests\test_architecture.py -q
py -3 -m ruff check ignition\tools ignition\webdev tests\ignition tests\regime7_ignition
git diff --check
```

Also verify GitHub reports `mergeable=MERGEABLE` and `mergeStateStatus=CLEAN`.

## Constraints

- Do not merge until the above blockers are fixed.
- Do not deploy to a live Gateway unless Mike explicitly approves it.
- Do not touch PLC logic, CCW projects, fieldbus write paths, or production secrets.
- Keep this as one focused hardening update to PR #3018.
